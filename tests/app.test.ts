import { afterEach, describe, expect, test } from 'bun:test'
import {
	SignJWT,
	exportJWK,
	exportPKCS8,
	generateKeyPair,
	jwtVerify,
} from 'jose'
import { createApp } from '../src/app'
import type { Config } from '../src/config'

const activeServers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
	for (const server of activeServers.splice(0)) server.stop(true)
})

async function testConfig(fetcher?: (request: Request) => Promise<Response>) {
	const oauthKeys = await generateKeyPair('ES256', { extractable: true })
	const internalKeys = await generateKeyPair('ES256', { extractable: true })
	const jwk = await exportJWK(oauthKeys.publicKey)
	Object.assign(jwk, { alg: 'ES256', kid: 'oauth-test', use: 'sig' })
	const jwks = Bun.serve({
		port: 0,
		fetch: () => Response.json({ keys: [jwk] }),
	})
	activeServers.push(jwks)

	const config: Config = {
		NODE_ENV: 'test',
		PORT: 3100,
		LOG_LEVEL: 'error',
		MCP_RESOURCE_URL: 'https://mcp.example.com/mcp',
		MCP_AUTH_ISSUER: 'https://auth.example.com',
		MCP_AUTH_JWKS_URL: new URL('/jwks', jwks.url).toString(),
		APPACTOR_API_URL: 'https://api.example.com',
		MCP_INTERNAL_JWT_PRIVATE_KEY: await exportPKCS8(internalKeys.privateKey),
		MCP_INTERNAL_JWT_KEY_ID: 'internal-test',
		MCP_INTERNAL_JWT_ISSUER: 'appactor-mcp',
		MCP_INTERNAL_JWT_AUDIENCE: 'appactor-api',
		APPACTOR_API_TIMEOUT_MS: 1_000,
	}
	return {
		app: await createApp(
			config,
			(fetcher ??
				(() =>
					Promise.reject(new Error('Unexpected API call')))) as typeof fetch,
		),
		config,
		oauthKeys,
		internalPublicKey: internalKeys.publicKey,
	}
}

function modernMeta() {
	return {
		'io.modelcontextprotocol/protocolVersion': '2026-07-28',
		'io.modelcontextprotocol/clientCapabilities': {},
	}
}

