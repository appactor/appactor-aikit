import { z } from 'zod'

const EntityId = z.union([
	z.number().int().positive(),
	z.string().regex(/^\d+$/, 'Entity ID must be numeric.'),
])
const MatchTypeEnum = z.enum(['EXACT', 'BROAD'])

// ── Base & Credential Selection ─────────────────────────────────────────────

export const AppleAdsSelectorSchema = z.object({
	profile: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Local Apple Ads profile name (e.g. AppMerge). Used in development/testing.',
		),
	connectionId: z
		.string()
		.uuid()
		.optional()
		.describe('Apple Ads connection UUID stored in AppActor.'),
	organizationId: z
		.string()
		.uuid()
		.optional()
		.describe('AppActor organization UUID.'),
})

// ── Accounts & Apps ─────────────────────────────────────────────────────────

export const AppleAdsAccountSchema = z.object({
	id: z.string(),
	name: z.string(),
	orgId: z.string(),
	orgName: z.string(),
	roleName: z.string().optional(),
	roles: z.array(z.string()).optional(),
})
export type AppleAdsAccount = z.infer<typeof AppleAdsAccountSchema>

export const ListAppleAdsAccountsRequestSchema = AppleAdsSelectorSchema
export const ListAppleAdsAccountsResponseSchema = z.object({
	accounts: z.array(AppleAdsAccountSchema),
})
export type ListAppleAdsAccountsResponse = z.infer<
	typeof ListAppleAdsAccountsResponseSchema
>

export const AppleAdsAppSchema = z.object({
	adamId: z.string(),
	name: z.string(),
	developer: z.string(),
})
export type AppleAdsApp = z.infer<typeof AppleAdsAppSchema>

export const ListAppleAdsAppsRequestSchema = AppleAdsSelectorSchema
export const ListAppleAdsAppsResponseSchema = z.object({
	apps: z.array(AppleAdsAppSchema),
})
export type ListAppleAdsAppsResponse = z.infer<
	typeof ListAppleAdsAppsResponseSchema
>

// ── Performance Reports ─────────────────────────────────────────────────────

export const PerformanceReportRowSchema = z.object({
	entityId: z.number(),
	name: z.string(),
	impressions: z.number(),
	taps: z.number(),
	spend: z.number(),
	currency: z.string(),
	installs: z.number(),
	ttr: z.number(),
	cpt: z.number(),
	cpa: z.number(),
	searchTerm: z.string().optional(),
})
export type PerformanceReportRow = z.infer<typeof PerformanceReportRowSchema>

export const AppleAdsReportRequestSchema = AppleAdsSelectorSchema.extend({
	selector: z
		.enum(['campaign', 'adgroup', 'keyword', 'search_term'])
		.describe('Entity granularity for the performance report.'),
	campaignId: EntityId.optional().describe(
		'Required for adgroup, keyword, and search_term reports.',
	),
	adGroupId: EntityId.optional().describe(
		'Narrows a search_term report to one adgroup. Ignored by the other selectors, whose rows are always campaign-wide.',
	),
	days: z
		.number()
		.int()
		.min(1)
		.max(90)
		.default(30)
		.describe('Window in days (1-90). Default: 30.'),
	startDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.')
		.optional(),
	endDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.')
		.optional(),
	limit: z.number().int().min(1).max(1000).default(50),
	offset: z.number().int().min(0).default(0),
})
export type AppleAdsReportRequest = z.input<typeof AppleAdsReportRequestSchema>

export const AppleAdsReportResponseSchema = z.object({
	rows: z.array(PerformanceReportRowSchema).default([]),
	reports: z.array(PerformanceReportRowSchema).optional(),
	selector: z.string().default('campaign'),
	entityType: z.string().optional(),
	totalCount: z.number().int().min(0),
	summary: z
		.object({
			totalSpend: z.number().optional(),
			totalImpressions: z.number().optional(),
			totalTaps: z.number().optional(),
			totalInstalls: z.number().optional(),
			currency: z.string().optional(),
		})
		.optional()
		.describe(
			'Totals over the rows in this response — one page of `limit` rows — not over the whole window.',
		),
})
export type AppleAdsReportResponse = z.infer<
	typeof AppleAdsReportResponseSchema
>

// ── Campaigns ───────────────────────────────────────────────────────────────

