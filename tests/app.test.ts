import { afterEach, describe, expect, test } from 'bun:test'
import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import { createApp } from '../src/app'
import {
	issueAccessToken,
	modernMeta,
	stopTestServers,
	createMcpAppFixture as testConfig,
} from './helpers/mcp-app-fixture'

afterEach(() => {
	stopTestServers()
})

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
			scopes_supported: [
				'workspace:read',
				'analytics:read',
				'catalog:read',
				'catalog:write',
				'workspace:write',
				'workspace:delete',
				'subscribers:read',
				'config:read',
				'config:write',
				'audit:read',
				'refunds:read',
				'refunds:write',
				// Advertised so clients ask for it: without it Better Auth mints no
				// refresh token and the connection dies an hour after approval.
				'offline_access',
			],
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

	test('does not let offline_access stand in for a tool scope', async () => {
		// It is advertised so a client asks for it and gets a refresh token, but
		// it grants no tool: a token carrying only offline_access is still refused.
		const fixture = await testConfig()
		const accessToken = await new SignJWT({
			client_id: 'codex-client',
			scope: 'offline_access',
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
				id: 3,
				method: 'tools/call',
				params: { name: 'get_workspace', arguments: {}, _meta: modernMeta() },
			}),
		})
		expect(response.status).toBe(403)
		expect(response.headers.get('www-authenticate')).toContain('workspace:read')
	})

	test('routes modern analytics and catalog tool calls with their exact scopes', async () => {
		const organizationId = '00000000-0000-4000-8000-000000000001'
		const projectId = '00000000-0000-4000-8000-000000000002'
		const internalCalls: Array<{
			path: string
			method: string
			tool: unknown
			scope: unknown
		}> = []
		const fixture = await testConfig(async (request) => {
			const authorization = request.headers.get('authorization')
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
			const path = new URL(request.url).pathname
			internalCalls.push({
				path,
				method: request.method,
				tool: verified.payload.tool,
				scope: verified.payload.scope,
			})
			if (path.endsWith('/analytics')) {
				return Response.json({
					data: {
						kind: 'overview',
						data: { revenue: 42 },
						generatedAt: '2026-08-26T12:00:00.000Z',
					},
					requestId: 'req-analytics',
				})
			}
			return Response.json({
				data: {
					view: 'offerings',
					data: {
						items: [],
						pagination: { limit: 50, hasMore: false, nextCursor: null },
					},
					generatedAt: '2026-08-26T12:00:00.000Z',
				},
				requestId: 'req-catalog',
			})
		})
		const accessToken = await new SignJWT({
			client_id: 'codex-client',
			scope: 'analytics:read catalog:read',
		})
			.setProtectedHeader({ alg: 'ES256', kid: 'oauth-test' })
			.setIssuer(fixture.config.MCP_AUTH_ISSUER)
			.setAudience(fixture.config.MCP_RESOURCE_URL)
			.setSubject('user-1')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(fixture.oauthKeys.privateKey)

		for (const tool of [
			{
				name: 'query_analytics',
				arguments: { organizationId, kind: 'overview' },
			},
			{
				name: 'get_catalog',
				arguments: { organizationId, projectId, view: 'offerings' },
			},
		]) {
			const response = await fixture.app.request(
				'https://mcp.example.com/mcp',
				{
					method: 'POST',
					headers: {
						authorization: `Bearer ${accessToken}`,
						'content-type': 'application/json',
						'mcp-method': 'tools/call',
						'mcp-name': tool.name,
						'mcp-protocol-version': '2026-07-28',
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: tool.name,
						method: 'tools/call',
						params: {
							name: tool.name,
							arguments: tool.arguments,
							_meta: modernMeta(),
						},
					}),
				},
			)
			expect(response.status).toBe(200)
			const body = await response.json()
			expect(body.result?.isError).not.toBe(true)
		}

		expect(internalCalls).toEqual([
			{
				path: '/v1/internal/mcp/analytics',
				method: 'POST',
				tool: 'query_analytics',
				scope: 'analytics:read catalog:read',
			},
			{
				path: '/v1/internal/mcp/catalog',
				method: 'POST',
				tool: 'get_catalog',
				scope: 'analytics:read catalog:read',
			},
		])
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

	test('serves 2025-era (legacy) clients through the stateless fallback', async () => {
		const fixture = await testConfig()
		const accessToken = await issueAccessToken(fixture, 'workspace:read')
		const legacyRpc = (id: number, method: string, params: unknown) =>
			fixture.app.request('https://mcp.example.com/mcp', {
				method: 'POST',
				headers: {
					authorization: `Bearer ${accessToken}`,
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
				},
				body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
			})

		const initialize = await legacyRpc(1, 'initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'legacy-client', version: '1.0.0' },
		})
		expect(initialize.status).toBe(200)
		const initializeBody = await readJsonRpcBody(initialize)
		expect(initializeBody.result?.protocolVersion).toBe('2025-06-18')
		expect(initializeBody.result?.serverInfo?.name).toBe('appactor-mcp')

		const list = await legacyRpc(2, 'tools/list', {})
		expect(list.status).toBe(200)
		const listBody = await readJsonRpcBody(list)
		expect(
			(listBody.result?.tools as Array<{ name: string }>).map((t) => t.name),
		).toHaveLength(20)
	})

	test('returns 503 instead of 500 when the JWKS endpoint is unreachable', async () => {
		const fixture = await testConfig()
		const app = await createApp({
			...fixture.config,
			MCP_AUTH_JWKS_URL: 'http://127.0.0.1:1/jwks',
		})
		const accessToken = await issueAccessToken(fixture, 'workspace:read')
		const response = await app.request('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${accessToken}`,
				'content-type': 'application/json',
				'mcp-method': 'tools/list',
				'mcp-protocol-version': '2026-07-28',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: { _meta: modernMeta() },
			}),
		})
		expect(response.status).toBe(503)
		expect(response.headers.get('retry-after')).toBe('5')
		expect(await response.json()).toEqual({
			error: 'Authorization server is temporarily unavailable.',
		})
	})

	test('still refuses a token signed by the wrong key while the JWKS is up', async () => {
		// The outage check must not swallow real authentication failures: with the
		// authorization server answering, a bad token is a bad token.
		const fixture = await testConfig()
		const impostor = await generateKeyPair('ES256', { extractable: true })
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
			.sign(impostor.privateKey)

		const response = await fixture.app.request('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${accessToken}`,
				'content-type': 'application/json',
				'mcp-method': 'tools/list',
				'mcp-protocol-version': '2026-07-28',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/list',
				params: { _meta: modernMeta() },
			}),
		})
		expect(response.status).toBe(401)
	})
})

async function readJsonRpcBody(response: Response): Promise<{
	result?: Record<string, unknown> & {
		protocolVersion?: string
		serverInfo?: { name?: string }
		tools?: unknown
	}
}> {
	const text = await response.text()
	if (response.headers.get('content-type')?.includes('text/event-stream')) {
		const data = text
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim())
			.find((line) => line.includes('"result"'))
		if (!data) throw new Error(`No JSON-RPC result in SSE body: ${text}`)
		return JSON.parse(data)
	}
	return JSON.parse(text)
}
