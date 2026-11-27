import { z } from 'zod'
import { IdempotencyKey, PreviewToken, deleteConfirmName } from './write'

const EntityId = z.union([
	z.number().int().positive(),
	z.string().regex(/^\d+$/, 'Entity ID must be numeric.'),
])
const MatchTypeEnum = z.enum(['EXACT', 'BROAD'])

/**
 * Money goes out in the Apple Ads account's own currency, which the API reads from Apple and keeps on
 * the connection. There is no currency input: Apple refuses any other code, and the old `USD`
 * default made every budget and bid change on a non-USD account fail.
 */
const AccountMoney = z
	.number()
	.positive()
	.describe(
		"Amount in the Apple Ads account's own currency; AppActor reads that currency from Apple, so there is no currency field.",
	)

// Apple documents an absent endTime as the default (a campaign runs indefinitely, an ad group inherits
// the campaign's end) and documents no null, so none is accepted. On an update, absent means unchanged.
const CampaignStartTime = z
	.string()
	.describe('Start date and time in UTC, e.g. 2026-12-01T00:00:00.000.')
const CampaignEndTime = z
	.string()
	.describe(
		'End date and time in UTC, e.g. 2026-12-31T00:00:00.000. Leave it out for no end date, or on update to keep the current one.',
	)
const AdGroupStartTime = z
	.string()
	.describe('Start date and time, ISO 8601, e.g. 2026-12-01T00:00:00.000Z.')
const AdGroupEndTime = z
	.string()
	.describe(
		"End date and time, ISO 8601. Leave it out to inherit the campaign's end date.",
	)

// ── Base & Credential Selection ─────────────────────────────────────────────

export const AppleAdsSelectorSchema = z.object({
	organizationId: z.uuid().describe('AppActor organization UUID.'),
	connectionName: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.optional()
		.describe(
			'Name of the Apple Ads connection in AppActor, as get_app_setup lists it under connections.asa.available. Omit it when the organization has exactly one connection; with several, the API refuses and names them.',
		),
})
export type AppleAdsSelector = z.infer<typeof AppleAdsSelectorSchema>

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
	currency: z.string(),
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
			idempotencyKey: IdempotencyKey,
			name: z.string().min(1).max(255),
			dailyBudget: AccountMoney,
			countriesOrRegions: z.array(z.string().length(2)).min(1),
			adamId: EntityId,
			startTime: CampaignStartTime.optional(),
			endTime: CampaignEndTime.optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('update'),
			idempotencyKey: IdempotencyKey,
			campaignId: EntityId,
			name: z.string().min(1).max(255).optional(),
			dailyBudget: AccountMoney.optional(),
			countriesOrRegions: z.array(z.string().length(2)).min(1).optional(),
			status: z.enum(['ENABLED', 'PAUSED']).optional(),
			startTime: CampaignStartTime.optional(),
			endTime: CampaignEndTime.optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('pause'),
			idempotencyKey: IdempotencyKey,
			campaignId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('resume'),
			idempotencyKey: IdempotencyKey,
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
			idempotencyKey: IdempotencyKey,
			campaignId: EntityId,
			name: z.string().min(1).max(255),
			defaultBid: AccountMoney,
			cpaGoal: AccountMoney.optional(),
			searchMatch: z.boolean().default(false),
			startTime: AdGroupStartTime.optional(),
			endTime: AdGroupEndTime.optional(),
			automatedKeywordsOptIn: z.boolean().optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('update'),
			idempotencyKey: IdempotencyKey,
			adGroupId: EntityId,
			name: z.string().min(1).max(255).optional(),
			defaultBid: AccountMoney.optional(),
			cpaGoal: AccountMoney.nullable().optional(),
			searchMatch: z.boolean().optional(),
			status: z.enum(['ENABLED', 'PAUSED']).optional(),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('pause'),
			idempotencyKey: IdempotencyKey,
			adGroupId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('resume'),
			idempotencyKey: IdempotencyKey,
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
			idempotencyKey: IdempotencyKey,
			adGroupId: EntityId,
			text: z.string().min(1),
			bid: AccountMoney,
			matchType: MatchTypeEnum.default('EXACT'),
			status: z.enum(['ACTIVE', 'ENABLED', 'PAUSED']).default('ACTIVE'),
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('update_bid'),
			idempotencyKey: IdempotencyKey,
			keywordId: EntityId,
			bid: AccountMoney,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('pause'),
			idempotencyKey: IdempotencyKey,
			keywordId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('resume'),
			idempotencyKey: IdempotencyKey,
			keywordId: EntityId,
		}),
		AppleAdsSelectorSchema.extend({
			action: z.literal('delete'),
			idempotencyKey: IdempotencyKey,
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
			idempotencyKey: IdempotencyKey,
			text: z.string().min(1),
			matchType: MatchTypeEnum.default('EXACT'),
			campaignId: EntityId.optional().describe(
				'Campaign ID, for a campaign-level negative keyword.',
			),
			adGroupId: EntityId.optional().describe(
				'Ad group ID, for an ad group-level negative keyword.',
			),
		}).refine(
			// Apple's NegativeKeywordCreate: campaignId "must not be set" on an ad group-level negative.
			// Sending both used to be what this tool told the model to do.
			(request) =>
				(request.campaignId === undefined) !==
				(request.adGroupId === undefined),
			{
				message:
					'Send exactly one of campaignId (campaign-level negative) or adGroupId (ad group-level negative).',
				path: ['adGroupId'],
			},
		),
		AppleAdsSelectorSchema.extend({
			action: z.literal('delete'),
			idempotencyKey: IdempotencyKey,
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

// ── Deletes: preview, then apply in a later turn ────────────────────────────

// No entity id and no connectionName: the token carries the connection and the campaign or ad group
// it was signed for, as delete_project's apply carries no projectId. Re-selecting the connection on
// apply would let a different name aim an approved token at other credentials.
const AppleAdsDeleteApplySchema = z
	.object({
		organizationId: AppleAdsSelectorSchema.shape.organizationId,
		action: z.literal('apply'),
		idempotencyKey: IdempotencyKey,
		previewToken: PreviewToken,
		confirmName: deleteConfirmName('campaign or ad group'),
	})
	.strict()

export const DeleteAppleAdsCampaignRequestSchema = z.discriminatedUnion(
	'action',
	[
		AppleAdsSelectorSchema.extend({
			action: z.literal('preview'),
			campaignId: EntityId.describe(
				'Campaign ID from get_apple_ads_campaigns.',
			),
		}).strict(),
		AppleAdsDeleteApplySchema,
	],
)
export type DeleteAppleAdsCampaignRequest = z.infer<
	typeof DeleteAppleAdsCampaignRequestSchema
>

export const DeleteAppleAdsAdGroupRequestSchema = z.discriminatedUnion(
	'action',
	[
		AppleAdsSelectorSchema.extend({
			action: z.literal('preview'),
			adGroupId: EntityId.describe('Ad group ID from get_apple_ads_adgroups.'),
		}).strict(),
		AppleAdsDeleteApplySchema,
	],
)
export type DeleteAppleAdsAdGroupRequest = z.infer<
	typeof DeleteAppleAdsAdGroupRequestSchema
>
