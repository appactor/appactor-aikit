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
} from '../contracts/write-responses'
import {
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'

function createSummary(
	resource: string,
	result: { status: string; replayed?: boolean; message?: string },
) {
	if (result.status === 'action_required')
		return (
			result.message ?? `${resource} requires an AppActor dashboard action.`
		)
	return `${resource} created${result.replayed ? ' (replayed)' : ''}.`
}

type BoundedCount = { count: number; atLeast: boolean }
type DeleteResult =
	| {
			status: 'preview'
			name: string
			impact: {
				apps: number
				products: number
				entitlements: number
				offerings: number
				packages: number
				subscribers: BoundedCount
				transactions: BoundedCount
			}
	  }
	| {
			status: 'succeeded'
			replayed: boolean
			result: { alreadyAbsent: boolean; name: string }
	  }

function countLabel(value: BoundedCount) {
	return value.atLeast ? `${value.count}+` : `${value.count}`
}

function deleteSummary(resource: string, result: DeleteResult) {
	if (result.status === 'preview') {
		const { impact } = result
		const parts = [
			`${impact.apps} app(s)`,
			`${impact.products} product(s)`,
			`${impact.entitlements} entitlement(s)`,
			`${impact.offerings} offering(s)`,
			`${impact.packages} package(s)`,
			`${countLabel(impact.subscribers)} subscriber(s)`,
			`${countLabel(impact.transactions)} transaction(s)`,
		]
		// Deliberately spelled out rather than summarised: this string is what the user is being asked
		// to approve, and the confirmation they have to type is the name, not a yes.
		return `Deleting the ${resource} "${result.name}" permanently destroys ${parts.join(', ')}. This cannot be undone. Show this to the user and have THEM type the name back before calling apply.`
	}
	if (result.result.alreadyAbsent) {
		return `The ${resource} "${result.result.name}" was already deleted; nothing to do.`
	}
	return `${resource} "${result.result.name}" deleted${result.replayed ? ' (replayed)' : ''}.`
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
				'Permanently delete a project and every app, product, subscriber and transaction inside it. Two steps: call with action "preview" to get the blast radius and a short-lived previewToken, show that to the user, then call action "apply" with the token and the project name the USER typed back. Never type the confirmation on the user\'s behalf. This cannot be undone.',
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
				return successResult(
					result,
					deleteSummary('project', result as DeleteResult),
				)
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
				'Permanently delete one app and every product, subscriber and transaction inside it. Project-level entitlements and offerings survive. Two steps: call with action "preview" to get the blast radius and a short-lived previewToken, show that to the user, then call action "apply" with the token and the app name the USER typed back. Never type the confirmation on the user\'s behalf. This cannot be undone.',
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
				return successResult(
					result,
					deleteSummary('app', result as DeleteResult),
				)
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
			}
		},
	)
}
