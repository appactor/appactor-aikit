import { afterEach, describe, expect, test } from 'bun:test'
import { jwtVerify } from 'jose'
import {
	AuditRequestSchema,
	ConfigRequestSchema,
	ManageExperimentsRequestSchema,
	ManageRemoteConfigRequestSchema,
} from '../src/contracts/config'
import { sha256Hex } from '../src/request-binding'
import {
	issueAccessToken as accessToken,
	createMcpAppFixture,
	modernMeta,
	mcpRpc as rpc,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import { ids, timestamp } from './helpers/write-response-fixtures'

afterEach(stopTestServers)

const organizationId = ids.organization
const configId = ids.resource
const experimentId = ids.secondary
const idempotencyKey = 'config-request-1'

function apiFixture(
	payload: unknown,
	capture?: { request?: Request; body?: string },
) {
	return async (request: Request) => {
		const clone = request.clone()
		if (capture) {
			capture.request = request
			capture.body = await clone.text()
		}
		return Response.json({ data: payload, requestId: 'req-1' })
	}
}

async function callTool(
	toolName: string,
	scope: string,
	payload: unknown,
	args: Record<string, unknown>,
	capture?: { request?: Request; body?: string },
) {
	const fixture = await createMcpAppFixture(apiFixture(payload, capture))
	const token = await accessToken(fixture, scope)
	const response = await rpc(
		fixture,
		token,
		'tools/call',
		{ name: toolName, arguments: args, _meta: modernMeta() },
		toolName,
	)
	return { fixture, response, body: await response.json() }
}

describe('get_config tool', () => {
	test('reads remote config detail and binds the token to the config route', async () => {
		const capture: { request?: Request; body?: string } = {}
		const payload = {
			view: 'remote_config',
			data: {
				config: {
					configId,
					key: 'show_trial',
					updatedAt: timestamp,
					rules: [],
				},
				sameKeyConfigs: [],
			},
			generatedAt: timestamp,
		}
		const { fixture, body } = await callTool(
			'get_config',
			'config:read',
			payload,
			{ view: 'remote_config', organizationId, configId },
			capture,
		)

		expect(body.result.isError).toBeUndefined()
		expect(body.result.structuredContent).toEqual(payload)
		expect(new URL(capture.request?.url ?? '').pathname).toBe(
			'/v1/internal/mcp/config',
		)

		const authorization = capture.request?.headers.get('authorization') ?? ''
		const { payload: claims } = await jwtVerify(
			authorization.slice(7),
			fixture.internalPublicKey,
			{
				issuer: 'appactor-mcp',
				audience: 'appactor-api',
			},
		)
		expect(claims.tool).toBe('get_config')
		expect(claims.scope).toBe('config:read')
		expect(claims.target).toBe('/v1/internal/mcp/config')
		expect(claims.body_sha256).toBe(await sha256Hex(capture.body))
	})

	test('sends the defaulted result mode for experiment reads', async () => {
		const capture: { request?: Request; body?: string } = {}
		await callTool(
			'get_config',
			'config:read',
			{ view: 'experiments', data: { items: [] }, generatedAt: timestamp },
			{ view: 'experiments', organizationId },
			capture,
		)
		expect(JSON.parse(capture.body ?? '{}')).toEqual({
			view: 'experiments',
			organizationId,
			resultMode: 'lifetime_cohort',
			includeResults: true,
			limit: 50,
		})
	})

	test('requires config:read', async () => {
		const fixture = await createMcpAppFixture()
		const token = await accessToken(fixture, 'workspace:read')
		const response = await rpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_config',
				arguments: { view: 'remote_configs', organizationId },
				_meta: modernMeta(),
			},
			'get_config',
		)
		expect(response.status).toBe(403)
		expect(response.headers.get('www-authenticate')).toContain('config:read')
	})
})

describe('get_audit_log tool', () => {
	test('summarises the operation count and the scope it read', async () => {
		const { body } = await callTool(
			'get_audit_log',
			'audit:read',
			{
				view: 'mcp_write_operations',
				scope: 'mine',
				data: {
					items: [
						{
							operationId: ids.operation,
							tool: 'manage_offerings',
							status: 'succeeded',
						},
					],
					pagination: { limit: 50, hasMore: false, nextCursor: null },
				},
				generatedAt: timestamp,
			},
			{ organizationId },
		)
		expect(body.result.content[0].text).toBe(
			'1 MCP write operation(s) in the mine scope.',
		)
	})

	test('surfaces the permission failure for the organization scope', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json(
				{
					error: {
						code: 'FORBIDDEN',
						message: 'You do not have permission to manage this team.',
					},
					requestId: 'req-2',
				},
				{ status: 403 },
			),
		)
		const token = await accessToken(fixture, 'audit:read')
		const response = await rpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_audit_log',
				arguments: { organizationId, scope: 'organization' },
				_meta: modernMeta(),
			},
			'get_audit_log',
		)
		const body = await response.json()
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0].text).toContain(
			'permission to manage this team',
		)
	})
})

