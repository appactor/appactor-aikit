import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	AppleAdsReportRequestSchema,
	AppleAdsReportResponseSchema,
	GetAppleAdsAdGroupsRequestSchema,
	GetAppleAdsAdGroupsResponseSchema,
	GetAppleAdsCampaignsRequestSchema,
	GetAppleAdsCampaignsResponseSchema,
	GetAppleAdsKeywordsRequestSchema,
	GetAppleAdsKeywordsResponseSchema,
	GetAppleAdsNegativeKeywordsRequestSchema,
	GetAppleAdsNegativeKeywordsResponseSchema,
	ListAppleAdsAccountsRequestSchema,
	ListAppleAdsAccountsResponseSchema,
	ListAppleAdsAppsRequestSchema,
	ListAppleAdsAppsResponseSchema,
	ManageAppleAdsAdGroupRequestSchema,
	ManageAppleAdsAdGroupResponseSchema,
	ManageAppleAdsCampaignRequestSchema,
	ManageAppleAdsCampaignResponseSchema,
	ManageAppleAdsKeywordRequestSchema,
	ManageAppleAdsKeywordResponseSchema,
	ManageAppleAdsNegativeKeywordRequestSchema,
	ManageAppleAdsNegativeKeywordResponseSchema,
} from '../contracts/apple-ads'
import {
	READ_TOOL_ANNOTATIONS_OPEN_WORLD,
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'

/**
 * The API keeps no idempotency ledger for Apple Ads writes: nothing is
 * replayed, nothing is audited, and a `create` re-sent after a timeout can
 * create the object twice. The key is still sent so the ledger can be added
 * on the API side without a contract change here. Stated once and composed
 * into the descriptions, the annotations and the retry advice, so the three
 * cannot drift apart.
 */
export const APPLE_ADS_NO_LEDGER_RULE =
	'idempotencyKey is required but the API keeps no ledger for Apple Ads writes: a repeated create is sent to Apple again and creates the object twice, so after a timeout read the list and re-send only if it is missing.'

const APPLE_ADS_WRITE_ANNOTATIONS = writeToolAnnotations(true, true, false)

/** Only `create` adds an object; every other action sets a state and is safe to repeat. */
function isRetryableAppleAdsAction(action: string) {
	return action !== 'create'
}

export function registerAppleAdsTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	// ── Accounts & Apps ─────────────────────────────────────────────────────────

	server.registerTool(
		'get_apple_ads_accounts',
		{
			title: 'List Apple Ads Accounts',
			description:
				'List the Apple Ads ad accounts the selected connection is authorized for.',
			inputSchema: ListAppleAdsAccountsRequestSchema,
			outputSchema: ListAppleAdsAccountsResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppleAdsAccounts(
					{ ...principal, tool: 'get_apple_ads_accounts' },
					request,
				)
				return successResult(
					data,
					`Found ${data.accounts.length} authorized Apple Ads account(s).`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'get_apple_ads_apps',
		{
			title: 'List Owned Apple Ads Apps',
			description:
				'List iOS apps owned by the organization in Apple Ads (adamId, name, developer).',
			inputSchema: ListAppleAdsAppsRequestSchema,
			outputSchema: ListAppleAdsAppsResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppleAdsApps(
					{ ...principal, tool: 'get_apple_ads_apps' },
					request,
				)
				return successResult(
					data,
					`Found ${data.apps.length} owned app(s) in Apple Ads.`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	// ── Reports ─────────────────────────────────────────────────────────────────

	server.registerTool(
		'get_apple_ads_reports',
		{
			title: 'Query Apple Ads Performance Reports',
			description:
				'Fetch performance reporting metrics (impressions, taps, spend, installs, CPT, CPA, TTR) grouped by campaign, adgroup, keyword, or search_term across a date window.',
			inputSchema: AppleAdsReportRequestSchema,
			outputSchema: AppleAdsReportResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'analytics:read')
				const data = await api.getAppleAdsReports(
					{ ...principal, tool: 'get_apple_ads_reports' },
					request,
				)
				return successResult(
					data,
					`${request.selector} performance report returned ${data.rows.length} row(s).`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	// ── Campaigns ───────────────────────────────────────────────────────────────

	server.registerTool(
		'get_apple_ads_campaigns',
		{
			title: 'Get Apple Ads Campaigns',
			description:
				'List campaigns or get detail for a specific campaign ID on Apple Search Ads.',
			inputSchema: GetAppleAdsCampaignsRequestSchema,
			outputSchema: GetAppleAdsCampaignsResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppleAdsCampaigns(
					{ ...principal, tool: 'get_apple_ads_campaigns' },
					request,
				)
				const count = data.campaign ? 1 : data.campaigns.length
				return successResult(
					data,
					data.campaign
						? `Campaign ${data.campaign.id} (${data.campaign.name}) status: ${data.campaign.status}.`
						: `Listed ${count} campaign(s).`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'manage_apple_ads_campaigns',
		{
			title: 'Manage Apple Ads Campaigns',
			description: `Create, update (budget/name), pause, resume, or delete a campaign on Apple Search Ads. ${APPLE_ADS_NO_LEDGER_RULE}`,
			inputSchema: ManageAppleAdsCampaignRequestSchema,
			outputSchema: ManageAppleAdsCampaignResponseSchema,
			annotations: APPLE_ADS_WRITE_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:write')
				const data = await api.manageAppleAdsCampaigns(
					{ ...principal, tool: 'manage_apple_ads_campaigns' },
					request,
				)
				const replay = data.replayed ? ' (replayed)' : ''
				return successResult(
					data,
					`Campaign ${request.action} succeeded${replay}: ID ${data.campaignId ?? 'n/a'}, status ${data.status ?? 'SUCCESS'}.`,
				)
			} catch (error) {
				return errorResult(error, isRetryableAppleAdsAction(request.action))
			}
		},
	)

	// ── AdGroups ────────────────────────────────────────────────────────────────

	server.registerTool(
		'get_apple_ads_adgroups',
		{
			title: 'Get Apple Ads AdGroups',
			description:
				'List adgroups for a campaign or get detail for a specific adgroup ID on Apple Search Ads.',
			inputSchema: GetAppleAdsAdGroupsRequestSchema,
			outputSchema: GetAppleAdsAdGroupsResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppleAdsAdGroups(
					{ ...principal, tool: 'get_apple_ads_adgroups' },
					request,
				)
				const count = data.adGroup ? 1 : data.adGroups.length
				return successResult(
					data,
					data.adGroup
						? `AdGroup ${data.adGroup.id} (${data.adGroup.name}) status: ${data.adGroup.status}.`
						: `Listed ${count} adgroup(s).`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'manage_apple_ads_adgroups',
		{
			title: 'Manage Apple Ads AdGroups',
			description: `Create, update bid/CPA, pause, resume, or delete an adgroup on Apple Search Ads. ${APPLE_ADS_NO_LEDGER_RULE}`,
			inputSchema: ManageAppleAdsAdGroupRequestSchema,
			outputSchema: ManageAppleAdsAdGroupResponseSchema,
			annotations: APPLE_ADS_WRITE_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:write')
				const data = await api.manageAppleAdsAdGroups(
					{ ...principal, tool: 'manage_apple_ads_adgroups' },
					request,
				)
				const replay = data.replayed ? ' (replayed)' : ''
				return successResult(
					data,
					`AdGroup ${request.action} succeeded${replay}: ID ${data.adGroupId ?? 'n/a'}, status ${data.status ?? 'SUCCESS'}.`,
				)
			} catch (error) {
				return errorResult(error, isRetryableAppleAdsAction(request.action))
			}
		},
	)

	// ── Keywords ────────────────────────────────────────────────────────────────

	server.registerTool(
		'get_apple_ads_keywords',
		{
			title: 'Get Apple Ads Targeting Keywords',
			description:
				'List targeting keywords for an adgroup or get detail for a specific keyword ID on Apple Search Ads.',
			inputSchema: GetAppleAdsKeywordsRequestSchema,
			outputSchema: GetAppleAdsKeywordsResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppleAdsKeywords(
					{ ...principal, tool: 'get_apple_ads_keywords' },
					request,
				)
				const count = data.keyword ? 1 : data.keywords.length
				return successResult(
					data,
					data.keyword
						? `Keyword ${data.keyword.id} ("${data.keyword.text}") status: ${data.keyword.status}.`
						: `Listed ${count} targeting keyword(s).`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'manage_apple_ads_keywords',
		{
			title: 'Manage Apple Ads Targeting Keywords',
			description: `Create targeting keywords, update bids, pause, resume, or delete keywords on Apple Search Ads. ${APPLE_ADS_NO_LEDGER_RULE}`,
			inputSchema: ManageAppleAdsKeywordRequestSchema,
			outputSchema: ManageAppleAdsKeywordResponseSchema,
			annotations: APPLE_ADS_WRITE_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:write')
				const data = await api.manageAppleAdsKeywords(
					{ ...principal, tool: 'manage_apple_ads_keywords' },
					request,
				)
				const replay = data.replayed ? ' (replayed)' : ''
				return successResult(
					data,
					`Keyword ${request.action} succeeded${replay}: ID ${data.keywordId ?? 'n/a'}, status ${data.status ?? 'SUCCESS'}.`,
				)
			} catch (error) {
				return errorResult(error, isRetryableAppleAdsAction(request.action))
			}
		},
	)

	// ── Negative Keywords ───────────────────────────────────────────────────────

	server.registerTool(
		'get_apple_ads_negative_keywords',
		{
			title: 'Get Apple Ads Negative Keywords',
			description:
				'List negative keywords at campaign or adgroup level on Apple Search Ads.',
			inputSchema: GetAppleAdsNegativeKeywordsRequestSchema,
			outputSchema: GetAppleAdsNegativeKeywordsResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppleAdsNegativeKeywords(
					{ ...principal, tool: 'get_apple_ads_negative_keywords' },
					request,
				)
				return successResult(
					data,
					`Found ${data.negativeKeywords.length} negative keyword(s).`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'manage_apple_ads_negative_keywords',
		{
			title: 'Manage Apple Ads Negative Keywords',
			description: `Add or delete negative keywords at campaign or adgroup level on Apple Search Ads. ${APPLE_ADS_NO_LEDGER_RULE}`,
			inputSchema: ManageAppleAdsNegativeKeywordRequestSchema,
			outputSchema: ManageAppleAdsNegativeKeywordResponseSchema,
			annotations: APPLE_ADS_WRITE_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:write')
				const data = await api.manageAppleAdsNegativeKeywords(
					{ ...principal, tool: 'manage_apple_ads_negative_keywords' },
					request,
				)
				const replay = data.replayed ? ' (replayed)' : ''
				return successResult(
					data,
					`Negative keyword ${request.action} succeeded${replay}: ID ${data.negativeKeywordId ?? 'n/a'}, status ${data.status ?? 'SUCCESS'}.`,
				)
			} catch (error) {
				return errorResult(error, isRetryableAppleAdsAction(request.action))
			}
		},
	)
}
