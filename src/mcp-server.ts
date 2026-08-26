import { type AuthInfo, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AppActorApiClient } from './appactor-api'
import {
	AnalyticsRequestSchema,
	AppSetupSchema,
	CatalogRequestSchema,
	type Workspace,
	WorkspaceSchema,
} from './contracts'
import {
	READ_TOOL_ANNOTATIONS,
	errorResult,
	requirePrincipal,
	successResult,
} from './tool-runtime'
import { registerCatalogWriteTools } from './tools/catalog-writes'
import { registerConfigTools } from './tools/config-tools'
import { registerSubscriberReadTools } from './tools/subscriber-reads'
import { registerWorkspaceWriteTools } from './tools/workspace-writes'

const SERVER_INSTRUCTIONS =
	'For every logical write, generate one idempotencyKey. If a timeout or uncertain result occurs, retry the exact same arguments with that same key; never generate a new key for the retry. Show an offering publication preview to the user and obtain approval before apply_publish. Never request store credential JSON.'

function workspaceSummary(data: Workspace) {
	const more = data.appsPagination?.hasMore ? ' More apps are available.' : ''
	return `${data.organizations.length} organization(s), ${data.projects.length} project(s), and ${data.apps.length} app(s).${more}`
}

export function createAppActorMcpServer(
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	const server = new McpServer(
		{ name: 'appactor-mcp', version: '0.1.0' },
		{ instructions: SERVER_INSTRUCTIONS },
	)

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
				appCursor: z
					.string()
					.max(2048)
					.optional()
					.describe('Cursor from appsPagination.nextCursor.'),
				appLimit: z.number().int().min(1).max(500).default(100),
			}),
			outputSchema: WorkspaceSchema,
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async ({ organizationId, appCursor, appLimit }) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getWorkspace(
					{ ...principal, tool: 'get_workspace' },
					{ organizationId, appCursor, appLimit },
				)
				return successResult(data, workspaceSummary(data))
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
			outputSchema: AppSetupSchema,
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async ({ organizationId, appId }) => {
			try {
				const principal = requirePrincipal(authInfo, 'workspace:read')
				const data = await api.getAppSetup(
					{ ...principal, tool: 'get_app_setup' },
					organizationId,
					appId,
				)
				return successResult(
					data,
					`${data.app.name} (${data.app.platform}) setup and connection status.`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'query_analytics',
		{
			title: 'Query AppActor Analytics',
			description:
				'Read AppActor dashboard analytics for an accessible organization, project, or app. This tool is read-only.',
			inputSchema: AnalyticsRequestSchema,
			outputSchema: z.object({
				kind: z.string(),
				data: z.record(z.string(), z.unknown()),
				generatedAt: z.string().datetime(),
			}),
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'analytics:read')
				const result = await api.queryAnalytics(
					{ ...principal, tool: 'query_analytics' },
					request,
				)
				return successResult(
					result,
					`${request.kind} analytics result for the requested scope.`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'get_catalog',
		{
			title: 'Read AppActor Catalog',
			description:
				'Read products, entitlements, offerings, packages, and store setup for an accessible AppActor project. This tool is read-only.',
			inputSchema: CatalogRequestSchema,
			outputSchema: z.object({
				view: z.string(),
				data: z.record(z.string(), z.unknown()),
				generatedAt: z.string().datetime(),
			}),
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'catalog:read')
				const result = await api.getCatalog(
					{ ...principal, tool: 'get_catalog' },
					request,
				)
				return successResult(
					result,
					`${request.view} catalog view for project ${request.projectId}.`,
				)
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	registerSubscriberReadTools(server, api, authInfo)
	registerConfigTools(server, api, authInfo)
	registerCatalogWriteTools(server, api, authInfo)
	registerWorkspaceWriteTools(server, api, authInfo)

	return server
}
