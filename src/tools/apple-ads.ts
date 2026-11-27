import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	AppleAdsReportRequestSchema,
	AppleAdsReportResponseSchema,
	DeleteAppleAdsAdGroupRequestSchema,
	DeleteAppleAdsCampaignRequestSchema,
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
	type DeleteAppleAdsAdGroupResponse,
	DeleteAppleAdsAdGroupResponseSchema,
	type DeleteAppleAdsCampaignResponse,
	DeleteAppleAdsCampaignResponseSchema,
} from '../contracts/write-responses'
import {
	READ_TOOL_ANNOTATIONS_OPEN_WORLD,
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'
import {
	DELETE_PROTOCOL,
	countLabel,
	deleteOutcomeSummary,
	deletePreviewSummary,
} from './delete-protocol'

/**
 * Apple Ads writes run through the API's `mcp_write_operations` idempotency
 * ledger (recorded in `get_audit_log`): re-sending a succeeded
 * `idempotencyKey` replays the stored result without calling Apple again.
 * Create calls never blindly re-POST on a 5xx or network timeout; retrying an
 * uncertain or timed-out `create` with the same key searches Apple Ads for a
 * recently created matching object before sending any second POST, avoiding
 * duplicates (the Apple Ads Platform API does not document campaign or ad group
 * name uniqueness, so generating a new key on an uncertain retry risks
 * duplicates). If retrying immediately after MCP's 35s timeout returns
 * `409 Conflict` while the first API request is still in flight, wait briefly
 * and retry with the same key (retrying after 5 minutes of inactivity
 * transitions an interrupted `pending` record to `uncertain` and reclaims it).
 */
export const APPLE_ADS_IDEMPOTENCY_RULE =
	'Idempotent via idempotencyKey (backed by the API write ledger and visible in get_audit_log): replaying a succeeded key returns the stored result, and create calls never blindly re-POST on 5xx/network errors — any second POST only happens after searching Apple Ads for recently created objects when you retry the exact same idempotencyKey and arguments. If retrying after MCP 35s timeout returns 409 Conflict (still in flight on API), wait briefly and retry with the same idempotencyKey (retrying after 5 minutes of inactivity transitions an interrupted pending record to uncertain and reclaims it) — never generate a new key (Platform API does not guarantee name uniqueness).'

const APPLE_ADS_WRITE_ANNOTATIONS = writeToolAnnotations(true, true)

const MANAGE_CAMPAIGNS_DESCRIPTION = `Create, update (name, daily budget, countries or regions, start and end time, status), pause, or resume a campaign on Apple Search Ads. update writes only the fields you send. Deleting a campaign is delete_apple_ads_campaign. ${APPLE_ADS_IDEMPOTENCY_RULE}`

const MANAGE_ADGROUPS_DESCRIPTION = `Create, update (name, default bid, CPA goal, Search Match, status), pause, or resume an ad group on Apple Search Ads. pause and resume change only the status; the bid and every other setting stay as they are, and update likewise writes only the fields you send. The ad group's defaultBid depends on the campaign: with manual bidding, create needs one; with automated bidding (MAX_CONVERSIONS) leave it out on create and update alike, because the campaign's strategy sets the bids and the API refuses one. Deleting an ad group is delete_apple_ads_adgroup. ${APPLE_ADS_IDEMPOTENCY_RULE}`

const MANAGE_NEGATIVE_KEYWORDS_DESCRIPTION = `Add or delete negative keywords on Apple Search Ads. A campaign-level negative takes campaignId alone; an ad group-level negative takes adGroupId alone, because Apple does not allow campaignId on it. ${APPLE_ADS_IDEMPOTENCY_RULE}`

const DELETE_CAMPAIGN_DESCRIPTION = `Permanently delete an Apple Ads campaign. Apple deletes its ad groups, keywords and ads with it and restores none of them; pausing it with manage_apple_ads_campaigns is the reversible way to stop its spend. ${DELETE_PROTOCOL}`

const DELETE_ADGROUP_DESCRIPTION = `Permanently delete one Apple Ads ad group; Apple cannot restore it. Pausing it with manage_apple_ads_adgroups is the reversible way to stop it. ${DELETE_PROTOCOL}`

const APPLE_ADS_DELETE_LABEL = {
	campaign: 'Apple Ads campaign',
	adgroup: 'Apple Ads ad group',
} as const

/**
 * The preview names the target, its state and what goes with it. The target is read off the
 * response, as in workspace-writes' deleteSummary.
 */
function appleAdsDeleteSummary(
	result: DeleteAppleAdsCampaignResponse | DeleteAppleAdsAdGroupResponse,
) {
	if (result.status !== 'preview')
		return deleteOutcomeSummary(
			APPLE_ADS_DELETE_LABEL[result.result.target],
			result.result,
			result.replayed,
		)
	const target = `the ${APPLE_ADS_DELETE_LABEL[result.target]} "${result.name}" (ID ${result.targetId}, ${result.impact.status}`
	const what =
		result.target === 'campaign'
			? `${target}, daily budget ${result.impact.dailyBudget} ${result.impact.currency}) removes it and its ${countLabel(result.impact.adGroups)} ad group(s).`
			: `${target}) in campaign "${result.impact.campaignName}" removes it and its ${countLabel(result.impact.targetingKeywords)} targeting keyword(s).`
	return deletePreviewSummary(`Deleting ${what} ${result.impact.cascades}`)
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
			description: MANAGE_CAMPAIGNS_DESCRIPTION,
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
				return errorResult(error, true)
			}
		},
	)

	server.registerTool(
		'delete_apple_ads_campaign',
		{
			title: 'Delete Apple Ads Campaign',
			description: DELETE_CAMPAIGN_DESCRIPTION,
			inputSchema: DeleteAppleAdsCampaignRequestSchema,
			outputSchema: DeleteAppleAdsCampaignResponseSchema,
			annotations: APPLE_ADS_WRITE_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:delete')
				const result = await api.deleteAppleAdsCampaign(
					{ ...principal, tool: 'delete_apple_ads_campaign' },
					request,
				)
				return successResult(result, appleAdsDeleteSummary(result))
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
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
			description: MANAGE_ADGROUPS_DESCRIPTION,
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
				return errorResult(error, true)
			}
		},
	)

	server.registerTool(
		'delete_apple_ads_adgroup',
		{
			title: 'Delete Apple Ads AdGroup',
			description: DELETE_ADGROUP_DESCRIPTION,
			inputSchema: DeleteAppleAdsAdGroupRequestSchema,
			outputSchema: DeleteAppleAdsAdGroupResponseSchema,
			annotations: APPLE_ADS_WRITE_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:delete')
				const result = await api.deleteAppleAdsAdGroup(
					{ ...principal, tool: 'delete_apple_ads_adgroup' },
					request,
				)
				return successResult(result, appleAdsDeleteSummary(result))
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
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
			description: `Create one targeting keyword per call (text, match type, bid), update its bid, pause, resume, or delete it on Apple Search Ads. ${APPLE_ADS_IDEMPOTENCY_RULE}`,
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
				return errorResult(error, true)
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
			description: MANAGE_NEGATIVE_KEYWORDS_DESCRIPTION,
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
				return errorResult(error, true)
			}
		},
	)
}
