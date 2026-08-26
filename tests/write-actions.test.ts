import { afterEach, describe, expect, test } from 'bun:test'
import {
	createMcpAppFixture,
	issueAccessToken,
	mcpRpc,
	modernMeta,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import {
	app,
	entitlement,
	ids,
	offering,
	pkg,
	product,
	succeeded,
	timestamp,
} from './helpers/write-response-fixtures'

afterEach(stopTestServers)

const scenarios = [
	{
		name: 'manage_products',
		path: '/v1/internal/mcp/products',
		arguments: {
			action: 'import',
			organizationId: ids.organization,
			idempotencyKey: 'import-products-1',
			appId: ids.secondary,
			products: [
				{ storeProductId: 'premium_monthly', productType: 'subscription' },
			],
		},
		response: succeeded('import', {
			imported: 1,
			total: 1,
			products: [product],
		}),
	},
	{
		name: 'manage_products',
		path: '/v1/internal/mcp/products',
		arguments: {
			action: 'classify',
			organizationId: ids.organization,
			idempotencyKey: 'classify-product-1',
			productId: ids.resource,
			productType: 'subscription',
		},
		response: succeeded('classify', { product }, true),
	},
	{
		name: 'manage_entitlements',
		path: '/v1/internal/mcp/entitlements',
		arguments: {
			action: 'update',
			organizationId: ids.organization,
			idempotencyKey: 'update-entitlement-1',
			entitlementId: ids.resource,
			displayName: 'Premium',
		},
		response: succeeded('update', { entitlement }),
	},
	{
		name: 'manage_entitlements',
		path: '/v1/internal/mcp/entitlements',
		arguments: {
			action: 'attach_product',
			organizationId: ids.organization,
			idempotencyKey: 'attach-entitlement-1',
			productId: ids.resource,
			entitlementIds: [ids.secondary],
		},
		response: succeeded('attach_product', {
			productId: ids.resource,
			attachedEntitlementIds: [ids.secondary],
		}),
	},
	{
		name: 'manage_offerings',
		path: '/v1/internal/mcp/offerings',
		arguments: {
			action: 'update',
			organizationId: ids.organization,
			idempotencyKey: 'update-offering-1',
			offeringId: ids.resource,
			displayName: 'Default',
		},
		response: succeeded('update', { offering }),
	},
	{
		name: 'manage_offerings',
		path: '/v1/internal/mcp/offerings',
		arguments: {
			action: 'preview_publish',
			organizationId: ids.organization,
			offeringId: ids.resource,
		},
		response: {
			status: 'preview',
			previewToken: 'p'.repeat(64),
			expiresAt: timestamp,
			changes: {
				currentOfferingId: null,
				nextOfferingId: ids.resource,
				packageCount: 1,
				packageProductCount: 1,
			},
		},
	},
	{
		name: 'manage_offerings',
		path: '/v1/internal/mcp/offerings',
		arguments: {
			action: 'apply_publish',
			organizationId: ids.organization,
			idempotencyKey: 'publish-offering-1',
			previewToken: 'p'.repeat(64),
		},
		response: succeeded(
			'apply_publish',
			{ offering: { ...offering, isCurrent: true } },
			true,
		),
	},
	{
		name: 'manage_packages',
		path: '/v1/internal/mcp/packages',
		arguments: {
			action: 'update',
			organizationId: ids.organization,
			idempotencyKey: 'update-package-1',
			packageId: ids.resource,
			displayName: 'Monthly',
		},
		response: succeeded('update', { package: pkg }),
	},
	{
		name: 'manage_packages',
		path: '/v1/internal/mcp/packages',
		arguments: {
			action: 'attach_product',
			organizationId: ids.organization,
			idempotencyKey: 'attach-package-product-1',
			packageId: ids.resource,
			productId: ids.secondary,
		},
		response: succeeded('attach_product', {
			packageProduct: {
				packageId: ids.resource,
				productId: ids.secondary,
				googleOfferId: null,
				position: 0,
				createdAt: timestamp,
			},
		}),
	},
	{
		name: 'create_app',
		path: '/v1/internal/mcp/apps',
		arguments: {
			organizationId: ids.organization,
			idempotencyKey: 'create-ios-app-1',
			projectId: ids.project,
			name: 'Example App',
			platform: 'ios',
			bundleId: 'com.example.app',
		},
		response: succeeded('create', { app, publicApiKey: 'pk_public' }, true),
	},
] as const

describe('MCP write action protocol coverage', () => {
	test('validates every update, attach, preview, apply, and replay response family', async () => {
		let current: (typeof scenarios)[number] | undefined
		const fixture = await createMcpAppFixture(async (request) => {
			if (!current) throw new Error('Missing current protocol scenario.')
			expect(new URL(request.url).pathname).toBe(current.path)
			expect(await request.json()).toEqual(current.arguments)
			return Response.json({
				data: current.response,
				requestId: 'request-action',
			})
		})
		const token = await issueAccessToken(
			fixture,
			'catalog:write workspace:write',
		)

		for (const scenario of scenarios) {
			current = scenario
			const response = await mcpRpc(
				fixture,
				token,
				'tools/call',
				{
					name: scenario.name,
					arguments: scenario.arguments,
					_meta: modernMeta(),
				},
				scenario.name,
			)
			const body = await response.json()
			expect(response.status).toBe(200)
			expect(body.result?.isError).not.toBe(true)
			expect(body.result?.structuredContent).toEqual(scenario.response)
		}
	})
})
