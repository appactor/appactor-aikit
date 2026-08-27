import { timingSafeEqual } from 'node:crypto'
import { createMcpProtectedRequestHandler } from '@better-auth/mcp'
import { type AuthInfo, createMcpHandler } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import type { JWTPayload } from 'jose'
import { Counter, Registry } from 'prom-client'
import { AppActorApiClient } from './appactor-api'
import type { Config } from './config'
import { createAppActorMcpServer } from './mcp-server'
import { MCP_SCOPES, OAUTH_SCOPES_ADVERTISED, requiredScopeForRequest } from './scopes'

function claimScopes(value: unknown): string[] {
	if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
	if (Array.isArray(value))
		return value.filter((scope): scope is string => typeof scope === 'string')
	return []
}

function bearerToken(request: Request) {
	const authorization = request.headers.get('authorization')
	return authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
}

function toAuthInfo(
	request: Request,
	claims: JWTPayload,
	resource: string,
): AuthInfo {
	if (!claims.sub) throw new Error('OAuth access token has no subject.')
	const clientId =
		typeof claims.client_id === 'string' ? claims.client_id : claims.azp
	if (typeof clientId !== 'string' || !clientId)
		throw new Error('OAuth access token has no client ID.')
	return {
		token: bearerToken(request),
		clientId,
		scopes: claimScopes(claims.scope),
		expiresAt: claims.exp,
		resource: new URL(resource),
		extra: { userId: claims.sub },
	}
}

function requestOriginAllowed(request: Request, resource: URL) {
	const origin = request.headers.get('origin')
	if (!origin) return true
	if (origin === resource.origin) return true
	return resource.hostname === '127.0.0.1' || resource.hostname === 'localhost'
}

function validMetricsToken(request: Request, expected: string | undefined) {
	if (!expected) return true
	const actual =
		request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
	const actualBytes = Buffer.from(actual)
	const expectedBytes = Buffer.from(expected)
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	)
}

export async function createApp(config: Config, fetcher: typeof fetch = fetch) {
	const app = new Hono()
	app.use('*', async (c, next) => {
		if (c.req.header('cookie'))
			return c.json(
				{ error: 'Browser cookies are not accepted by the MCP service.' },
				400,
			)
		await next()
	})
	const api = new AppActorApiClient(config, fetcher)
	await api.ready()
	const registry = new Registry()
	const requests = new Counter({
		name: 'appactor_mcp_http_requests_total',
		help: 'AppActor MCP HTTP requests.',
		labelNames: ['route', 'status'],
		registers: [registry],
	})
	const resource = new URL(config.MCP_RESOURCE_URL)
	// Default `legacy: 'stateless'` keeps 2025-era clients (current Claude and
	// Codex releases) working alongside the 2026-07-28 per-request protocol.
	const mcpHandler = createMcpHandler((context) =>
		createAppActorMcpServer(api, context.authInfo),
	)
	const createProtectedHandler = (requiredScope: string) =>
		createMcpProtectedRequestHandler(
			{
				issuer: config.MCP_AUTH_ISSUER,
				audience: config.MCP_RESOURCE_URL,
				jwksUrl: config.MCP_AUTH_JWKS_URL,
				challengeScopes: [requiredScope],
				requiredScopes: [requiredScope],
			},
			(request, claims) =>
				mcpHandler.fetch(request, {
					authInfo: toAuthInfo(request, claims, config.MCP_RESOURCE_URL),
				}),
		)
	const protectedHandlers = new Map(
		MCP_SCOPES.map((scope) => [scope, createProtectedHandler(scope)]),
	)

	app.get('/health', (c) => c.json({ status: 'ok' }))
	const protectedResourceMetadata = {
		resource: config.MCP_RESOURCE_URL,
		authorization_servers: [config.MCP_AUTH_ISSUER],
		bearer_methods_supported: ['header'],
		scopes_supported: [...OAUTH_SCOPES_ADVERTISED],
	}
	for (const path of [
		'/.well-known/oauth-protected-resource',
		'/.well-known/oauth-protected-resource/mcp',
	]) {
		app.get(path, (c) => c.json(protectedResourceMetadata))
		app.on('HEAD', path, (c) =>
			c.body(null, 200, { 'content-type': 'application/json' }),
		)
	}
	app.get('/metrics', async (c) => {
		if (!validMetricsToken(c.req.raw, config.MCP_METRICS_AUTH_TOKEN))
			return c.json({ error: 'Unauthorized.' }, 401)
		return c.text(await registry.metrics(), 200, {
			'content-type': registry.contentType,
		})
	})
	app.post('/mcp', async (c) => {
		const requestHost = c.req.header('host') ?? new URL(c.req.url).host
		if (
			requestHost !== resource.host ||
			!requestOriginAllowed(c.req.raw, resource)
		) {
			requests.inc({ route: 'mcp', status: 'rejected' })
			return c.json({ error: 'Invalid host or origin.' }, 403)
		}
		const scope = requiredScopeForRequest(c.req.raw)
		const handler = protectedHandlers.get(scope)
		if (!handler) return c.json({ error: 'Unsupported MCP scope.' }, 500)
		let response: Response
		try {
			response = await handler(c.req.raw)
		} catch (error) {
			// Token verification infrastructure failures (JWKS unreachable, upstream
			// 5xx) are not client errors; surface them as a retryable 503.
			console.error(
				JSON.stringify({
					level: 'error',
					message: 'MCP token verification unavailable',
					error: error instanceof Error ? error.message : String(error),
				}),
			)
			requests.inc({ route: 'mcp', status: '503' })
			return c.json(
				{ error: 'Authorization server is temporarily unavailable.' },
				503,
				{ 'retry-after': '5' },
			)
		}
		requests.inc({ route: 'mcp', status: String(response.status) })
		return response
	})
	app.get('/mcp', (c) => c.text('Method not allowed.', 405, { Allow: 'POST' }))
	app.delete('/mcp', (c) =>
		c.text('Method not allowed.', 405, { Allow: 'POST' }),
	)

	return app
}
