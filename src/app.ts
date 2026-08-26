import { createMcpProtectedRequestHandler } from '@better-auth/mcp'
import { type AuthInfo, createMcpHandler } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import type { JWTPayload } from 'jose'
import { Counter, Registry } from 'prom-client'
import { AppActorApiClient } from './appactor-api'
import type { Config } from './config'
import { createAppActorMcpServer } from './mcp-server'

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

export function createApp(config: Config, fetcher: typeof fetch = fetch) {
	const app = new Hono()
	const api = new AppActorApiClient(config, fetcher)
	const registry = new Registry()
	const requests = new Counter({
		name: 'appactor_mcp_http_requests_total',
		help: 'AppActor MCP HTTP requests.',
		labelNames: ['route', 'status'],
		registers: [registry],
	})
	const resource = new URL(config.MCP_RESOURCE_URL)
	const mcpHandler = createMcpHandler(
		(context) => createAppActorMcpServer(api, context.authInfo),
		{ legacy: 'reject' },
	)
	const protectedHandler = createMcpProtectedRequestHandler(
		{
			issuer: config.MCP_AUTH_ISSUER,
			audience: config.MCP_RESOURCE_URL,
			jwksUrl: config.MCP_AUTH_JWKS_URL,
			challengeScopes: [
				'workspace:read',
				'analytics:read',
				'catalog:read',
				'catalog:write',
				'workspace:write',
			],
		},
		(request, claims) =>
			mcpHandler.fetch(request, {
				authInfo: toAuthInfo(request, claims, config.MCP_RESOURCE_URL),
			}),
	)

	app.get('/health', (c) => c.json({ status: 'ok' }))
	app.get('/metrics', async (c) =>
		c.text(await registry.metrics(), 200, {
			'content-type': registry.contentType,
		}),
	)
	app.post('/mcp', async (c) => {
		const requestHost = c.req.header('host') ?? new URL(c.req.url).host
		if (
			requestHost !== resource.host ||
			!requestOriginAllowed(c.req.raw, resource)
		) {
			requests.inc({ route: 'mcp', status: 'rejected' })
			return c.json({ error: 'Invalid host or origin.' }, 403)
		}
		const response = await protectedHandler(c.req.raw)
		requests.inc({ route: 'mcp', status: String(response.status) })
		return response
	})
	app.get('/mcp', (c) => c.text('Method not allowed.', 405, { Allow: 'POST' }))
	app.delete('/mcp', (c) =>
		c.text('Method not allowed.', 405, { Allow: 'POST' }),
	)

	return app
}
