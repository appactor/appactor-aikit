import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	CreateAppRequestSchema,
	CreateProjectRequestSchema,
	DeleteAppRequestSchema,
	DeleteProjectRequestSchema,
} from '../contracts/write'
import {
	CreateAppResponseSchema,
	CreateProjectResponseSchema,
	DeleteAppResponseSchema,
	DeleteProjectResponseSchema,
	type DeleteResponse,
} from '../contracts/write-responses'
import {
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'

function createSummary(
	resource: string,
	result: {
		status: string
		replayed?: boolean
		message?: string
		result?: Record<string, unknown>
	},
) {
	if (result.status === 'action_required')
		return (
			result.message ?? `${resource} requires an AppActor dashboard action.`
		)
	// The warning is the whole reason the field exists; a client that renders only the text half
	// would otherwise drop "this app has no Apple credential bound" on the floor.
	const warning = result.result?.appleConnectionWarning
	if (typeof warning !== 'string') {
		return `${resource} created${result.replayed ? ' (replayed)' : ''}.`
	}
	return `${resource} created${result.replayed ? ' (replayed)' : ''}. ${warning}`
}

function countLabel(value: { count: number; atLeast: boolean }) {
	return value.atLeast ? `${value.count}+` : `${value.count}`
}

/**
 * Only the clauses that can be non-zero for this target. An app delete leaves the project's
 * entitlements, offerings and packages standing, and padding its one sentence with three "0 (s)"
 * clauses buries the numbers that matter in the one place a human is meant to read carefully.
 */
function impactClauses(impact: DeleteImpact, target: 'project' | 'app') {
	const clauses =
		target === 'project'
			? [
					`${impact.apps} app(s)`,
					`${impact.products} product(s)`,
					`${impact.entitlements} entitlement(s)`,
					`${impact.offerings} offering(s)`,
					`${impact.packages} package(s)`,
					`${impact.remoteConfigs} remote config(s)`,
					`${impact.experiments} experiment(s)`,
					`${impact.tokenBalances} customer token balance(s)`,
					`${impact.secretKeys} project secret key(s)`,
				]
			: [
					`${impact.products} product(s)`,
					`${impact.packageProducts} package binding(s)`,
					`${impact.productEntitlements} entitlement binding(s)`,
					`${impact.remoteConfigs} remote config(s)`,
					`${impact.experiments} experiment(s)`,
				]
	return [
		...clauses,
		`${countLabel(impact.subscribers)} subscriber(s)`,
		`${countLabel(impact.transactions)} transaction(s)`,
	]
}

function namedApps(impact: DeleteImpact) {
	if (impact.appNames.length === 0) return ''
	const shown = impact.appNames.join(', ')
	// Never present a sampled list as the whole list.
	return impact.appNamesTruncated
		? ` Apps include: ${shown}, and ${impact.apps - impact.appNames.length} more.`
		: ` Apps: ${shown}.`
}

type DeleteImpact = Extract<DeleteResponse, { status: 'preview' }>['impact']

function deleteSummary(target: 'project' | 'app', result: DeleteResponse) {
	if (result.status === 'preview') {
		const { impact } = result
		const analytics = impact.analyticsPurged
			? ' The analytics history is permanently purged too.'
			: ''
		// Deliberately spelled out rather than summarised: this string is what the user is being asked
		// to approve, and the confirmation they have to type is the name, not a yes.
		const stop =
			'STOP HERE. End your turn with this text and wait. Do not call apply in this turn. Apply belongs in a LATER turn, only after the user has replied with the name themselves — the name they used when asking for the deletion does not count, and neither does this preview.'
		return `Deleting the ${target} "${result.name}" permanently destroys ${impactClauses(impact, target).join(', ')}.${namedApps(impact)}${analytics} This cannot be undone.\n\n${stop}`
	}
	if (result.result.alreadyAbsent) {
		return `The ${target} "${result.result.name}" was already deleted; nothing to do.`
	}
	return `${target} "${result.result.name}" deleted${result.replayed ? ' (replayed)' : ''}.`
}

export function registerWorkspaceWriteTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	server.registerTool(
		'create_project',
		{
			title: 'Create AppActor Project',
			description:
				'Idempotently create a project when the signed-in AppActor member has projects.create permission.',
			inputSchema: CreateProjectRequestSchema,
			outputSchema: CreateProjectResponseSchema,
			annotations: writeToolAnnotations(false, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:write')
				const result = await api.createProject(
					{ ...principal, tool: 'create_project' },
					request,
				)
				return successResult(result, createSummary('Project', result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)

	server.registerTool(
		'create_app',
		{
			title: 'Create AppActor App',
			description:
				'Idempotently add an iOS or Android app to an accessible project. Credential JSON is never accepted; required credential setup returns a dashboard URL.',
			inputSchema: CreateAppRequestSchema,
			outputSchema: CreateAppResponseSchema,
			annotations: writeToolAnnotations(false, true),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:write')
				const result = await api.createApp(
					{ ...principal, tool: 'create_app' },
					request,
				)
				return successResult(result, createSummary('App', result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)

	server.registerTool(
		'delete_project',
		{
			title: 'Delete AppActor Project',
			description:
				'Permanently delete a project and everything inside it: every app, product, subscriber, purchase, remote config, experiment and customer token balance, plus the analytics history. Two steps. First call action "preview" for the blast radius and a previewToken that expires in five minutes. Show it and END YOUR TURN. Then, in a LATER turn, call action "apply" with that token and confirmName set to the name the user typed in a new message of their own. The name they used when asking for the deletion does not count, nor does any name already in this conversation, nor the one in the preview. If there is no interactive user — an unattended or automated run — do not call apply at all; say deletion needs a person and stop. This cannot be undone.',
			inputSchema: DeleteProjectRequestSchema,
			outputSchema: DeleteProjectResponseSchema,
			annotations: writeToolAnnotations(true, true),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:delete')
				const result = await api.deleteProject(
					{ ...principal, tool: 'delete_project' },
					request,
				)
				return successResult(result, deleteSummary('project', result))
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
			}
		},
	)

	server.registerTool(
		'delete_app',
		{
			title: 'Delete AppActor App',
			description:
				'Permanently delete one app and every product, subscriber, purchase, remote config and experiment inside it, plus its analytics history. The project\'s entitlement, offering and package ROWS survive, but this app\'s products are stripped out of them, so a shared package can be left with nothing bound on this platform — the preview counts those bindings. Two steps. First call action "preview" for the blast radius and a previewToken that expires in five minutes. Show it and END YOUR TURN. Then, in a LATER turn, call action "apply" with that token and confirmName set to the name the user typed in a new message of their own. The name they used when asking for the deletion does not count, nor does any name already in this conversation, nor the one in the preview. If there is no interactive user — an unattended or automated run — do not call apply at all; say deletion needs a person and stop. This cannot be undone.',
			inputSchema: DeleteAppRequestSchema,
			outputSchema: DeleteAppResponseSchema,
			annotations: writeToolAnnotations(true, true),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:delete')
				const result = await api.deleteApp(
					{ ...principal, tool: 'delete_app' },
					request,
				)
				return successResult(result, deleteSummary('app', result))
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
			}
		},
	)
}
