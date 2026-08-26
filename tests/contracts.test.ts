import { describe, expect, test } from 'bun:test'
import { AnalyticsRequestSchema, CatalogRequestSchema } from '../src/contracts'
import {
	CreateAppRequestSchema,
	CreateProjectRequestSchema,
	ManageEntitlementsRequestSchema,
	ManageOfferingsRequestSchema,
	ManagePackagesRequestSchema,
	ManageProductsRequestSchema,
} from '../src/contracts/write'

const org = '00000000-0000-4000-8000-000000000001'
const project = '00000000-0000-4000-8000-000000000002'

describe('MCP read contracts', () => {
	test('applies safe defaults for analytics and catalog reads', () => {
		const analytics = AnalyticsRequestSchema.parse({
			organizationId: org,
			kind: 'overview',
		})
		const catalog = CatalogRequestSchema.parse({
			organizationId: org,
			projectId: project,
			view: 'offerings',
		})

		expect(analytics).toMatchObject({
			kind: 'overview',
			windowDays: 28,
			environment: 'production',
			includeRecentTransactions: false,
		})
		expect(catalog).toMatchObject({ view: 'offerings', limit: 50 })
	})

	test('requires an app for ASA reads and rejects unsupported metric input', () => {
		expect(() =>
			AnalyticsRequestSchema.parse({
				organizationId: org,
				kind: 'asa',
				startDate: '2026-01-01',
				endDate: '2026-01-07',
			}),
		).toThrow()
		expect(() =>
			AnalyticsRequestSchema.parse({
				organizationId: org,
				kind: 'revenue',
				metric: 'not-a-metric',
			}),
		).toThrow()
	})

	test('rejects invalid ASA dates, reversed ranges, and ranges over 90 days', () => {
		const base = { organizationId: org, appId: project, kind: 'asa' as const }
		expect(() =>
			AnalyticsRequestSchema.parse({
				...base,
				startDate: '2026-02-30',
				endDate: '2026-03-01',
			}),
		).toThrow()
		expect(() =>
			AnalyticsRequestSchema.parse({
				...base,
				startDate: '2026-03-02',
				endDate: '2026-03-01',
			}),
		).toThrow()
		expect(() =>
			AnalyticsRequestSchema.parse({
				...base,
				startDate: '2026-01-01',
				endDate: '2026-04-01',
			}),
		).toThrow()
	})

	test('advertises UUID requirements before the request reaches AppActor API', () => {
		expect(() =>
			AnalyticsRequestSchema.parse({
				organizationId: 'not-a-uuid',
				kind: 'overview',
			}),
		).toThrow()
		expect(() =>
			CatalogRequestSchema.parse({
				organizationId: org,
				projectId: 'not-a-uuid',
				view: 'offerings',
			}),
		).toThrow()
	})
})

describe('MCP controlled write contracts', () => {
	test('accepts supported mutations and two-step offering publication', () => {
		expect(
			ManageProductsRequestSchema.parse({
				action: 'classify',
				organizationId: org,
				idempotencyKey: 'classify-1',
				productId: project,
				productType: 'subscription',
			}),
		).toMatchObject({ action: 'classify' })
		expect(
			ManageEntitlementsRequestSchema.parse({
				action: 'attach_product',
				organizationId: org,
				idempotencyKey: 'attach-entitlement-1',
				productId: project,
				entitlementIds: [org],
			}),
		).toMatchObject({ action: 'attach_product' })
		const preview = ManageOfferingsRequestSchema.parse({
			action: 'preview_publish',
			organizationId: org,
			offeringId: project,
		})
		const apply = ManageOfferingsRequestSchema.parse({
			action: 'apply_publish',
			organizationId: org,
			idempotencyKey: 'publish-offering-1',
			previewToken: 'x'.repeat(32),
		})
		expect([preview.action, apply.action]).toEqual([
			'preview_publish',
			'apply_publish',
		])
		expect(
			ManagePackagesRequestSchema.parse({
				action: 'create',
				organizationId: org,
				idempotencyKey: 'create-package-1',
				offeringId: project,
				packageType: 'monthly',
				displayName: 'Monthly',
			}),
		).toMatchObject({ action: 'create' })
		expect(
			CreateProjectRequestSchema.parse({
				organizationId: org,
				idempotencyKey: 'create-project-1',
				name: 'My Project',
				slug: 'my-project',
			}),
		).toMatchObject({ slug: 'my-project' })
		expect(
			CreateAppRequestSchema.parse({
				organizationId: org,
				idempotencyKey: 'create-app-1',
				projectId: project,
				name: 'My App',
				platform: 'ios',
				bundleId: 'com.example.app',
			}),
		).toMatchObject({ platform: 'ios' })
	})

	test('does not expose destructive or secret-bearing input shapes', () => {
		for (const action of ['delete', 'detach_product', 'set_current']) {
			expect(() =>
				ManageOfferingsRequestSchema.parse({ action, organizationId: org }),
			).toThrow()
		}
		expect(() =>
			CreateAppRequestSchema.parse({
				organizationId: org,
				idempotencyKey: 'create-app-2',
				projectId: project,
				name: 'Android App',
				platform: 'android',
				packageName: 'com.example.android',
				credentialJson: '{"private_key":"secret"}',
			}),
		).toThrow()
	})
})
