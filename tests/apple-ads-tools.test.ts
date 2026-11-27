import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { jwtVerify } from 'jose'
import {
	ManageAppleAdsAdGroupRequestSchema,
	ManageAppleAdsCampaignRequestSchema,
	ManageAppleAdsKeywordRequestSchema,
	ManageAppleAdsNegativeKeywordRequestSchema,
} from '../src/contracts/apple-ads'
import {
	createMcpAppFixture,
	issueAccessToken,
	mcpRpc,
	modernMeta,
	stopTestServers,
} from './helpers/mcp-app-fixture'

afterEach(stopTestServers)

const ORGANIZATION_ID = '5c6a1a4e-3f4b-4d5e-9a6b-7c8d9e0f1a2b'

describe('Apple Ads MCP tools', () => {
	test('get_apple_ads_accounts requires workspace:read and binds to correct route', async () => {
		let internalCall: Record<string, unknown> | null = null
		const fixture = await createMcpAppFixture(async (request) => {
			const auth = request.headers.get('authorization')
			if (!auth) throw new Error('Missing auth')
			const verified = await jwtVerify(
				auth.slice(7),
				fixture.internalPublicKey,
				{
					issuer: 'appactor-mcp',
					audience: 'appactor-api',
				},
			)
			const url = new URL(request.url)
			internalCall = {
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
				method: request.method,
				tool: verified.payload.tool,
				scope: verified.payload.scope,
			}
			return Response.json({
				data: {
					accounts: [
						{
							id: '8960480',
							name: 'AppMerge Ads',
							orgId: '8960480',
							orgName: 'AppMerge Inc',
						},
					],
				},
				requestId: 'req-accounts',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_apple_ads_accounts',
				arguments: { organizationId: ORGANIZATION_ID, connectionName: 'Main' },
				_meta: modernMeta(),
			},
			'get_apple_ads_accounts',
		)

		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.result?.structuredContent?.accounts).toHaveLength(1)
		expect(body.result?.structuredContent?.accounts[0].name).toBe(
			'AppMerge Ads',
		)
		expect(internalCall).toMatchObject({
			path: '/v1/internal/mcp/apple-ads/accounts',
			// The API resolves membership, the consent grant and asa.manage from
			// organizationId, and the connection by name; neither is optional here.
			query: { organizationId: ORGANIZATION_ID, connectionName: 'Main' },
			method: 'GET',
			tool: 'get_apple_ads_accounts',
			scope: 'workspace:read',
		})
	})

	test('get_apple_ads_apps requires workspace:read', async () => {
		let query: Record<string, string> | undefined
		const fixture = await createMcpAppFixture(async (request) => {
			query = Object.fromEntries(new URL(request.url).searchParams)
			return Response.json({
				data: {
					apps: [
						{
							adamId: '123456789',
							name: 'Test App',
							developer: 'AppMerge Dev',
						},
					],
				},
				requestId: 'req-apps',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_apple_ads_apps',
				arguments: { organizationId: ORGANIZATION_ID },
				_meta: modernMeta(),
			},
			'get_apple_ads_apps',
		)

		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.result?.structuredContent?.apps[0].adamId).toBe('123456789')
		expect(query).toEqual({ organizationId: ORGANIZATION_ID })
	})

	test('get_apple_ads_reports requires analytics:read and validates report shape', async () => {
		let internalCall: Record<string, unknown> | null = null
		const fixture = await createMcpAppFixture(async (request) => {
			const auth = request.headers.get('authorization')
			if (!auth) throw new Error('Missing auth')
			const verified = await jwtVerify(
				auth.slice(7),
				fixture.internalPublicKey,
				{
					issuer: 'appactor-mcp',
					audience: 'appactor-api',
				},
			)
			internalCall = {
				path: new URL(request.url).pathname,
				method: request.method,
				tool: verified.payload.tool,
				scope: verified.payload.scope,
				body: await request.json(),
			}
			return Response.json({
				data: {
					rows: [
						{
							entityId: 101,
							name: 'Brand Campaign',
							impressions: 1500,
							taps: 120,
							spend: 45.5,
							currency: 'USD',
							installs: 30,
							ttr: 0.08,
							cpt: 0.3792,
							cpa: 1.5167,
						},
					],
					selector: 'campaign',
					totalCount: 1,
				},
				requestId: 'req-reports',
			})
		})

		// Token with workspace:read should fail for analytics:read tool
		const wrongToken = await issueAccessToken(fixture, 'workspace:read')
		const rejected = await mcpRpc(
			fixture,
			wrongToken,
			'tools/call',
			{
				name: 'get_apple_ads_reports',
				arguments: {
					selector: 'campaign',
					days: 7,
					organizationId: ORGANIZATION_ID,
				},
				_meta: modernMeta(),
			},
			'get_apple_ads_reports',
		)
		expect(rejected.status).toBe(403)

		// Token with analytics:read should succeed
		const correctToken = await issueAccessToken(fixture, 'analytics:read')
		const response = await mcpRpc(
			fixture,
			correctToken,
			'tools/call',
			{
				name: 'get_apple_ads_reports',
				arguments: {
					selector: 'campaign',
					days: 7,
					organizationId: ORGANIZATION_ID,
				},
				_meta: modernMeta(),
			},
			'get_apple_ads_reports',
		)

		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.result?.structuredContent?.rows[0].spend).toBe(45.5)
		expect(internalCall).toMatchObject({
			path: '/v1/internal/mcp/apple-ads/reports',
			method: 'POST',
			tool: 'get_apple_ads_reports',
			scope: 'analytics:read',
			body: { selector: 'campaign', days: 7, organizationId: ORGANIZATION_ID },
		})
	})

	test('manage_apple_ads_campaigns requires workspace:write and routes POST', async () => {
		let internalCall: Record<string, unknown> | null = null
		const fixture = await createMcpAppFixture(async (request) => {
			const auth = request.headers.get('authorization')
			if (!auth) throw new Error('Missing auth')
			const verified = await jwtVerify(
				auth.slice(7),
				fixture.internalPublicKey,
				{
					issuer: 'appactor-mcp',
					audience: 'appactor-api',
				},
			)
			internalCall = {
				path: new URL(request.url).pathname,
				method: request.method,
				tool: verified.payload.tool,
				scope: verified.payload.scope,
				body: await request.json(),
			}
			return Response.json({
				data: {
					action: 'create',
					campaignId: 999888,
					status: 'PAUSED',
					campaign: {
						id: 999888,
						name: 'Test MCP Campaign',
						status: 'PAUSED',
						dailyBudget: 25,
						currency: 'USD',
						countriesOrRegions: ['US'],
						adamId: 123456789,
					},
				},
				requestId: 'req-campaign-create',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_campaigns',
				arguments: {
					organizationId: ORGANIZATION_ID,
					connectionName: 'Main',
					action: 'create',
					idempotencyKey: 'idem-camp-1',
					name: 'Test MCP Campaign',
					dailyBudget: 25,
					currency: 'USD',
					countriesOrRegions: ['US'],
					adamId: 123456789,
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_campaigns',
		)

		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.result?.structuredContent?.campaignId).toBe(999888)
		expect(internalCall).toMatchObject({
			path: '/v1/internal/mcp/apple-ads/campaigns',
			method: 'POST',
			tool: 'manage_apple_ads_campaigns',
			scope: 'workspace:write',
			body: { organizationId: ORGANIZATION_ID, connectionName: 'Main' },
		})
		// The API sends every amount in the account's own currency. A caller still passing the old
		// field must not get a stray code through to it: a mismatch is a 400 there.
		expect(internalCall).not.toHaveProperty('body.currency')
	})

	test('campaign update forwards startTime and endTime', async () => {
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: { action: 'update', campaignId: 101, status: 'ENABLED' },
				requestId: 'req-campaign-update',
			})
		})
		const token = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_campaigns',
				arguments: {
					organizationId: ORGANIZATION_ID,
					action: 'update',
					idempotencyKey: 'idem-camp-dates',
					campaignId: 101,
					startTime: '2026-12-01T00:00:00.000',
					endTime: '2026-12-31T00:00:00.000',
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_campaigns',
		)
		expect(response.status).toBe(200)
		expect(bodies).toHaveLength(1)
		// G-3: these used to have no way through at all on an update.
		expect(bodies[0]).toMatchObject({
			action: 'update',
			startTime: '2026-12-01T00:00:00.000',
			endTime: '2026-12-31T00:00:00.000',
		})
	})

	for (const [tool, idField] of [
		['manage_apple_ads_campaigns', 'campaignId'],
		['manage_apple_ads_adgroups', 'adGroupId'],
	] as const) {
		test(`${tool} no longer deletes; that is a workspace:delete tool`, async () => {
			let upstreamCalls = 0
			const fixture = await createMcpAppFixture(async () => {
				upstreamCalls += 1
				throw new Error(
					'A delete must not reach the API through a manage tool.',
				)
			})
			const token = await issueAccessToken(fixture, 'workspace:write')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: tool,
					arguments: {
						organizationId: ORGANIZATION_ID,
						action: 'delete',
						idempotencyKey: 'idem-old-delete',
						[idField]: 101,
					},
					_meta: modernMeta(),
				},
				tool,
			)
			const body = await response.json()
			expect(body.result?.isError).toBe(true)
			expect(upstreamCalls).toBe(0)
		})
	}

	test('manage_apple_ads_adgroups routes actions with idempotencyKey', async () => {
		let receivedBody: Record<string, unknown> | null = null
		const fixture = await createMcpAppFixture(async (request) => {
			receivedBody = (await request.json()) as Record<string, unknown>
			return Response.json({
				data: {
					action: 'pause',
					adGroupId: 444333,
					status: 'PAUSED',
				},
				requestId: 'req-adgroup-pause',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_adgroups',
				arguments: {
					organizationId: ORGANIZATION_ID,
					action: 'pause',
					idempotencyKey: 'idem-ag-pause',
					adGroupId: 444333,
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_adgroups',
		)

		expect(response.status).toBe(200)
		expect(receivedBody).toMatchObject({
			action: 'pause',
			adGroupId: 444333,
			idempotencyKey: 'idem-ag-pause',
			organizationId: ORGANIZATION_ID,
		})
	})

	test('manage_apple_ads_keywords routes bid update action', async () => {
		let receivedBody: Record<string, unknown> | null = null
		const fixture = await createMcpAppFixture(async (request) => {
			receivedBody = (await request.json()) as Record<string, unknown>
			return Response.json({
				data: {
					action: 'update_bid',
					keywordId: 555666,
					status: 'ACTIVE',
				},
				requestId: 'req-kw-update',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_keywords',
				arguments: {
					organizationId: ORGANIZATION_ID,
					action: 'update_bid',
					idempotencyKey: 'idem-kw-bid',
					keywordId: 555666,
					bid: 1.5,
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_keywords',
		)

		expect(response.status).toBe(200)
		expect(receivedBody).toMatchObject({
			action: 'update_bid',
			keywordId: 555666,
			bid: 1.5,
			organizationId: ORGANIZATION_ID,
		})
	})

	test('manage_apple_ads_negative_keywords routes create action', async () => {
		let receivedBody: Record<string, unknown> | null = null
		const fixture = await createMcpAppFixture(async (request) => {
			receivedBody = (await request.json()) as Record<string, unknown>
			return Response.json({
				data: {
					action: 'create',
					negativeKeywordId: 777888,
					status: 'ACTIVE',
				},
				requestId: 'req-neg-kw-create',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_negative_keywords',
				arguments: {
					organizationId: ORGANIZATION_ID,
					action: 'create',
					idempotencyKey: 'idem-neg-1',
					campaignId: 101,
					text: 'free cheats',
					matchType: 'EXACT',
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_negative_keywords',
		)

		expect(response.status).toBe(200)
		expect(receivedBody).toMatchObject({
			action: 'create',
			campaignId: 101,
			text: 'free cheats',
			organizationId: ORGANIZATION_ID,
		})
		expect(receivedBody).not.toHaveProperty('adGroupId')
	})

	test('an ad group-level negative keyword is sent with adGroupId alone', async () => {
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: { action: 'create', negativeKeywordId: 777889, status: 'ACTIVE' },
				requestId: 'req-neg-kw-adgroup',
			})
		})
		const token = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_negative_keywords',
				arguments: {
					organizationId: ORGANIZATION_ID,
					action: 'create',
					idempotencyKey: 'idem-neg-adgroup',
					adGroupId: 201,
					text: 'free',
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_negative_keywords',
		)
		expect(response.status).toBe(200)
		expect(bodies).toHaveLength(1)
		expect(bodies[0]).toMatchObject({ action: 'create', adGroupId: 201 })
		// Apple's NegativeKeywordCreate: campaignId must not be set on an ad group-level negative.
		expect(bodies[0]).not.toHaveProperty('campaignId')
	})

	for (const [label, scope] of [
		['both ids', { campaignId: 101, adGroupId: 201 }],
		['neither id', {}],
	] as const) {
		test(`a negative keyword create with ${label} is refused before the API`, async () => {
			let upstreamCalls = 0
			const fixture = await createMcpAppFixture(async () => {
				upstreamCalls += 1
				throw new Error('An ambiguous negative scope must not reach the API.')
			})
			const token = await issueAccessToken(fixture, 'workspace:write')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'manage_apple_ads_negative_keywords',
					arguments: {
						organizationId: ORGANIZATION_ID,
						action: 'create',
						idempotencyKey: 'idem-neg-ambiguous',
						text: 'free',
						...scope,
					},
					_meta: modernMeta(),
				},
				'manage_apple_ads_negative_keywords',
			)
			const body = await response.json()
			expect(body.result?.isError).toBe(true)
			expect(JSON.stringify(body.result?.content)).toContain(
				'exactly one of campaignId',
			)
			expect(upstreamCalls).toBe(0)
		})
	}

	test('get_apple_ads_campaigns requires workspace:read and fetches campaign list', async () => {
		let query: Record<string, string> | undefined
		const fixture = await createMcpAppFixture(async (request) => {
			query = Object.fromEntries(new URL(request.url).searchParams)
			return Response.json({
				data: {
					campaigns: [
						{
							id: 101,
							name: 'Summer Campaign',
							status: 'ENABLED',
							dailyBudget: 25.0,
							currency: 'USD',
							countries: ['US'],
							promotedObjectId: '6763819005',
						},
					],
					totalCount: 1,
				},
				requestId: 'req-camps',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_apple_ads_campaigns',
				arguments: { limit: 10, organizationId: ORGANIZATION_ID },
				_meta: modernMeta(),
			},
			'get_apple_ads_campaigns',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { structuredContent?: { campaigns: Array<{ id: number }> } }
		}
		expect(body.result?.structuredContent?.campaigns[0].id).toBe(101)
		expect(query).toEqual({
			limit: '10',
			offset: '0',
			organizationId: ORGANIZATION_ID,
		})
	})

	test('get_apple_ads_adgroups requires workspace:read and fetches adgroups', async () => {
		let query: Record<string, string> | undefined
		const fixture = await createMcpAppFixture(async (request) => {
			query = Object.fromEntries(new URL(request.url).searchParams)
			return Response.json({
				data: {
					adGroups: [
						{
							id: 201,
							campaignId: 101,
							name: 'Search Match Group',
							status: 'ENABLED',
							defaultBid: 1.5,
							currency: 'USD',
							searchMatch: true,
						},
					],
					totalCount: 1,
				},
				requestId: 'req-ags',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_apple_ads_adgroups',
				arguments: { campaignId: 101, organizationId: ORGANIZATION_ID },
				_meta: modernMeta(),
			},
			'get_apple_ads_adgroups',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { structuredContent?: { adGroups: Array<{ id: number }> } }
		}
		expect(body.result?.structuredContent?.adGroups[0].id).toBe(201)
		expect(query).toEqual({
			campaignId: '101',
			limit: '50',
			offset: '0',
			organizationId: ORGANIZATION_ID,
		})
	})

	test('get_apple_ads_keywords requires workspace:read and fetches keywords', async () => {
		let query: Record<string, string> | undefined
		const fixture = await createMcpAppFixture(async (request) => {
			query = Object.fromEntries(new URL(request.url).searchParams)
			return Response.json({
				data: {
					keywords: [
						{
							id: 301,
							adGroupId: 201,
							text: 'tracker app',
							matchType: 'EXACT',
							bid: 1.2,
							currency: 'USD',
							status: 'ACTIVE',
						},
					],
					totalCount: 1,
				},
				requestId: 'req-kws',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_apple_ads_keywords',
				arguments: { adGroupId: 201, organizationId: ORGANIZATION_ID },
				_meta: modernMeta(),
			},
			'get_apple_ads_keywords',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { structuredContent?: { keywords: Array<{ id: number }> } }
		}
		expect(body.result?.structuredContent?.keywords[0].id).toBe(301)
		expect(query).toEqual({
			adGroupId: '201',
			limit: '50',
			offset: '0',
			organizationId: ORGANIZATION_ID,
		})
	})

	test('get_apple_ads_negative_keywords requires workspace:read and fetches negatives', async () => {
		let query: Record<string, string> | undefined
		const fixture = await createMcpAppFixture(async (request) => {
			query = Object.fromEntries(new URL(request.url).searchParams)
			return Response.json({
				data: {
					negativeKeywords: [
						{
							id: 401,
							campaignId: 101,
							text: 'free',
							matchType: 'EXACT',
							status: 'ACTIVE',
						},
					],
				},
				requestId: 'req-negs',
			})
		})

		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_apple_ads_negative_keywords',
				arguments: { campaignId: 101, organizationId: ORGANIZATION_ID },
				_meta: modernMeta(),
			},
			'get_apple_ads_negative_keywords',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: {
				structuredContent?: { negativeKeywords: Array<{ id: number }> }
			}
		}
		expect(body.result?.structuredContent?.negativeKeywords[0].id).toBe(401)
		expect(query).toEqual({
			campaignId: '101',
			limit: '50',
			offset: '0',
			organizationId: ORGANIZATION_ID,
		})
	})

	test('manage_apple_ads_campaigns rejects read-only scope with 403', async () => {
		const fixture = await createMcpAppFixture()
		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'manage_apple_ads_campaigns',
				arguments: {
					organizationId: ORGANIZATION_ID,
					action: 'pause',
					idempotencyKey: 'idem-reject-1',
					campaignId: 101,
				},
				_meta: modernMeta(),
			},
			'manage_apple_ads_campaigns',
		)

		expect(response.status).toBe(403)
	})

	// Apple Ads writes are backed by the API idempotency ledger and search Apple Ads
	// before re-posting on uncertain create retries, so every action (including create)
	// receives "retry with the same idempotencyKey" advice.
	describe('retry advice on an uncertain outcome', () => {
		const upstreamDown = async () =>
			Response.json(
				{
					error: { code: 'UPSTREAM_ERROR', message: 'Apple Ads unavailable.' },
					requestId: 'req-503',
				},
				{ status: 503 },
			)

		async function manageCampaign(args: Record<string, unknown>) {
			const fixture = await createMcpAppFixture(
				upstreamDown as unknown as typeof fetch,
			)
			const token = await issueAccessToken(fixture, 'workspace:write')
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: 'manage_apple_ads_campaigns',
					arguments: args,
					_meta: modernMeta(),
				},
				'manage_apple_ads_campaigns',
			)
			return (await response.json()).result as {
				isError?: boolean
				content: Array<{ text: string }>
			}
		}

		test('is given for create (idempotent ledger + duplicate recovery)', async () => {
			const result = await manageCampaign({
				organizationId: ORGANIZATION_ID,
				action: 'create',
				idempotencyKey: 'idem-create-503',
				name: 'Brand US',
				dailyBudget: 50,
				countriesOrRegions: ['US'],
				adamId: 123456,
			})
			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('same idempotencyKey')
		})

		test('is given for a state-setting action', async () => {
			const result = await manageCampaign({
				organizationId: ORGANIZATION_ID,
				action: 'pause',
				idempotencyKey: 'idem-pause-503',
				campaignId: 101,
			})
			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('same idempotencyKey')
		})
	})

	test('manage_apple_ads_* descriptions accurately document idempotency without duplicate-creation warnings', async () => {
		const fixture = await createMcpAppFixture()
		const token = await issueAccessToken(fixture, 'workspace:read')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/list',
			{ _meta: modernMeta() },
			'list-apple-ads-tools',
		)
		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { tools: Array<{ name: string; description?: string }> }
		}
		const writeTools = (body.result?.tools ?? []).filter((tool) =>
			tool.name.startsWith('manage_apple_ads_'),
		)
		expect(writeTools.map((t) => t.name).sort()).toEqual([
			'manage_apple_ads_adgroups',
			'manage_apple_ads_campaigns',
			'manage_apple_ads_keywords',
			'manage_apple_ads_negative_keywords',
		])
		for (const tool of writeTools) {
			expect(tool.description).toContain('idempotencyKey')
			expect(tool.description).toContain('409 Conflict')
			expect(tool.description).toContain('get_audit_log')
			expect(tool.description).toContain('never blindly re-POST')
			expect(tool.description).toContain('5 minutes of inactivity')
			expect(tool.description).not.toContain('creates the object twice')
			expect(tool.description).not.toContain('keeps no ledger')
			expect(tool.description).not.toContain('enforces unique')
			expect(tool.description).not.toContain('auto-transition')
		}
		const kwTool = writeTools.find(
			(t) => t.name === 'manage_apple_ads_keywords',
		)
		expect(kwTool?.description).toContain('max 50 per call')
		expect(kwTool?.description).toContain('already-created keyword IDs')
		const negTool = writeTools.find(
			(t) => t.name === 'manage_apple_ads_negative_keywords',
		)
		expect(negTool?.description).toContain('takes adGroupId alone')
		expect(negTool?.description).not.toContain('campaignId and adGroupId')
		const adGroupTool = writeTools.find(
			(t) => t.name === 'manage_apple_ads_adgroups',
		)
		expect(adGroupTool?.description).toContain(
			'pause and resume change only the status',
		)
		expect(adGroupTool?.description).toContain('MAX_CONVERSIONS')
		expect(adGroupTool?.description).toContain('delete_apple_ads_adgroup')
		const campaignTool = writeTools.find(
			(t) => t.name === 'manage_apple_ads_campaigns',
		)
		expect(campaignTool?.description).toContain('delete_apple_ads_campaign')
		// Keywords still delete through their manage tool; campaigns and ad groups do not.
		for (const tool of [campaignTool, adGroupTool]) {
			expect(tool?.description).not.toMatch(/resume, or delete/)
		}
	})

	test('no Apple Ads write takes a currency', () => {
		// S3: the API sends the account's own currency. A schema that still accepted one would hand the
		// model a field to guess at, and the old USD default was a guaranteed refusal on other accounts.
		const parsed = [
			ManageAppleAdsCampaignRequestSchema.parse({
				organizationId: ORGANIZATION_ID,
				action: 'create',
				idempotencyKey: 'idem-no-currency-1',
				name: 'Brand',
				dailyBudget: 10,
				countriesOrRegions: ['DE'],
				adamId: 1,
				currency: 'EUR',
			}),
			ManageAppleAdsAdGroupRequestSchema.parse({
				organizationId: ORGANIZATION_ID,
				action: 'create',
				idempotencyKey: 'idem-no-currency-2',
				campaignId: 101,
				name: 'Exact',
				defaultBid: 1,
				currency: 'EUR',
			}),
			ManageAppleAdsKeywordRequestSchema.parse({
				organizationId: ORGANIZATION_ID,
				action: 'update_bid',
				idempotencyKey: 'idem-no-currency-3',
				keywordId: 301,
				bid: 1.2,
				currency: 'EUR',
			}),
		]
		for (const request of parsed) {
			expect(request).not.toHaveProperty('currency')
		}
	})

	test('Apple Ads write schemas share strict IdempotencyKey validation', () => {
		const cases = [
			{
				schema: ManageAppleAdsCampaignRequestSchema,
				base: {
					organizationId: ORGANIZATION_ID,
					action: 'pause' as const,
					campaignId: 101,
				},
			},
			{
				schema: ManageAppleAdsAdGroupRequestSchema,
				base: {
					organizationId: ORGANIZATION_ID,
					action: 'pause' as const,
					adGroupId: 201,
				},
			},
			{
				schema: ManageAppleAdsKeywordRequestSchema,
				base: {
					organizationId: ORGANIZATION_ID,
					action: 'pause' as const,
					keywordId: 301,
				},
			},
			{
				schema: ManageAppleAdsNegativeKeywordRequestSchema,
				base: {
					organizationId: ORGANIZATION_ID,
					action: 'delete' as const,
					negativeKeywordId: 401,
				},
			},
		]

		for (const { schema, base } of cases) {
			expect(
				schema.safeParse({ ...base, idempotencyKey: 'short' }).success,
			).toBe(false)
			expect(
				schema.safeParse({ ...base, idempotencyKey: 'bad key with spaces!' })
					.success,
			).toBe(false)
			expect(
				schema.safeParse({ ...base, idempotencyKey: 'valid-key_01:ok' })
					.success,
			).toBe(true)
		}
	})

	test('ASA and workspace skills and plugin versions align with Apple Ads write ledger', () => {
		const root = resolve(import.meta.dir, '..')
		const asaSkill = readFileSync(
			resolve(root, 'plugins/appactor/skills/asa/SKILL.md'),
			'utf8',
		)
		const workspaceSkill = readFileSync(
			resolve(root, 'plugins/appactor/skills/workspace/SKILL.md'),
			'utf8',
		)
		for (const skill of [asaSkill, workspaceSkill]) {
			expect(skill).not.toContain('keeps no ledger')
			expect(skill).not.toContain('creates two')
			expect(skill).not.toContain('auto-transition')
			expect(skill).toContain('mcp_write_operations')
			expect(skill).toContain('get_audit_log')
			expect(skill).toContain('409 Conflict')
			expect(skill).toContain('never blindly re-POST')
			expect(skill).toContain('5 minutes of inactivity')
		}

		const pkg = JSON.parse(
			readFileSync(resolve(root, 'package.json'), 'utf8'),
		) as { version: string }
		const plugin = JSON.parse(
			readFileSync(
				resolve(root, 'plugins/appactor/.claude-plugin/plugin.json'),
				'utf8',
			),
		) as { version: string }
		expect(pkg.version).toBe('0.7.0')
		expect(plugin.version).toBe(pkg.version)
	})
})
