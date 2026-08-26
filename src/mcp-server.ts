import { type AuthInfo, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { type AppActorApiClient, AppActorApiError } from './appactor-api'

const ObjectOutput = z.looseObject({})

function scopesFrom(authInfo: AuthInfo) {
	return [...new Set(authInfo.scopes)]
}

function requirePrincipal(authInfo: AuthInfo | undefined, scope: string) {
	const userId = authInfo?.extra?.userId
	if (!authInfo || typeof userId !== 'string' || !userId)
		throw new Error('Authenticated user is missing.')
	if (!authInfo.scopes.includes(scope))
		throw new Error(`This tool requires the ${scope} scope.`)
	return { userId, clientId: authInfo.clientId, scopes: scopesFrom(authInfo) }
}

function successResult(data: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
		structuredContent: data,
	}
}

function errorResult(error: unknown) {
	const message =
		error instanceof Error ? error.message : 'Unknown AppActor error.'
	const details =
		error instanceof AppActorApiError
			? { code: error.code, requestId: error.requestId, status: error.status }
			: undefined
	return {
		isError: true,
		content: [
			{
				type: 'text' as const,
				text: details ? `${message}\n${JSON.stringify(details)}` : message,
			},
		],
	}
}

export function createAppActorMcpServer(
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	const server = new McpServer({ name: 'appactor-mcp', version: '0.1.0' })

	server.registerTool(
		'get_workspace',
		{
			title: 'Get AppActor Workspace',
			description:
				'List AppActor organizations. Pass organizationId to include the projects and apps visible to the signed-in user.',
			inputSchema: z.object({
				organizationId: z
					.uuid()
					.optional()
					.describe(
						'Organization ID returned by a previous get_workspace call.',
					),
			}),
			outputSchema: ObjectOutput,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ organizationId }) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				return successResult(
					await api.getWorkspace(
						{ ...principal, tool: 'get_workspace' },
						organizationId,
					),
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'get_app_setup',
		{
			title: 'Get App Setup',
			description:
				'Get safe SDK setup, store connection status, and dashboard links for one accessible AppActor app.',
			inputSchema: z.object({ organizationId: z.uuid(), appId: z.uuid() }),
			outputSchema: ObjectOutput,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ organizationId, appId }) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				return successResult(
					await api.getAppSetup(
						{ ...principal, tool: 'get_app_setup' },
						organizationId,
						appId,
					),
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	return server
}
