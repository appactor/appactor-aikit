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

export function registerConfigTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	server.registerTool(
		'get_config',
		{
			title: 'Read AppActor Remote Config and Experiments',
			description:
				'Read remote config values with their targeting rules, and experiments with their variants and result summaries. Every write to these resources needs the updatedAt this tool returns, so read before you write. This tool is read-only.',
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
			description:
				'Create or update experiments and their variants, and start, pause, resume, stop, or return an experiment to draft. Variant weights are basis points and must sum to 10000. Deleting an experiment or a variant is not available. Starting or stopping an experiment changes what live customers see, so confirm with the user first.',
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
				return successResult(result, writeSummary('Experiment', result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)
}
