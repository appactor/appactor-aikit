import { z } from 'zod'

const Id = z.string().min(1)
const NullableUrl = z.url().nullable()

const AppleWebhookStatusSchema = z.object({
	state: z.enum(['not_verified', 'checking', 'verified', 'failed']),
	source: z.enum(['test_notification', 'live_notification']).nullable(),
	verifiedAt: z.string().nullable(),
	lastCheckedAt: z.string().nullable(),
	lastCheckRequestedAt: z.string().nullable(),
	lastError: z.string().nullable(),
	warning: z.string().nullable(),
	environment: z.enum(['sandbox', 'production']).nullable(),
	testNotificationStatus: z
		.object({
			state: z.enum(['pending', 'success', 'failed']),
			result: z.string().nullable(),
			checkedAt: z.string().nullable(),
			attemptDate: z.string().nullable(),
		})
		.nullable(),
})

export const PaginationSchema = z.object({
	limit: z.number().int().positive(),
	hasMore: z.boolean(),
	nextCursor: z.string().nullable(),
})

export const WorkspaceSchema = z.object({
	organizations: z.array(
		z.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			role: z.enum(['owner', 'member']),
		}),
	),
	selectedOrganization: z
		.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			role: z.enum(['owner', 'member']),
			access: z.object({
				accountPermissions: z.array(z.string()),
				projectAccessMode: z.string(),
				projectPermissions: z.array(z.string()),
				projectPermissionsByProject: z.array(
					z.object({
						projectId: Id,
						permissions: z.array(z.string()),
					}),
				),
			}),
		})
		.nullable(),
	projects: z.array(
		z.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			description: z.string().nullable(),
			iconUrl: NullableUrl,
		}),
	),
	apps: z.array(
		z.object({
			id: Id,
			projectId: Id.nullable(),
			name: z.string(),
			platform: z.enum(['ios', 'android']),
			bundleId: z.string().nullable(),
			packageName: z.string().nullable(),
			iconUrl: NullableUrl,
			appleAppId: z.number().nullable(),
			appleConnection: z.unknown().nullable(),
		}),
	),
	appsPagination: PaginationSchema.nullable(),
})

export const AppSetupSchema = z.object({
	app: z.object({
		id: Id,
		projectId: Id.nullable(),
		name: z.string(),
		platform: z.enum(['ios', 'android']),
		bundleId: z.string().nullable(),
		packageName: z.string().nullable(),
		appleAppId: z.number().nullable(),
		publicApiKey: z.string().nullable(),
	}),
	connections: z.object({
		apple: z.unknown().nullable(),
		google: z.unknown().nullable(),
		appleWebhookStatus: AppleWebhookStatusSchema.nullable(),
	}),
	links: z.object({
		dashboard: z.url(),
		credentials: z.url(),
		appleWebhookSetup: NullableUrl,
		googleSetup: NullableUrl,
	}),
})

export type Workspace = z.infer<typeof WorkspaceSchema>
export type AppSetup = z.infer<typeof AppSetupSchema>

const AnalyticsScopeSchema = z.object({
	organizationId: Id,
	projectId: Id.optional(),
	appId: Id.optional(),
})
const WindowDaysSchema = z
	.union([z.literal(7), z.literal(28), z.literal(90)])
	.default(28)
const EnvironmentSchema = z
	.enum(['production', 'sandbox'])
	.default('production')
const DateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD dates.')
const PaginationFields = {
	limit: z.number().int().min(1).max(100).default(50),
	cursor: z.string().max(2048).optional(),
}
const FiltersSchema = z
	.object({
		store: z.enum(['apple', 'google']).optional(),
		productId: Id.optional(),
		currency: z.string().length(3).optional(),
		country: z.string().length(2).optional(),
	})
	.strict()

export const AnalyticsRequestSchema = z.discriminatedUnion('kind', [
	AnalyticsScopeSchema.extend({
		kind: z.literal('overview'),
		windowDays: WindowDaysSchema,
		environment: EnvironmentSchema,
		includeRecentTransactions: z.boolean().default(false),
		recentTransactionsLimit: z.number().int().min(1).max(100).default(20),
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('revenue'),
		metric: z.enum([
			'sales',
			'proceeds',
			'arpu',
			'arppu',
			'refunds',
			'cohort_refunds',
			'cohort_refund_rate',
			'mrr',
			'mrr_movement',
			'arr',
			'arr_movement',
		]),
		windowDays: WindowDaysSchema,
		environment: EnvironmentSchema,
		groupBy: z.enum(['store', 'product', 'currency', 'country']).optional(),
		filters: FiltersSchema.optional(),
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('users'),
		metric: z.enum(['new_users', 'new_to_trial', 'new_to_paid']),
		windowDays: WindowDaysSchema,
		environment: EnvironmentSchema,
		groupBy: z
			.enum(['app', 'store', 'product', 'currency', 'country'])
			.optional(),
		filters: FiltersSchema.optional(),
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('trials'),
		metric: z.enum([
			'active_trials',
			'new_trials',
			'trial_renewal_cancelled',
			'expired_trials',
		]),
		windowDays: WindowDaysSchema,
		environment: EnvironmentSchema,
		groupBy: z.enum(['store', 'product', 'currency', 'country']).optional(),
		filters: FiltersSchema.optional(),
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('transactions'),
		environment: EnvironmentSchema,
		limit: z.number().int().min(1).max(100).default(20),
		cursor: z.string().max(2048).optional(),
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('asa'),
		appId: Id,
		view: z
			.enum(['overview', 'campaigns', 'ad_groups', 'keywords'])
			.default('overview'),
		startDate: DateSchema,
		endDate: DateSchema,
		campaignId: z.number().int().positive().optional(),
		adGroupId: z.number().int().positive().optional(),
		limit: z.number().int().min(1).max(200).default(50),
		cursor: z.string().max(2048).optional(),
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('experiments'),
		resultMode: z
			.enum(['lifetime_cohort', 'd30_after_assignment', 'during_experiment'])
			.default('lifetime_cohort'),
		...PaginationFields,
	}),
	AnalyticsScopeSchema.extend({
		kind: z.literal('refund_defense'),
		appId: Id,
		windowDays: z.number().int().min(1).max(90).default(28),
	}),
])

export const CatalogRequestSchema = z.discriminatedUnion('view', [
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('context'),
		limit: z.number().int().min(1).max(100).default(50),
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('products'),
		appId: Id,
		...PaginationFields,
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('product'),
		productId: Id,
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('entitlements'),
		...PaginationFields,
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('entitlement'),
		entitlementId: Id,
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('offerings'),
		...PaginationFields,
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('offering'),
		offeringId: Id,
	}),
	z.object({
		organizationId: Id,
		projectId: Id,
		view: z.literal('packages'),
		offeringId: Id,
	}),
])

export type AnalyticsRequest = z.infer<typeof AnalyticsRequestSchema>
export type CatalogRequest = z.infer<typeof CatalogRequestSchema>
