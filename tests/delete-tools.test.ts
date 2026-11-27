import { afterEach, describe, expect, test } from 'bun:test'
import { TOOL_SCOPES } from '../src/scopes'
import {
	createMcpAppFixture,
	issueAccessToken,
	mcpRpc,
	modernMeta,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import {
	appDeleteImpact,
	appleAdsAdGroupDeleteImpact,
	appleAdsDeleteOutcome,
	appleAdsDeletePreview,
	deleteOutcome,
	deletePreview,
	ids,
	projectDeleteImpact,
	succeeded,
} from './helpers/write-response-fixtures'

afterEach(stopTestServers)

const previewArguments = {
	action: 'preview',
	organizationId: ids.organization,
	projectId: ids.project,
} as const

const campaignPreview = {
	organizationId: ids.organization,
	action: 'preview',
	campaignId: 101,
} as const

const adGroupPreview = {
	organizationId: ids.organization,
	action: 'preview',
	adGroupId: 201,
} as const

const appleAdsApply = {
	organizationId: ids.organization,
	action: 'apply',
	idempotencyKey: 'delete-campaign-apply-1',
	previewToken: 'p'.repeat(48),
} as const

describe('MCP delete tools', () => {
	for (const [tool, args] of [
		['delete_project', previewArguments],
		[
			'delete_app',
			{
				action: 'preview',
				organizationId: ids.organization,
				appId: ids.resource,
			},
		],
		['delete_apple_ads_campaign', campaignPreview],
		['delete_apple_ads_adgroup', adGroupPreview],
	] as const) {
		test(`a write scope does not carry ${tool} with it`, async () => {
			// The whole point of a separate scope: a connection approved before deletion existed must not
			// gain it silently, and the refusal has to happen before the API is ever called. The Apple Ads
			// deletes used to sit under workspace:write, which every connection that created an app holds.
			let upstreamCalls = 0
			const fixture = await createMcpAppFixture(async () => {
				upstreamCalls += 1
				throw new Error('Delete must not reach the API.')
			})
			const writeToken = await issueAccessToken(fixture, 'workspace:write')
			const response = await mcpRpc(
				fixture,
				writeToken,
				'tools/call',
				{ name: tool, arguments: args, _meta: modernMeta() },
				tool,
			)
			expect(response.status).toBe(403)
			// Naming the scope in the challenge is what sends the client back through consent. Asserting it
			// also pins the TOOL_SCOPES mapping: drop a delete tool from it and requiredScopeForRequest
			// falls back to workspace:read, which this same token would still be refused for -- a green
			// test over a broken mapping.
			expect(response.headers.get('www-authenticate')).toContain(
				'workspace:delete',
			)
			expect(upstreamCalls).toBe(0)
		})
	}

	test('every registered tool has a scope mapped to it', async () => {
		// The fallback for an unmapped tool is workspace:read, which nearly every connection holds, so
		// a tool that slips out of the map keeps working at the edge and quietly loses its challenge.
		const fixture = await createMcpAppFixture()
		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(fixture, token, 'tools/list', {
			_meta: modernMeta(),
		})
		const body = await response.json()
		const names = (body.result.tools as Array<{ name: string }>).map(
			(tool) => tool.name,
		)
		expect(names.length).toBeGreaterThan(0)
		expect(names.filter((name) => !(name in TOOL_SCOPES))).toEqual([])
	})

	test('the preview summary spells out the blast radius and who must confirm', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: deletePreview('project', 'AnimalSound'),
				requestId: 'request-preview',
			}),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_project',
				arguments: previewArguments,
				_meta: modernMeta(),
			},
			'delete_project',
		)
		const body = await response.json()
		expect(response.status).toBe(200)
		expect(body.result?.isError).not.toBe(true)
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('"AnimalSound"')
		expect(text).toContain('2 app(s)')
		expect(text).toContain('4 product(s)')
		// Categories that a count-only summary used to leave out entirely.
		expect(text).toContain('2 remote config(s)')
		expect(text).toContain('1 project secret key(s)')
		expect(text).toContain('analytics history is permanently purged')
		// The apps are named, not just counted: "2 app(s)" cannot tell staging from production.
		expect(text).toContain('Apps: Example App, Example App Android.')
		// Bounded counts have to read as a floor, not as the exact number.
		expect(text).toContain('10000+ transaction(s)')
		expect(text).toContain('cannot be undone')
		expect(text).toContain('STOP HERE')
		expect(text).toContain('LATER turn')
		// The token has to survive into the structured payload or apply has nothing to send.
		expect(body.result?.structuredContent?.previewToken).toBe('p'.repeat(48))
		// Handing back a field named like the request's own confirmName is what makes a model copy it.
		expect(body.result?.structuredContent).not.toHaveProperty('confirmName')
	})

	test('an app preview reads differently from a project preview', async () => {
		// An app delete leaves the project's entitlements, offerings and packages standing. Padding its
		// one sentence with three "0 (s)" clauses buries the numbers that matter, and claiming the
		// catalog dies would be wrong -- what actually goes is this app's bindings inside it.
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: deletePreview('app', 'AnimalSound iOS'),
				requestId: 'request-app-preview',
			}),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_app',
				arguments: {
					action: 'preview',
					organizationId: ids.organization,
					appId: ids.resource,
				},
				_meta: modernMeta(),
			},
			'delete_app',
		)
		const body = await response.json()
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('3 package binding(s)')
		expect(text).toContain('2 entitlement binding(s)')
		expect(text).not.toContain('offering(s)')
		expect(text).not.toContain('0 package(s)')
		// The sentence already opens by naming the app; repeating it as an "Apps:" clause says nothing.
		expect(text).not.toContain('Apps:')
		expect(body.result?.structuredContent?.impact).toEqual(appDeleteImpact)
	})

	test('reports an already-deleted target as done rather than as an error', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: deleteOutcome('app', 'AnimalSound iOS', { alreadyAbsent: true }),
				requestId: 'request-absent',
			}),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_app',
				arguments: {
					action: 'apply',
					organizationId: ids.organization,
					idempotencyKey: 'delete-app-retry-1',
					previewToken: 'p'.repeat(48),
					confirmName: 'AnimalSound iOS',
				},
				_meta: modernMeta(),
			},
			'delete_app',
		)
		const body = await response.json()
		expect(response.status).toBe(200)
		expect(body.result?.isError).not.toBe(true)
		expect(body.result?.content?.[0]?.text).toContain('was already deleted')
	})

	test('passes confirmName through untouched instead of substituting a known-good one', async () => {
		// The API compares confirmName against the name signed into the token, so the tool must not
		// "helpfully" replace what the caller sent. The name here is deliberately WRONG: if the tool
		// ever substituted the preview's name, this assertion would still see 'AnimalSound' and the
		// test would pass over a real defect.
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: deleteOutcome('project', 'AnimalSound'),
				requestId: 'request-apply',
			})
		})
		const token = await issueAccessToken(fixture, 'workspace:delete')
		await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_project',
				arguments: {
					action: 'apply',
					organizationId: ids.organization,
					idempotencyKey: 'delete-project-apply-1',
					previewToken: 'p'.repeat(48),
					confirmName: 'animalsound (typed wrong)',
				},
				_meta: modernMeta(),
			},
			'delete_project',
		)
		expect(bodies).toHaveLength(1)
		expect(bodies[0]).toMatchObject({
			action: 'apply',
			confirmName: 'animalsound (typed wrong)',
			previewToken: 'p'.repeat(48),
		})
	})

	test('tells the model to reuse the key when an apply times out', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json(
				{
					error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out.' },
					requestId: 'request-timeout',
				},
				{ status: 504 },
			),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_project',
				arguments: {
					action: 'apply',
					organizationId: ids.organization,
					idempotencyKey: 'delete-project-timeout-1',
					previewToken: 'p'.repeat(48),
					confirmName: 'AnimalSound',
				},
				_meta: modernMeta(),
			},
			'delete_project',
		)
		const body = await response.json()
		expect(body.result?.isError).toBe(true)
		expect(body.result?.content?.[0]?.text).toContain('same idempotencyKey')
	})

	describe('Apple Ads campaign and ad group deletes', () => {
		test('the campaign preview names the target, its cascade and who must confirm', async () => {
			const fixture = await createMcpAppFixture(async () =>
				Response.json({
					data: appleAdsDeletePreview('campaign', 'Brand US'),
					requestId: 'request-asa-preview',
				}),
			)
			const token = await issueAccessToken(fixture, 'workspace:delete')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'delete_apple_ads_campaign',
					arguments: campaignPreview,
					_meta: modernMeta(),
				},
				'delete_apple_ads_campaign',
			)
			const body = await response.json()
			expect(response.status).toBe(200)
			expect(body.result?.isError).not.toBe(true)
			const text = body.result?.content?.[0]?.text as string
			expect(text).toContain(
				'campaign "Brand US" (ID 101, ENABLED, daily budget 50 EUR)',
			)
			expect(text).toContain('3 ad group(s)')
			// Apple's cascade sentence comes from the API, not restated here.
			expect(text).toContain('together with its ad groups, keywords and ads')
			expect(text).toContain('cannot be undone')
			expect(text).toContain('STOP HERE')
			expect(text).toContain('LATER turn')
			expect(body.result?.structuredContent?.previewToken).toBe('p'.repeat(48))
			expect(body.result?.structuredContent).not.toHaveProperty('confirmName')
		})

		test('the ad group preview names its campaign and reads a bounded count as a floor', async () => {
			const fixture = await createMcpAppFixture(async () =>
				Response.json({
					data: appleAdsDeletePreview('adgroup', 'Exact Match'),
					requestId: 'request-asa-adgroup-preview',
				}),
			)
			const token = await issueAccessToken(fixture, 'workspace:delete')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'delete_apple_ads_adgroup',
					arguments: adGroupPreview,
					_meta: modernMeta(),
				},
				'delete_apple_ads_adgroup',
			)
			const body = await response.json()
			const text = body.result?.content?.[0]?.text as string
			expect(text).toContain('ad group "Exact Match" (ID 201, PAUSED)')
			expect(text).toContain('in campaign "Brand US"')
			expect(text).toContain('1000+ targeting keyword(s)')
			expect(text).toContain('STOP HERE')
			expect(body.result?.structuredContent?.impact).toEqual(
				appleAdsAdGroupDeleteImpact,
			)
		})

		test('apply sends previewToken and confirmName untouched, and no entity id', async () => {
			// Wrong on purpose, as in the project test: a tool that substituted the preview's name
			// would still be caught.
			const bodies: Array<Record<string, unknown>> = []
			const fixture = await createMcpAppFixture(async (request) => {
				bodies.push((await request.json()) as Record<string, unknown>)
				return Response.json({
					data: appleAdsDeleteOutcome('campaign', 'Brand US'),
					requestId: 'request-asa-apply',
				})
			})
			const token = await issueAccessToken(fixture, 'workspace:delete')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'delete_apple_ads_campaign',
					arguments: {
						...appleAdsApply,
						confirmName: 'brand us (typed wrong)',
					},
					_meta: modernMeta(),
				},
				'delete_apple_ads_campaign',
			)
			const body = await response.json()
			expect(body.result?.content?.[0]?.text).toBe(
				'Apple Ads campaign "Brand US" deleted.',
			)
			expect(bodies).toHaveLength(1)
			expect(bodies[0]).toEqual({
				...appleAdsApply,
				confirmName: 'brand us (typed wrong)',
			})
		})

		test('an apply carrying a campaignId is refused: the token names the target', async () => {
			let upstreamCalls = 0
			const fixture = await createMcpAppFixture(async () => {
				upstreamCalls += 1
				throw new Error('Must not reach the API.')
			})
			const token = await issueAccessToken(fixture, 'workspace:delete')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'delete_apple_ads_campaign',
					arguments: {
						...appleAdsApply,
						confirmName: 'Brand US',
						campaignId: 999,
					},
					_meta: modernMeta(),
				},
				'delete_apple_ads_campaign',
			)
			const body = await response.json()
			expect(body.result?.isError).toBe(true)
			expect(upstreamCalls).toBe(0)
		})

		test("apply carries the preview's connectionName through", async () => {
			// The API resolves the connection again and refuses one the token was not signed for, so with
			// several connections the name has to be sendable on apply.
			const bodies: Array<Record<string, unknown>> = []
			const fixture = await createMcpAppFixture(async (request) => {
				bodies.push((await request.json()) as Record<string, unknown>)
				return Response.json({
					data: appleAdsDeleteOutcome('adgroup', 'Exact Match'),
					requestId: 'request-asa-apply-connection',
				})
			})
			const token = await issueAccessToken(fixture, 'workspace:delete')
			const args = {
				...appleAdsApply,
				connectionName: 'EU Ads',
				confirmName: 'Exact Match',
			}
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'delete_apple_ads_adgroup',
					arguments: args,
					_meta: modernMeta(),
				},
				'delete_apple_ads_adgroup',
			)
			const body = await response.json()
			expect(body.result?.isError).not.toBe(true)
			expect(body.result?.content?.[0]?.text).toBe(
				'Apple Ads ad group "Exact Match" deleted.',
			)
			expect(bodies[0]).toEqual(args)
		})

		test('reports an already-deleted ad group as done', async () => {
			const fixture = await createMcpAppFixture(async () =>
				Response.json({
					data: appleAdsDeleteOutcome('adgroup', 'Exact Match', {
						alreadyAbsent: true,
					}),
					requestId: 'request-asa-absent',
				}),
			)
			const token = await issueAccessToken(fixture, 'workspace:delete')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'delete_apple_ads_adgroup',
					arguments: {
						...appleAdsApply,
						idempotencyKey: 'delete-adgroup-retry-1',
						confirmName: 'Exact Match',
					},
					_meta: modernMeta(),
				},
				'delete_apple_ads_adgroup',
			)
			const body = await response.json()
			expect(body.result?.isError).not.toBe(true)
			expect(body.result?.content?.[0]?.text).toBe(
				'The Apple Ads ad group "Exact Match" was already deleted; nothing to do.',
			)
		})
	})
})
