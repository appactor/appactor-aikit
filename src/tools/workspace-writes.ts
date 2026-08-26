import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	CreateAppRequestSchema,
	CreateProjectRequestSchema,
} from '../contracts/write'
import {
	CreateAppResponseSchema,
	CreateProjectResponseSchema,
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
}
