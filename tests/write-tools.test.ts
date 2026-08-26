import { afterEach, describe, expect, test } from 'bun:test'
import { jwtVerify } from 'jose'
import { sha256Hex } from '../src/request-binding'
import {
	issueAccessToken as accessToken,
	createMcpAppFixture,
	modernMeta,
	mcpRpc as rpc,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import {
	entitlement,
	ids,
	offering,
	pkg,
	project,
	succeeded,
} from './helpers/write-response-fixtures'

const organizationId = ids.organization
const projectId = ids.project
const resourceId = ids.resource

afterEach(stopTestServers)

const toolCases = [
	{
		name: 'manage_products',
		scope: 'catalog:write',
		path: '/v1/internal/mcp/products',
		arguments: { action: 'discover', organizationId, appId: resourceId },
	},
	{
		name: 'manage_entitlements',
		scope: 'catalog:write',
		path: '/v1/internal/mcp/entitlements',
		arguments: {
			action: 'create',
			organizationId,
			idempotencyKey: 'create-entitlement-1',
			projectId,
			lookupKey: 'premium',
		},
	},
	{
		name: 'manage_offerings',
		scope: 'catalog:write',
		path: '/v1/internal/mcp/offerings',
		arguments: {
			action: 'create',
			organizationId,
			idempotencyKey: 'create-offering-1',
			projectId,
			lookupKey: 'default',
		},
	},
	{
		name: 'manage_packages',
		scope: 'catalog:write',
		path: '/v1/internal/mcp/packages',
		arguments: {
			action: 'create',
			organizationId,
			idempotencyKey: 'create-package-1',
			offeringId: resourceId,
			packageType: 'monthly',
			displayName: 'Monthly',
		},
	},
	{
		name: 'create_project',
		scope: 'workspace:write',
		path: '/v1/internal/mcp/projects',
		arguments: {
			organizationId,
			idempotencyKey: 'create-project-1',
			name: 'New Project',
			slug: 'new-project',
		},
	},
	{
		name: 'create_app',
		scope: 'workspace:write',
		path: '/v1/internal/mcp/apps',
		arguments: {
			organizationId,
			idempotencyKey: 'create-app-1',
			projectId,
			name: 'Android App',
			platform: 'android',
			packageName: 'com.example.android',
		},
	},
] as const

describe('MCP controlled write tools', () => {
	test('advertises all tools with safe write annotations', async () => {
		const fixture = await createMcpAppFixture()
		const token = await accessToken(fixture, 'workspace:read')
		const discovery = await rpc(fixture, token, 'server/discover', {
			_meta: modernMeta(),
		})
		const discoveryBody = await discovery.json()
		expect(discovery.status).toBe(200)
		expect(discoveryBody.result?.instructions).toContain(
			'retry the exact same arguments with that same key',
		)
		expect(discoveryBody.result?.instructions).toContain(
			'obtain approval before apply_publish',
		)

		const response = await rpc(fixture, token, 'tools/list', {
			_meta: modernMeta(),
		})
		const body = await response.json()
		expect(response.status).toBe(200)
		const tools = body.result.tools as Array<{
			name: string
			annotations?: Record<string, boolean>
			inputSchema?: {
				properties?: Record<string, { description?: string }>
			}
		}>
		expect(tools.map((tool) => tool.name)).toEqual([
			'get_workspace',
			'get_app_setup',
			'query_analytics',
			'get_catalog',
			...toolCases.map((tool) => tool.name),
		])
		const expectedAnnotations = {
			manage_products: { destructiveHint: true, openWorldHint: true },
			manage_entitlements: { destructiveHint: true, openWorldHint: false },
			manage_offerings: { destructiveHint: true, openWorldHint: false },
			manage_packages: { destructiveHint: true, openWorldHint: false },
			create_project: { destructiveHint: false, openWorldHint: false },
			create_app: { destructiveHint: false, openWorldHint: true },
		}
		for (const [name, expected] of Object.entries(expectedAnnotations)) {
			expect(
				tools.find((tool) => tool.name === name)?.annotations,
			).toMatchObject({
				readOnlyHint: false,
				idempotentHint: true,
				...expected,
			})
		}
		expect(
			tools.find((tool) => tool.name === 'create_project')?.inputSchema
				?.properties?.idempotencyKey?.description,
		).toContain('same key')
	})

	test('binds every write tool to one fixed API route, scope, and body', async () => {
		const calls: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			const authorization = request.headers.get('authorization')
			if (!authorization) throw new Error('Missing internal authorization.')
			const verified = await jwtVerify(
				authorization.slice(7),
				fixture.internalPublicKey,
				{
					issuer: 'appactor-mcp',
					audience: 'appactor-api',
				},
			)
			const body = await request.json()
			calls.push({
				path: new URL(request.url).pathname,
				method: request.method,
				body,
				tool: verified.payload.tool,
				scope: verified.payload.scope,
				bodySha256: verified.payload.body_sha256,
			})

			if (verified.payload.tool === 'manage_products') {
				return Response.json({
					data: { status: 'discovered', platform: 'ios', products: [] },
					requestId: 'request-1',
				})
			}
			if (verified.payload.tool === 'create_app') {
				return Response.json({
					data: {
						status: 'action_required',
						code: 'google_credential_required',
						message: 'Connect Google Play credentials.',
						url: 'https://dashboard.example.com/settings?tab=credentials',
					},
					requestId: 'request-2',
				})
			}
			const data =
				verified.payload.tool === 'manage_entitlements'
					? succeeded('create', { entitlement })
					: verified.payload.tool === 'manage_offerings'
						? succeeded('create', { offering })
						: verified.payload.tool === 'manage_packages'
							? succeeded('create', { package: pkg })
							: succeeded('create', { project })
			return Response.json({ data, requestId: 'request-3' })
		})
		for (const tool of toolCases) {
			const token = await accessToken(fixture, tool.scope)
			const response = await rpc(
				fixture,
				token,
				'tools/call',
				{ name: tool.name, arguments: tool.arguments, _meta: modernMeta() },
				tool.name,
			)
			const body = await response.json()
			expect(response.status).toBe(200)
			expect(body.result?.isError).not.toBe(true)
		}

		expect(calls).toHaveLength(toolCases.length)
		for (const [index, call] of calls.entries()) {
			const expected = toolCases[index]
			expect(call).toMatchObject({
				path: expected.path,
				method: 'POST',
				body: expected.arguments,
				tool: expected.name,
				scope: expected.scope,
			})
			expect(call.bodySha256).toBe(
				await sha256Hex(JSON.stringify(expected.arguments)),
			)
		}
	})

	test('rejects missing write scope even when the routing header is spoofed', async () => {
		let upstreamCalls = 0
		const fixture = await createMcpAppFixture(async () => {
			upstreamCalls += 1
			throw new Error('Write must not reach the API.')
		})
		const readToken = await accessToken(fixture, 'catalog:read')
		const challenge = await rpc(
			fixture,
			readToken,
			'tools/call',
			{
				name: 'manage_products',
				arguments: toolCases[0].arguments,
				_meta: modernMeta(),
			},
			'manage_products',
		)
		expect(challenge.status).toBe(403)

		const workspaceToken = await accessToken(fixture, 'workspace:read')
		const inProtocol = await rpc(
			fixture,
			workspaceToken,
			'tools/call',
			{
				name: 'manage_products',
				arguments: toolCases[0].arguments,
				_meta: modernMeta(),
			},
			'get_workspace',
		)
		const body = await inProtocol.json()
		expect(inProtocol.status).toBe(400)
		expect(body).toBeDefined()
		expect(upstreamCalls).toBe(0)
	})

	test('tells the model to reuse the same idempotency key after an uncertain write', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json(
				{
					error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out.' },
					requestId: 'request-timeout',
				},
				{ status: 504 },
			),
		)
		const token = await accessToken(fixture, 'workspace:write')
		const response = await rpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'create_project',
				arguments: toolCases[4].arguments,
				_meta: modernMeta(),
			},
			'create_project',
		)
		const body = await response.json()
		expect(response.status).toBe(200)
		expect(body.result?.isError).toBe(true)
		expect(body.result?.content?.[0]?.text).toContain('same idempotencyKey')
		expect(body.result?.content?.[0]?.text).toContain(
			'do not generate a new key',
		)
	})
})
