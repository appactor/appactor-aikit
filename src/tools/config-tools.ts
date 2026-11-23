import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	AuditRequestSchema,
	AuditResponseSchema,
	ConfigRequestSchema,
	ConfigResponseSchema,
	type ConfigWriteResponse,
	ConfigWriteResponseSchema,
	ManageExperimentsRequestSchema,
	ManageRemoteConfigRequestSchema,
} from '../contracts/config'
import {
	READ_TOOL_ANNOTATIONS,
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'

function writeSummary(domain: string, result: ConfigWriteResponse) {
	return `${domain} ${result.action} succeeded${result.replayed ? ' (replayed)' : ''}.`
}

/**
 * The API freezes an experiment's analysis plan at its first assignment
 * (ExperimentAnalysisPlanLockedError). Variant batch creation is not on the
 * list on purpose: it only runs on an experiment with no variants, so it is
 * refused earlier and never reaches the 409.
 */
const EXPERIMENT_PLAN_LOCK_RULE =
	'Once any user is assigned, the analysis plan is locked: variants, weights, goals and the whale cap can no longer change (nor the traffic allocation on an experiment with bucketingVersion 1), and a variant keeps only its name editable. A change is refused with 409 EXPERIMENT_ANALYSIS_PLAN_LOCKED, whose details.fields name what was refused; resending the stored value is accepted. get_config shows the lock as lifecycle.analysisPlanLocked.'

const EXPERIMENT_ROLLOUT_RULE =
	"To give one variant to everyone, use rollout_variant, never new weights. It ends the experiment (status stopped) and serves that variant to the experiment's whole audience: everyone matching its targeting plus every user it already assigned, whatever the traffic allocation or newUsersOnly. Apps pick it up within about five minutes. The verdict freezes on the rollout day, so rolling out before there is one means the experiment never gets one. Only a started experiment can roll out, and rolling out another run of the same key replaces that run's rollout (supersededExperimentId). clear_rollout stops serving the variant; the experiment stays stopped and its results stay frozen. get_config shows the active rollout as lifecycle.rollout."

const EXPERIMENT_LIVE_CHANGE_RULE =
	'Rolling out, starting or stopping an experiment changes what live customers see, so confirm with the user first.'

/** How to read an experiment result; shared by the tool that reads results and the one that acts on them. */
const EXPERIMENT_RESULTS_RULE =
	"An experiment has one verdict, its result summary's decision (results.decision in get_config), the same in every resultMode: resultMode changes only the descriptive totals. status winner or control_wins with isReady true is a verdict; beside a winner check guardrailStatus (guardrail_regression: the winner is proven worse on a guardrail; maturing: a guardrail is not tested for it yet). status collecting means wait: decision.earliestVerdictAt, when set, is the earliest time a verdict can come (a verdict also needs enough paying users and a significant difference), roughly day 14 after the first assignment for a userToTrialConversionRate or newTrials primary goal and roughly day 37 for any other. An SRM mismatch (srm.status mismatch; decision status locked, reason srm_mismatch) means users did not split as the weights say, so the results cannot be trusted."

const GET_CONFIG_DESCRIPTION = [
	'Read remote config values with their targeting rules, and experiments with their variants, lifecycle and result summaries.',
	EXPERIMENT_RESULTS_RULE,
	'Every write to these resources needs the updatedAt this tool returns, so read before you write. This tool is read-only.',
].join(' ')

const MANAGE_EXPERIMENTS_DESCRIPTION = [
	'Create or update experiments and their variants; start, pause, resume, stop, or return an experiment to draft; roll one variant out to everyone, or stop serving a rollout.',
	'Variant weights are basis points and must sum to 10000. update, update_variant and replace_variant_weights work only on a draft or paused experiment, and create_variants only while it has no variants.',
	EXPERIMENT_PLAN_LOCK_RULE,
	EXPERIMENT_ROLLOUT_RULE,
	EXPERIMENT_LIVE_CHANGE_RULE,
	EXPERIMENT_RESULTS_RULE,
	'Deleting an experiment or a variant is not available.',
].join(' ')

function experimentWriteSummary(result: ConfigWriteResponse) {
	// Only rollout_variant returns it. Printed because a text-only client would
	// otherwise never learn that another run of the key stopped serving.
	const superseded = result.result.supersededExperimentId
	const replaced =
		typeof superseded === 'string'
			? ` It replaced the rollout of experiment ${superseded}, another run of the same key, which no longer serves a variant.`
			: ''
	return `${writeSummary('Experiment', result)}${replaced}`
}

export function registerConfigTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	server.registerTool(
		'get_config',
		{
			title: 'Read AppActor Remote Config and Experiments',
			description: GET_CONFIG_DESCRIPTION,
			inputSchema: ConfigRequestSchema,
			outputSchema: ConfigResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'config:read')
				const result = await api.getConfig(
					{ ...principal, tool: 'get_config' },
					request,
				)
				return successResult(
					result,
					`${request.view} result for the requested scope.`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'get_audit_log',
		{
			title: 'Read AppActor Change History',
			description:
				'Read the record of changes made to this AppActor organization: actor, client, tool, action, outcome, and the resources touched. source "mcp" (the default) is what AI clients changed; source "dashboard" is what people changed through the AppActor dashboard or admin API. Defaults to the caller own operations; the organization scope needs the AppActor team.manage permission.',
			inputSchema: AuditRequestSchema,
			outputSchema: AuditResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'audit:read')
				const result = await api.getAuditLog(
					{ ...principal, tool: 'get_audit_log' },
					request,
				)
				const items = Array.isArray(result.data.items)
					? result.data.items.length
					: 0
				return successResult(
					result,
					`${items} MCP write operation(s) in the ${result.scope} scope.`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'manage_remote_config',
		{
			title: 'Manage AppActor Remote Config',
			description:
				'Create or update remote config values, platform overrides, and targeting rules. Updates require the expectedUpdatedAt read from get_config, and replace_rules replaces every rule on the config. Remote config deletion is not available.',
			inputSchema: ManageRemoteConfigRequestSchema,
			outputSchema: ConfigWriteResponseSchema,
			annotations: writeToolAnnotations(true, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'config:write')
				const result = await api.manageRemoteConfig(
					{ ...principal, tool: 'manage_remote_config' },
					request,
				)
				return successResult(result, writeSummary('Remote config', result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)

	server.registerTool(
		'manage_experiments',
		{
			title: 'Manage AppActor Experiments',
			description: MANAGE_EXPERIMENTS_DESCRIPTION,
			inputSchema: ManageExperimentsRequestSchema,
			outputSchema: ConfigWriteResponseSchema,
			annotations: writeToolAnnotations(true, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'config:write')
				const result = await api.manageExperiments(
					{ ...principal, tool: 'manage_experiments' },
					request,
				)
				return successResult(result, experimentWriteSummary(result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)
}