describe('config write tools', () => {
	const succeeded = {
		status: 'succeeded',
		action: 'update',
		replayed: false,
		operationId: ids.operation,
		result: { config: { configId, key: 'show_trial' } },
	}

	test('routes a remote config update and reports the action', async () => {
		const capture: { request?: Request; body?: string } = {}
		const { body } = await callTool(
			'manage_remote_config',
			'config:write',
			succeeded,
			{
				action: 'update',
				organizationId,
				idempotencyKey,
				configId,
				expectedUpdatedAt: timestamp,
				isActive: false,
			},
			capture,
		)
		expect(new URL(capture.request?.url ?? '').pathname).toBe(
			'/v1/internal/mcp/remote-config',
		)
		expect(body.result.content[0].text).toBe('Remote config update succeeded.')
	})

	test('marks a replayed write so the model does not double-report it', async () => {
		const { body } = await callTool(
			'manage_experiments',
			'config:write',
			{ ...succeeded, action: 'set_status_start', replayed: true },
			{
				action: 'set_status',
				organizationId,
				idempotencyKey,
				experimentId,
				status: 'start',
			},
		)
		expect(body.result.content[0].text).toBe(
			'Experiment set_status_start succeeded (replayed).',
		)
	})

	test('tells the model to reuse the idempotency key after an uncertain failure', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json(
				{
					error: {
						code: 'TEMPORARY_UNAVAILABLE',
						message: 'The operation outcome could not be confirmed.',
					},
				},
				{ status: 503 },
			),
		)
		const token = await accessToken(fixture, 'config:write')
		const response = await rpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_experiments',
				arguments: {
					action: 'set_status',
					organizationId,
					idempotencyKey,
					experimentId,
					status: 'stop',
				},
				_meta: modernMeta(),
			},
			'manage_experiments',
		)
		const body = await response.json()
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0].text).toContain('same idempotencyKey')
	})

	test('requires config:write for both write tools', async () => {
		for (const name of ['manage_remote_config', 'manage_experiments']) {
			const fixture = await createMcpAppFixture()
			const token = await accessToken(fixture, 'config:read')
			const response = await rpc(
				fixture,
				token,
				'tools/call',
				{ name, arguments: { organizationId }, _meta: modernMeta() },
				name,
			)
			expect(response.status).toBe(403)
			expect(response.headers.get('www-authenticate')).toContain('config:write')
		}
	})

	test('advertises reads as read-only and writes as destructive', async () => {
		const fixture = await createMcpAppFixture()
		const token = await accessToken(fixture, 'workspace:read')
		const response = await rpc(fixture, token, 'tools/list', {
			_meta: modernMeta(),
		})
		const body = await response.json()
		const tools = body.result.tools as Array<{
			name: string
			annotations: Record<string, boolean>
		}>
		for (const name of ['get_config', 'get_audit_log']) {
			expect(
				tools.find((tool) => tool.name === name)?.annotations,
			).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
			})
		}
		for (const name of ['manage_remote_config', 'manage_experiments']) {
			expect(
				tools.find((tool) => tool.name === name)?.annotations,
			).toMatchObject({
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			})
		}
	})
})

describe('config contracts', () => {
	test('rejects unknown fields on reads and writes', () => {
		expect(() =>
			ConfigRequestSchema.parse({
				view: 'remote_configs',
				organizationId,
				orderBy: 'key',
			}),
		).toThrow()
		expect(() =>
			AuditRequestSchema.parse({ organizationId, actorUserId: 'user-1' }),
		).toThrow()
		expect(() =>
			ManageRemoteConfigRequestSchema.parse({
				action: 'create',
				organizationId,
				idempotencyKey,
				projectId: configId,
				key: 'k',
				valueType: 'string',
				defaultValue: 'a',
				force: true,
			}),
		).toThrow()
	})

	test('requires the optimistic concurrency token on remote config updates', () => {
		expect(() =>
			ManageRemoteConfigRequestSchema.parse({
				action: 'update',
				organizationId,
				idempotencyKey,
				configId,
				isActive: false,
			}),
		).toThrow()
	})

	test('exposes no delete action on either write tool', () => {
		expect(() =>
			ManageRemoteConfigRequestSchema.parse({
				action: 'delete',
				organizationId,
				idempotencyKey,
				configId,
			}),
		).toThrow()
		for (const action of ['delete', 'delete_variant']) {
			expect(() =>
				ManageExperimentsRequestSchema.parse({
					action,
					organizationId,
					idempotencyKey,
					experimentId,
				}),
			).toThrow()
		}
	})

	test('bounds variant weights and traffic allocation in basis points', () => {
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				action: 'create',
				organizationId,
				idempotencyKey,
				appId: configId,
				key: 'paywall_test',
				trafficAllocationBp: 10001,
			}),
		).toThrow()
	})

	test('accepts only real primary metrics for goals', () => {
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				action: 'create',
				organizationId,
				idempotencyKey,
				appId: configId,
				key: 'paywall_test',
				goals: [{ key: 'primary', type: 'vibes', isPrimary: true }],
			}),
		).toThrow()
	})

	test('defaults the audit scope to the caller own operations', () => {
		expect(AuditRequestSchema.parse({ organizationId })).toEqual({
			organizationId,
			scope: 'mine',
			limit: 50,
		})
	})
})
