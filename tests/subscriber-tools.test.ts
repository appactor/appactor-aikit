import { afterEach, describe, expect, test } from 'bun:test'
import { jwtVerify } from 'jose'
import {
	SubscriberRequestSchema,
	SubscriberResponseSchema,
} from '../src/contracts/subscriber'
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
const appId = ids.secondary
const subscriberId = ids.resource

const subscriberSummary = {
	subscriberId,
	appUserId: 'customer-42',
	appId,
	appName: 'Example iOS',
	projectId: ids.project,
	status: 'active',
	country: 'TR',
	firstSeenAt: timestamp,
	lastSeenAt: timestamp,
	entitlementCounts: { total: 2, active: 1 },
}

const entitlementRecord = {
	entitlementId: ids.operation,
	lookupKey: 'premium',
	displayName: 'Premium',
	isActive: true,
	status: 'active',
	store: 'apple',
	grantedBy: 'purchase',
	storeProductId: 'com.example.premium.annual',
	productType: 'auto_renewable_subscription',
	environment: 'production',
	periodType: 'normal',
	ownershipType: 'purchased',
	willRenew: true,
	startsAt: timestamp,
	expiresAt: '2027-08-26T12:00:00.000Z',
	gracePeriodExpiresAt: null,
	billingIssueDetectedAt: null,
	unsubscribeDetectedAt: null,
	scheduledStoreProductId: null,
	scheduledRenewalAt: null,
}

const transactionRecord = {
	transactionId: 'txn-1',
	store: 'apple',
	storeProductId: 'com.example.premium.annual',
	productType: 'auto_renewable_subscription',
	displayType: 'NEW_SUB',
	isTrial: false,
	isTrialConversion: false,
	conversionKind: null,
	environment: 'production',
	origin: 'store',
	originLabel: null,
	placement: null,
	amountUsd: 49.99,
	originalAmount: 1799,
	originalCurrency: 'TRY',
	purchasedAt: timestamp,
	expiresAt: '2027-08-26T12:00:00.000Z',
	createdAt: timestamp,
}

const getResponse = {
	action: 'get',
	data: {
		subscriber: subscriberSummary,
		summary: {
			status: 'active',
			activeEntitlementKeys: ['premium'],
			hasBillingIssue: false,
			hasCancellation: false,
			nextExpirationAt: '2027-08-26T12:00:00.000Z',
		},
		entitlements: [entitlementRecord],
		transactions: [transactionRecord],
		transactionsTruncated: false,
		appMemberships: [
			{
				appId,
				appName: 'Example iOS',
				projectId: ids.project,
				firstSeenAt: timestamp,
				lastSeenAt: timestamp,
			},
		],
	},
	generatedAt: timestamp,
}

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

async function callGetSubscriber(
	payload: unknown,
	args: Record<string, unknown>,
	scope = 'subscribers:read',
	capture?: { request?: Request; body?: string },
) {
	const fixture = await createMcpAppFixture(apiFixture(payload, capture))
	const token = await accessToken(fixture, scope)
	const response = await rpc(
		fixture,
		token,
		'tools/call',
		{ name: 'get_subscriber', arguments: args, _meta: modernMeta() },
		'get_subscriber',
	)
	return { fixture, response, body: await response.json() }
}