export const AppleAdsCampaignSchema = z.object({
	id: z.number(),
	name: z.string(),
	status: z.string(),
	dailyBudget: z.number(),
	currency: z.string().default('USD'),
	countriesOrRegions: z.array(z.string()).optional(),
	countries: z.array(z.string()).optional(),
	adamId: z.union([z.number(), z.string()]).optional(),
	promotedObjectId: z.string().optional(),
	supplySources: z.array(z.string()).optional(),
	startTime: z.string().nullable().optional(),
	endTime: z.string().nullable().optional(),
	billingEvent: z.string().nullable().optional(),
	creationTime: z.string().nullable().optional(),
	modificationTime: z.string().nullable().optional(),
})
export type AppleAdsCampaign = z.infer<typeof AppleAdsCampaignSchema>

export const GetAppleAdsCampaignsRequestSchema = AppleAdsSelectorSchema.extend({
	campaignId: EntityId.optional().describe(
		'Specific campaign ID to fetch. If omitted, lists campaigns.',
	),
	status: z
		.enum(['ENABLED', 'PAUSED'])
		.optional()
		.describe('Filter by campaign status.'),
	limit: z.number().int().min(1).max(1000).default(50),
	offset: z.number().int().min(0).default(0),
})
export type GetAppleAdsCampaignsRequest = z.input<
	typeof GetAppleAdsCampaignsRequestSchema
>

export const GetAppleAdsCampaignsResponseSchema = z.object({
	campaigns: z.array(AppleAdsCampaignSchema),
	campaign: AppleAdsCampaignSchema.optional(),
})
export type GetAppleAdsCampaignsResponse = z.infer<
	typeof GetAppleAdsCampaignsResponseSchema
>

export const ManageAppleAdsCampaignRequestSchema = z.discriminatedUnion(
	'action',
	[
		AppleAdsSelectorSchema.extend({
			action: z.literal('create'),
			idempotencyKey: z.string().min(1),
			name: z.string().min(1).max(255),
			dailyBudget: z.number().positive(),
			currency: z.string().length(3).default('USD'),
			countriesOrRegions: z.array(z.string().length(2)).min(1),
			adamId: EntityId,
			supplySources: z.array(z.string()).optional(),
			startTime: z.string().optional(),
			endTime: z.string().nullable().optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('update'),
			idempotencyKey: z.string().min(1),
			campaignId: EntityId,
			name: z.string().min(1).max(255).optional(),
			dailyBudget: z.number().positive().optional(),
			countriesOrRegions: z.array(z.string().length(2)).min(1).optional(),
			status: z.enum(['ENABLED', 'PAUSED']).optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('pause'),
			idempotencyKey: z.string().min(1),
			campaignId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('resume'),
			idempotencyKey: z.string().min(1),
			campaignId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('delete'),
			idempotencyKey: z.string().min(1),
			campaignId: EntityId,
		}),
	],
)
export type ManageAppleAdsCampaignRequest = z.input<
	typeof ManageAppleAdsCampaignRequestSchema
>

export const ManageAppleAdsCampaignResponseSchema = z.object({
	action: z.string(),
	campaignId: z.number().optional(),
	status: z.string().optional(),
	campaign: AppleAdsCampaignSchema.optional(),
	replayed: z.boolean().optional(),
	success: z.boolean().optional(),
})
export type ManageAppleAdsCampaignResponse = z.infer<
	typeof ManageAppleAdsCampaignResponseSchema
>

// ── AdGroups ────────────────────────────────────────────────────────────────

export const AppleAdsAdGroupSchema = z.object({
	id: z.number(),
	campaignId: z.number(),
	name: z.string(),
	status: z.string(),
	defaultBid: z.number().nullable(),
	currency: z.string(),
	searchMatch: z.boolean().default(false),
	cpaGoal: z.number().nullable().optional(),
	startTime: z.string().nullable().optional(),
	endTime: z.string().nullable().optional(),
	creationTime: z.string().nullable().optional(),
	modificationTime: z.string().nullable().optional(),
})
export type AppleAdsAdGroup = z.infer<typeof AppleAdsAdGroupSchema>

