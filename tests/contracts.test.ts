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
})
