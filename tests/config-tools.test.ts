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

describe('manage_experiments rollout and analysis plan', () => {
	const variantId = ids.resource
	const supersededExperimentId = ids.project
	const experiment = { experimentId, key: 'paywall_test', status: 'stopped' }

	function experimentWrite(action: string, result: Record<string, unknown>) {
		return {
			status: 'succeeded',
			action,
			replayed: false,
			operationId: ids.operation,
			result,
		}
	}

	test('sends rollout_variant to the experiments route exactly as given', async () => {
		const capture: { request?: Request; body?: string } = {}
		const args = {
			action: 'rollout_variant',
			organizationId,
			idempotencyKey,
			experimentId,
			variantId,
			expectedUpdatedAt: timestamp,
		}
		const { fixture, body } = await callTool(
			'manage_experiments',
			'config:write',
			experimentWrite('rollout_variant', {
				experiment,
				supersededExperimentId: null,
			}),
			args,
			capture,
		)

		expect(body.result.isError).toBeUndefined()
		expect(JSON.parse(capture.body ?? '{}')).toEqual(args)
		const authorization = capture.request?.headers.get('authorization') ?? ''
		const { payload: claims } = await jwtVerify(
			authorization.slice(7),
			fixture.internalPublicKey,
			{ issuer: 'appactor-mcp', audience: 'appactor-api' },
		)
		expect(claims.tool).toBe('manage_experiments')
		expect(claims.scope).toBe('config:write')
		expect(claims.target).toBe('/v1/internal/mcp/experiments')
		expect(claims.body_sha256).toBe(await sha256Hex(capture.body))
		expect(body.result.content[0].text).toBe(
			'Experiment rollout_variant succeeded.',
		)
	})

	test('says which run of the key stopped serving when a rollout replaced it', async () => {
		// Only in the structured half otherwise, so a text-only client would never
		// learn that the other run's rollout ended.
		const { body } = await callTool(
			'manage_experiments',
			'config:write',
			experimentWrite('rollout_variant', {
				experiment,
				supersededExperimentId,
			}),
			{
				action: 'rollout_variant',
				organizationId,
				idempotencyKey,
				experimentId,
				variantId,
			},
		)
		expect(body.result.content[0].text).toBe(
			`Experiment rollout_variant succeeded. It replaced the rollout of experiment ${supersededExperimentId}, another run of the same key, which no longer serves a variant.`,
		)
	})

	test('sends clear_rollout with only the experiment it names', async () => {
		const capture: { request?: Request; body?: string } = {}
		const args = {
			action: 'clear_rollout',
			organizationId,
			idempotencyKey,
			experimentId,
		}
		const { body } = await callTool(
			'manage_experiments',
			'config:write',
			experimentWrite('clear_rollout', { experiment }),
			args,
			capture,
		)
		expect(body.result.isError).toBeUndefined()
		expect(JSON.parse(capture.body ?? '{}')).toEqual(args)
		expect(body.result.content[0].text).toBe(
			'Experiment clear_rollout succeeded.',
		)
	})

	test('passes newUsersOnly and the whale cap through create', async () => {
		const capture: { request?: Request; body?: string } = {}
		await callTool(
			'manage_experiments',
			'config:write',
			experimentWrite('create', { experiment }),
			{
				action: 'create',
				organizationId,
				idempotencyKey,
				appId: configId,
				key: 'paywall_test',
				newUsersOnly: true,
				whaleCapCents: 25000,
			},
			capture,
		)
		expect(JSON.parse(capture.body ?? '{}')).toMatchObject({
			action: 'create',
			newUsersOnly: true,
			whaleCapCents: 25000,
		})
	})

	test('defaults newUsersOnly on create as the API does and leaves the whale cap unset', async () => {
		const capture: { request?: Request; body?: string } = {}
		await callTool(
			'manage_experiments',
			'config:write',
			experimentWrite('create', { experiment }),
			{
				action: 'create',
				organizationId,
				idempotencyKey,
				appId: configId,
				key: 'paywall_test',
			},
			capture,
		)
		const sent = JSON.parse(capture.body ?? '{}')
		expect(sent.newUsersOnly).toBe(false)
		expect('whaleCapCents' in sent).toBe(false)
	})

	test('keeps an explicit null whale cap on update and adds nothing it was not sent', async () => {
		// null resets the cap to the default; an absent key leaves it alone. A
		// defaulted newUsersOnly here would silently rewrite the audience rule.
		const capture: { request?: Request; body?: string } = {}
		const args = {
			action: 'update',
			organizationId,
			idempotencyKey,
			experimentId,
			whaleCapCents: null,
		}
		await callTool(
			'manage_experiments',
			'config:write',
			experimentWrite('update', { experiment }),
			args,
			capture,
		)
		expect(JSON.parse(capture.body ?? '{}')).toEqual(args)
	})

	test('refuses a rollout the API would reject without calling it', async () => {
		let upstreamCalls = 0
		const fixture = await createMcpAppFixture(async () => {
			upstreamCalls += 1
			throw new Error('manage_experiments must not reach the API.')
		})
		const token = await accessToken(fixture, 'config:write')
		for (const args of [
			// Weights are not how a winner ships.
			{
				action: 'rollout_variant',
				organizationId,
				idempotencyKey,
				experimentId,
				variantId,
				weightBp: 10000,
			},
			{
				action: 'rollout_variant',
				organizationId,
				idempotencyKey,
				experimentId,
			},
			{
				action: 'clear_rollout',
				organizationId,
				idempotencyKey,
				experimentId,
				variantId,
			},
		]) {
			const response = await rpc(
				fixture,
				token,
				'tools/call',
				{ name: 'manage_experiments', arguments: args, _meta: modernMeta() },
				'manage_experiments',
			)
			const body = await response.json()
			expect(body.result.isError).toBe(true)
			expect(body.result.content[0].text).toContain('Input validation error')
		}
		expect(upstreamCalls).toBe(0)
	})

	test('describes the plan lock, the rollout, and how to read a verdict', async () => {
		const fixture = await createMcpAppFixture()
		const token = await accessToken(fixture, 'workspace:read')
		const response = await rpc(fixture, token, 'tools/list', {
			_meta: modernMeta(),
		})
		const body = await response.json()
		const tools = body.result.tools as Array<{
			name: string
			description: string
			inputSchema: unknown
		}>
		const manage = tools.find((tool) => tool.name === 'manage_experiments')
		for (const phrase of [
			'409 EXPERIMENT_ANALYSIS_PLAN_LOCKED',
			'use rollout_variant, never new weights',
			'every user it already assigned',
			'clear_rollout stops serving the variant',
			'Starting, pausing, resuming or stopping an experiment, rolling a variant out and clearing a rollout all change what live customers see, so confirm with the user first.',
			'Never clear a rollout to return the experiment to draft',
			'results.decision',
			'roughly day 14',
			'roughly day 37',
			'srm_mismatch',
		]) {
			expect(manage?.description).toContain(phrase)
		}
		// Results are read through get_config, so it carries the same reading rule.
		expect(
			tools.find((tool) => tool.name === 'get_config')?.description,
		).toContain('earliestVerdictAt')
		expect(JSON.stringify(manage?.inputSchema)).toContain(
			'Editable only before the first assignment',
		)
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

	test('rejects variant weights that do not sum to 10000', () => {
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				action: 'replace_variant_weights',
				organizationId,
				idempotencyKey,
				experimentId,
				expectedVariants: [{ id: configId, weightBp: 10000 }],
				variants: [
					{ id: configId, weightBp: 3000 },
					{ id: experimentId, weightBp: 3000 },
				],
			}),
		).toThrow()
		expect(
			ManageExperimentsRequestSchema.parse({
				action: 'replace_variant_weights',
				organizationId,
				idempotencyKey,
				experimentId,
				expectedVariants: [],
				variants: [
					{ id: configId, weightBp: 4000 },
					{ id: experimentId, weightBp: 6000 },
				],
			}),
		).toBeTruthy()
	})

	test('does not advertise a variant weight the API would reject', () => {
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				action: 'update_variant',
				organizationId,
				idempotencyKey,
				experimentId,
				variantId: configId,
				weightBp: 5000,
			}),
		).toThrow()
	})

	test('rejects duplicate platform overrides', () => {
		expect(() =>
			ManageRemoteConfigRequestSchema.parse({
				action: 'create_scope_set',
				organizationId,
				idempotencyKey,
				projectId: configId,
				key: 'k',
				valueType: 'string',
				defaultValue: 'a',
				platformOverrides: [
					{ platform: 'ios', defaultValue: 'a' },
					{ platform: 'ios', defaultValue: 'b' },
				],
			}),
		).toThrow()
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

	test('bounds the whale cap exactly as the API does', () => {
		const create = {
			action: 'create',
			organizationId,
			idempotencyKey,
			appId: configId,
			key: 'paywall_test',
		}
		for (const whaleCapCents of [0, 1_000_000_001, 1.5, '50000']) {
			expect(() =>
				ManageExperimentsRequestSchema.parse({ ...create, whaleCapCents }),
			).toThrow()
		}
		for (const whaleCapCents of [1, 1_000_000_000, null]) {
			expect(
				ManageExperimentsRequestSchema.parse({ ...create, whaleCapCents }),
			).toMatchObject({ whaleCapCents })
		}
	})

	test('rollout actions are strict and need their ids', () => {
		const rollout = {
			action: 'rollout_variant' as const,
			organizationId,
			idempotencyKey,
			experimentId,
			variantId: configId,
		}
		expect(ManageExperimentsRequestSchema.parse(rollout)).toEqual(rollout)
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				...rollout,
				variantId: 'control',
			}),
		).toThrow()
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				...rollout,
				idempotencyKey: undefined,
			}),
		).toThrow()
		expect(() =>
			ManageExperimentsRequestSchema.parse({
				...rollout,
				expectedUpdatedAt: 'yesterday',
			}),
		).toThrow()
		const clear = {
			action: 'clear_rollout' as const,
			organizationId,
			idempotencyKey,
			experimentId,
			expectedUpdatedAt: timestamp,
		}
		expect(ManageExperimentsRequestSchema.parse(clear)).toEqual(clear)
		expect(() =>
			ManageExperimentsRequestSchema.parse({ ...clear, force: true }),
		).toThrow()
	})

	test('defaults the audit scope to the caller own MCP operations', () => {
		expect(AuditRequestSchema.parse({ organizationId })).toEqual({
			organizationId,
			source: 'mcp',
			scope: 'mine',
			limit: 50,
		})
	})

	test('can ask for what people changed in the dashboard instead', () => {
		// The organization-wide dashboard audit log is real; the tool used to
		// deny it existed and had no way to request it.
		const parsed = AuditRequestSchema.parse({
			organizationId,
			source: 'dashboard',
		})
		expect(parsed.source).toBe('dashboard')
	})
})