export const GetAppleAdsAdGroupsRequestSchema = AppleAdsSelectorSchema.extend({
	adGroupId: EntityId.optional().describe(
		'Specific adgroup ID to fetch detail. If omitted, lists adgroups.',
	),
	campaignId: EntityId.optional().describe('Campaign ID to list adgroups for.'),
	status: z.enum(['ENABLED', 'PAUSED']).optional(),
	limit: z.number().int().min(1).max(1000).default(50),
	offset: z.number().int().min(0).default(0),
})
export type GetAppleAdsAdGroupsRequest = z.input<
	typeof GetAppleAdsAdGroupsRequestSchema
>

export const GetAppleAdsAdGroupsResponseSchema = z.object({
	adGroups: z.array(AppleAdsAdGroupSchema),
	adGroup: AppleAdsAdGroupSchema.optional(),
})
export type GetAppleAdsAdGroupsResponse = z.infer<
	typeof GetAppleAdsAdGroupsResponseSchema
>

export const ManageAppleAdsAdGroupRequestSchema = z.discriminatedUnion(
	'action',
	[
		AppleAdsSelectorSchema.extend({
			action: z.literal('create'),
			idempotencyKey: z.string().min(1),
			campaignId: EntityId,
			name: z.string().min(1).max(255),
			defaultBid: z.number().positive(),
			currency: z.string().length(3).default('USD'),
			cpaGoal: z.number().positive().optional(),
			searchMatch: z.boolean().default(false),
			startTime: z.string().optional(),
			endTime: z.string().nullable().optional(),
			automatedKeywordsOptIn: z.boolean().optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('update'),
			idempotencyKey: z.string().min(1),
			adGroupId: EntityId,
			name: z.string().min(1).max(255).optional(),
			defaultBid: z.number().positive().optional(),
			cpaGoal: z.number().positive().nullable().optional(),
			searchMatch: z.boolean().optional(),
			status: z.enum(['ENABLED', 'PAUSED']).optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('pause'),
			idempotencyKey: z.string().min(1),
			adGroupId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('resume'),
			idempotencyKey: z.string().min(1),
			adGroupId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('delete'),
			idempotencyKey: z.string().min(1),
			adGroupId: EntityId,
		}),
	],
)
export type ManageAppleAdsAdGroupRequest = z.input<
	typeof ManageAppleAdsAdGroupRequestSchema
>

export const ManageAppleAdsAdGroupResponseSchema = z.object({
	action: z.string(),
	adGroupId: z.number().optional(),
	status: z.string().optional(),
	adGroup: AppleAdsAdGroupSchema.optional(),
	replayed: z.boolean().optional(),
	success: z.boolean().optional(),
})
export type ManageAppleAdsAdGroupResponse = z.infer<
	typeof ManageAppleAdsAdGroupResponseSchema
>

// ── Keywords ────────────────────────────────────────────────────────────────

export const AppleAdsKeywordSchema = z.object({
	id: z.number(),
	adGroupId: z.number(),
	text: z.string(),
	matchType: MatchTypeEnum,
	bid: z.number().nullable(),
	currency: z.string(),
	status: z.string(),
	creationTime: z.string().nullable().optional(),
	modificationTime: z.string().nullable().optional(),
	deleted: z.boolean().optional(),
})
export type AppleAdsKeyword = z.infer<typeof AppleAdsKeywordSchema>

export const GetAppleAdsKeywordsRequestSchema = AppleAdsSelectorSchema.extend({
	keywordId: EntityId.optional().describe(
		'Specific keyword ID to fetch detail. If omitted, lists keywords.',
	),
	adGroupId: EntityId.describe(
		'AdGroup ID to list keywords for (required by Apple Ads API).',
	),
	status: z.enum(['ACTIVE', 'ENABLED', 'PAUSED']).optional(),
	limit: z.number().int().min(1).max(1000).default(50),
	offset: z.number().int().min(0).default(0),
})
export type GetAppleAdsKeywordsRequest = z.input<
	typeof GetAppleAdsKeywordsRequestSchema
>

export const GetAppleAdsKeywordsResponseSchema = z.object({
	keywords: z.array(AppleAdsKeywordSchema),
	keyword: AppleAdsKeywordSchema.optional(),
})
export type GetAppleAdsKeywordsResponse = z.infer<
	typeof GetAppleAdsKeywordsResponseSchema
>