describe('get_subscriber tool', () => {
	test('returns structured subscriber state for an exact app user ID', async () => {
		const capture: { request?: Request; body?: string } = {}
		const { response, body } = await callGetSubscriber(
			getResponse,
			{ action: 'get', organizationId, appUserId: 'customer-42' },
			'subscribers:read',
			capture,
		)

		expect(response.status).toBe(200)
		expect(body.result.isError).toBeUndefined()
		expect(body.result.structuredContent).toEqual(getResponse)
		expect(body.result.content[0].text).toContain('customer-42 is active')
		expect(new URL(capture.request?.url ?? '').pathname).toBe(
			'/v1/internal/mcp/subscribers',
		)
		expect(JSON.parse(capture.body ?? '{}')).toEqual({
			action: 'get',
			organizationId,
			appUserId: 'customer-42',
			transactionLimit: 20,
		})
	})

	test('binds the internal token to the subscriber route, tool, and body', async () => {
		const capture: { request?: Request; body?: string } = {}
		const { fixture } = await callGetSubscriber(
			getResponse,
			{ action: 'get', organizationId, subscriberId },
			'subscribers:read',
			capture,
		)

		const authorization = capture.request?.headers.get('authorization') ?? ''
		const { payload } = await jwtVerify(
			authorization.slice(7),
			fixture.internalPublicKey,
			{ issuer: 'appactor-mcp', audience: 'appactor-api' },
		)
		expect(payload.tool).toBe('get_subscriber')
		expect(payload.scope).toBe('subscribers:read')
		expect(payload.method).toBe('POST')
		expect(payload.target).toBe('/v1/internal/mcp/subscribers')
		expect(payload.body_sha256).toBe(await sha256Hex(capture.body))
	})

	test('rejects the tool when the access token lacks subscribers:read', async () => {
		const fixture = await createMcpAppFixture()
		const token = await accessToken(fixture, 'workspace:read analytics:read')
		const response = await rpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_subscriber',
				arguments: { action: 'get', organizationId, subscriberId },
				_meta: modernMeta(),
			},
			'get_subscriber',
		)
		expect(response.status).toBe(403)
		const challenge = response.headers.get('www-authenticate') ?? ''
		expect(challenge).toContain('insufficient_scope')
		expect(challenge).toContain('subscribers:read')
	})

	test('surfaces an upstream permission failure as a tool error', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json(
				{
					error: {
						code: 'FORBIDDEN',
						message: 'You do not have access to this app.',
					},
					requestId: 'req-2',
				},
				{ status: 403 },
			),
		)
		const token = await accessToken(fixture, 'subscribers:read')
		const response = await rpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'get_subscriber',
				arguments: { action: 'get', organizationId, subscriberId },
				_meta: modernMeta(),
			},
			'get_subscriber',
		)
		const body = await response.json()
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0].text).toContain(
			'You do not have access to this app.',
		)
		expect(body.result.content[0].text).not.toContain('same idempotencyKey')
	})

	test('reports an empty lookup without inventing a subscriber', async () => {
		const { body } = await callGetSubscriber(
			{
				action: 'lookup',
				data: {
					matches: [],
					pagination: { limit: 10, hasMore: false, nextCursor: null },
				},
				generatedAt: timestamp,
			},
			{ action: 'lookup', organizationId, appUserId: 'missing-customer' },
		)
		expect(body.result.content[0].text).toContain('No subscriber matches')
		expect(body.result.structuredContent.data.matches).toEqual([])
	})

	test('advertises get_subscriber as a read-only, closed-world tool', async () => {
		const fixture = await createMcpAppFixture()
		const token = await accessToken(fixture, 'workspace:read subscribers:read')
		const response = await rpc(fixture, token, 'tools/list', {
			_meta: modernMeta(),
		})
		const body = await response.json()
		const tool = (
			body.result.tools as Array<{
				name: string
				description: string
				annotations: Record<string, boolean>
			}>
		).find((entry) => entry.name === 'get_subscriber')
		expect(tool?.annotations).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		})
		expect(tool?.description).toContain('Matching is exact')
	})
})

describe('get_subscriber upstream contract failures', () => {
	test('reports an invalid upstream payload instead of passing it through', async () => {
		const { body } = await callGetSubscriber(
			{
				...getResponse,
				data: {
					...getResponse.data,
					subscriber: { ...subscriberSummary, entitlementCounts: undefined },
				},
			},
			{ action: 'get', organizationId, subscriberId },
		)
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0].text).toContain('UPSTREAM_CONTRACT_INVALID')
	})

	test('rejects a mistyped monetary amount rather than reporting it', async () => {
		const { body } = await callGetSubscriber(
			{
				...getResponse,
				data: {
					...getResponse.data,
					transactions: [{ ...transactionRecord, amountUsd: '49.99' }],
				},
			},
			{ action: 'get', organizationId, subscriberId },
		)
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0].text).toContain('UPSTREAM_CONTRACT_INVALID')
	})
})

describe('subscriber contracts', () => {
	test('caps the transaction window at what the API can actually read', () => {
		expect(() =>
			SubscriberRequestSchema.parse({
				action: 'get',
				organizationId,
				subscriberId,
				transactionLimit: 26,
			}),
		).toThrow()
		expect(
			SubscriberRequestSchema.parse({
				action: 'get',
				organizationId,
				subscriberId,
				transactionLimit: 25,
			}),
		).toMatchObject({ transactionLimit: 25 })
	})

	test('rejects arguments that would widen the search surface', () => {
		expect(() =>
			SubscriberRequestSchema.parse({
				action: 'lookup',
				organizationId,
				appUserId: 'customer-42',
				searchMode: 'substring',
			}),
		).toThrow()
	})

	test('strips unexpected upstream fields out of the tool response', () => {
		const parsed = SubscriberResponseSchema.parse({
			...getResponse,
			data: {
				...getResponse.data,
				subscriber: { ...subscriberSummary, email: 'someone@example.com' },
				entitlements: [
					{ ...entitlementRecord, lastTransactionId: 'txn-internal' },
				],
				transactions: [
					{ ...transactionRecord, storeMetadata: { raw: 'payload' } },
				],
			},
		})
		const serialized = JSON.stringify(parsed)
		expect(serialized).not.toContain('someone@example.com')
		expect(serialized).not.toContain('txn-internal')
		expect(serialized).not.toContain('storeMetadata')
	})
})
