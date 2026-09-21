import { afterEach, describe, expect, test } from 'bun:test'
import { jwtVerify } from 'jose'
import {
	createMcpAppFixture,
	issueAccessToken,
	mcpRpc,
	modernMeta,
	stopTestServers,
} from './helpers/mcp-app-fixture'

afterEach(stopTestServers)

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
			internalCall = {
				path: new URL(request.url).pathname,
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
				arguments: { profile: 'AppMerge' },
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
			method: 'GET',
			tool: 'get_apple_ads_accounts',
			scope: 'workspace:read',
		})
	})

	test('get_apple_ads_apps requires workspace:read', async () => {
		const fixture = await createMcpAppFixture(async () => {
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
				arguments: { profile: 'AppMerge' },
				_meta: modernMeta(),
			},
			'get_apple_ads_apps',
		)

		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.result?.structuredContent?.apps[0].adamId).toBe('123456789')
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
				arguments: { selector: 'campaign', days: 7 },
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
				arguments: { selector: 'campaign', days: 7, profile: 'AppMerge' },
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
					action: 'create',
					idempotencyKey: 'idem-camp-1',
					name: 'Test MCP Campaign',
					dailyBudget: 25,
					currency: 'USD',
					countriesOrRegions: ['US'],
					adamId: 123456789,
					profile: 'AppMerge',
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
		})
	})

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
		})
	})

	test('get_apple_ads_campaigns requires workspace:read and fetches campaign list', async () => {
		const fixture = await createMcpAppFixture(async () => {
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
				arguments: { limit: 10 },
				_meta: modernMeta(),
			},
			'get_apple_ads_campaigns',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { structuredContent?: { campaigns: Array<{ id: number }> } }
		}
		expect(body.result?.structuredContent?.campaigns[0].id).toBe(101)
	})

	test('get_apple_ads_adgroups requires workspace:read and fetches adgroups', async () => {
		const fixture = await createMcpAppFixture(async () => {
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
				arguments: { campaignId: 101 },
				_meta: modernMeta(),
			},
			'get_apple_ads_adgroups',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { structuredContent?: { adGroups: Array<{ id: number }> } }
		}
		expect(body.result?.structuredContent?.adGroups[0].id).toBe(201)
	})

	test('get_apple_ads_keywords requires workspace:read and fetches keywords', async () => {
		const fixture = await createMcpAppFixture(async () => {
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
				arguments: { adGroupId: 201 },
				_meta: modernMeta(),
			},
			'get_apple_ads_keywords',
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result?: { structuredContent?: { keywords: Array<{ id: number }> } }
		}
		expect(body.result?.structuredContent?.keywords[0].id).toBe(301)
	})

	test('get_apple_ads_negative_keywords requires workspace:read and fetches negatives', async () => {
		const fixture = await createMcpAppFixture(async () => {
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
				arguments: { campaignId: 101 },
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

	// The API keeps no ledger for Apple Ads writes, so the "retry with the same
	// key" advice errorResult attaches to an uncertain outcome is only true of
	// the actions that set a state. A re-sent create creates the object twice.
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

		test('is withheld from create', async () => {
			const result = await manageCampaign({
				action: 'create',
				idempotencyKey: 'idem-create-503',
				name: 'Brand US',
				dailyBudget: 50,
				countriesOrRegions: ['US'],
				adamId: 123456,
			})
			expect(result.isError).toBe(true)
			expect(result.content[0].text).not.toContain('same idempotencyKey')
		})

		test('is given for a state-setting action', async () => {
			const result = await manageCampaign({
				action: 'pause',
				idempotencyKey: 'idem-pause-503',
				campaignId: 101,
			})
			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('same idempotencyKey')
		})
	})
})