export const ManageAppleAdsKeywordRequestSchema = z.discriminatedUnion(
	'action',
	[
		AppleAdsSelectorSchema.extend({
			action: z.literal('create'),
			idempotencyKey: z.string().min(1),
			adGroupId: EntityId,
			text: z.string().min(1),
			bid: z.number().positive(),
			matchType: MatchTypeEnum.default('EXACT'),
			currency: z.string().length(3).default('USD'),
			status: z.enum(['ACTIVE', 'ENABLED', 'PAUSED']).default('ACTIVE'),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('update_bid'),
			idempotencyKey: z.string().min(1),
			keywordId: EntityId,
			bid: z.number().positive(),
			currency: z.string().length(3).default('USD'),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('pause'),
			idempotencyKey: z.string().min(1),
			keywordId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('resume'),
			idempotencyKey: z.string().min(1),
			keywordId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('delete'),
			idempotencyKey: z.string().min(1),
			keywordId: EntityId,
		}),
	],
)
export type ManageAppleAdsKeywordRequest = z.input<
	typeof ManageAppleAdsKeywordRequestSchema
>

export const ManageAppleAdsKeywordResponseSchema = z.object({
	action: z.string(),
	keywordId: z.number().optional(),
	status: z.string().optional(),
	keyword: AppleAdsKeywordSchema.optional(),
	keywords: z.array(AppleAdsKeywordSchema).optional(),
	replayed: z.boolean().optional(),
	success: z.boolean().optional(),
})
export type ManageAppleAdsKeywordResponse = z.infer<
	typeof ManageAppleAdsKeywordResponseSchema
>

// ── Negative Keywords ───────────────────────────────────────────────────────

export const AppleAdsNegativeKeywordSchema = z.object({
	id: z.number(),
	campaignId: z.number().nullable().optional(),
	adGroupId: z.number().nullable().optional(),
	text: z.string(),
	matchType: MatchTypeEnum,
	status: z.string(),
	creationTime: z.string().nullable().optional(),
	modificationTime: z.string().nullable().optional(),
	deleted: z.boolean().optional(),
})
export type AppleAdsNegativeKeyword = z.infer<
	typeof AppleAdsNegativeKeywordSchema
>

export const GetAppleAdsNegativeKeywordsRequestSchema =
	AppleAdsSelectorSchema.extend({
		campaignId: EntityId.optional().describe(
			'Campaign ID to list campaign-level negative keywords.',
		),
		adGroupId: EntityId.optional().describe(
			'AdGroup ID to list adgroup-level negative keywords.',
		),
		limit: z.number().int().min(1).max(1000).default(50),
		offset: z.number().int().min(0).default(0),
	})
export type GetAppleAdsNegativeKeywordsRequest = z.input<
	typeof GetAppleAdsNegativeKeywordsRequestSchema
>

export const GetAppleAdsNegativeKeywordsResponseSchema = z.object({
	negativeKeywords: z.array(AppleAdsNegativeKeywordSchema),
})
export type GetAppleAdsNegativeKeywordsResponse = z.infer<
	typeof GetAppleAdsNegativeKeywordsResponseSchema
>

export const ManageAppleAdsNegativeKeywordRequestSchema = z.discriminatedUnion(
	'action',
	[
		AppleAdsSelectorSchema.extend({
			action: z.literal('create'),
			idempotencyKey: z.string().min(1),
			text: z.string().min(1),
			matchType: MatchTypeEnum.default('EXACT'),
			campaignId: EntityId,
			adGroupId: EntityId.optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('delete'),
			idempotencyKey: z.string().min(1),
			negativeKeywordId: EntityId,
			campaignId: EntityId.optional(),
			adGroupId: EntityId.optional(),
		}),
	],
)
export type ManageAppleAdsNegativeKeywordRequest = z.input<
	typeof ManageAppleAdsNegativeKeywordRequestSchema
>

export const ManageAppleAdsNegativeKeywordResponseSchema = z.object({
	action: z.string(),
	negativeKeywordId: z.number().optional(),
	status: z.string().optional(),
	negativeKeyword: AppleAdsNegativeKeywordSchema.optional(),
	replayed: z.boolean().optional(),
	success: z.boolean().optional(),
})
export type ManageAppleAdsNegativeKeywordResponse = z.infer<
	typeof ManageAppleAdsNegativeKeywordResponseSchema
>
