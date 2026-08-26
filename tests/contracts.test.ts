import { describe, expect, test } from 'bun:test'
import { AnalyticsRequestSchema, CatalogRequestSchema } from '../src/contracts'

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