describe('MCP HTTP app', () => {
	test('serves health and rejects non-POST MCP session operations', async () => {
		const { app } = await testConfig()
		expect(
			await (await app.request('https://mcp.example.com/health')).json(),
		).toEqual({ status: 'ok' })
		const response = await app.request('https://mcp.example.com/mcp')
		expect(response.status).toBe(405)
		expect(response.headers.get('allow')).toBe('POST')
		expect(
			(
				await app.request('https://mcp.example.com/health', {
					headers: { cookie: 'session=must-not-reach-mcp' },
				})
			).status,
		).toBe(400)
	})

	test('rejects an invalid private key before serving traffic', async () => {
		const fixture = await testConfig()
		await expect(
			createApp({
				...fixture.config,
				MCP_INTERNAL_JWT_PRIVATE_KEY: 'not-a-private-key',
			}),
		).rejects.toBeDefined()
	})

	test('returns an OAuth discovery challenge when no token is provided', async () => {
		const { app, config } = await testConfig()
		const response = await app.request('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: { _meta: modernMeta() },
			}),
		})
		expect(response.status).toBe(401)
		const challenge = response.headers.get('www-authenticate') ?? ''
		const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1]
		expect(metadataUrl).toBe(
			'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
		)
		if (!metadataUrl)
			throw new Error('Missing protected resource metadata URL.')
		const metadataResponse = await app.request(metadataUrl)
		expect(metadataResponse.status).toBe(200)
		expect(await metadataResponse.json()).toEqual({
			resource: config.MCP_RESOURCE_URL,
			authorization_servers: [config.MCP_AUTH_ISSUER],
			bearer_methods_supported: ['header'],
			scopes_supported: ['workspace:read'],
		})
		expect(
			(
				await app.request(metadataUrl, {
					method: 'HEAD',
				})
			).status,
		).toBe(200)
	})

	test('returns an insufficient-scope challenge before running a tool', async () => {
		const fixture = await testConfig()
		const accessToken = await new SignJWT({
			client_id: 'codex-client',
			scope: 'analytics:read',
		})
			.setProtectedHeader({ alg: 'ES256', kid: 'oauth-test' })
			.setIssuer(fixture.config.MCP_AUTH_ISSUER)
			.setAudience(fixture.config.MCP_RESOURCE_URL)
			.setSubject('user-1')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(fixture.oauthKeys.privateKey)

		const response = await fixture.app.request('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${accessToken}`,
				'content-type': 'application/json',
				'mcp-method': 'tools/call',
				'mcp-name': 'get_workspace',
				'mcp-protocol-version': '2026-07-28',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'get_workspace', arguments: {}, _meta: modernMeta() },
			}),
		})
		expect(response.status).toBe(403)
		expect(response.headers.get('www-authenticate')).toContain(
			'insufficient_scope',
		)
		expect(response.headers.get('www-authenticate')).toContain('workspace:read')
	})

	test('authenticates a modern tool call and signs the exact internal operation', async () => {
		const organizationId = '00000000-0000-4000-8000-000000000001'
		let internalClaims: Record<string, unknown> | undefined
		const fixture = await testConfig(async (request) => {
			const authorization = request.headers.get('authorization')
			expect(authorization).toStartWith('Bearer ')
			if (!authorization)
				throw new Error('Expected internal authorization header.')
			const verified = await jwtVerify(
				authorization.slice(7),
				fixture.internalPublicKey,
				{
					issuer: 'appactor-mcp',
					audience: 'appactor-api',
				},
			)
			internalClaims = verified.payload
			expect(new URL(request.url).pathname).toBe('/v1/internal/mcp/workspace')
			return Response.json({
				data: {
					organizations: [
						{ id: organizationId, name: 'Acme', slug: 'acme', role: 'owner' },
					],
					selectedOrganization: {
						id: organizationId,
						name: 'Acme',
						slug: 'acme',
						role: 'owner',
						access: {
							accountPermissions: ['analytics.read'],
							projectAccessMode: 'all_projects',
							projectPermissions: ['project.view'],
							projectPermissionsByProject: [],
						},
					},
					projects: [],
					apps: [],
					appsPagination: { limit: 100, hasMore: false, nextCursor: null },
				},
				requestId: 'req-1',
			})
		})
		const accessToken = await new SignJWT({
			client_id: 'codex-client',
			scope: 'workspace:read',
		})
			.setProtectedHeader({ alg: 'ES256', kid: 'oauth-test' })
			.setIssuer(fixture.config.MCP_AUTH_ISSUER)
			.setAudience(fixture.config.MCP_RESOURCE_URL)
			.setSubject('user-1')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(fixture.oauthKeys.privateKey)

		const response = await fixture.app.request('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${accessToken}`,
				'content-type': 'application/json',
				'mcp-method': 'tools/call',
				'mcp-name': 'get_workspace',
				'mcp-protocol-version': '2026-07-28',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 7,
				method: 'tools/call',
				params: {
					name: 'get_workspace',
					arguments: { organizationId },
					_meta: modernMeta(),
				},
			}),
		})
		const body = await response.json()
		expect(response.status).toBe(200)
		expect(body.result?.structuredContent?.organizations?.[0]?.name).toBe(
			'Acme',
		)
		expect(internalClaims).toMatchObject({
			sub: 'user-1',
			client_id: 'codex-client',
			scope: 'workspace:read',
			tool: 'get_workspace',
			method: 'GET',
			target: `/v1/internal/mcp/workspace?appLimit=100&organizationId=${organizationId}`,
		})
	})
})
