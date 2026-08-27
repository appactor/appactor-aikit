export const MCP_SCOPES = [
	'workspace:read',
	'analytics:read',
	'catalog:read',
	'catalog:write',
	'workspace:write',
	'workspace:delete',
	'subscribers:read',
	'config:read',
	'config:write',
	'audit:read',
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

/**
 * Advertised alongside the tool scopes but never required by a tool: a client
 * reads `scopes_supported` to decide what to ask for, and Better Auth mints a
 * refresh token only when `offline_access` is among the scopes it was asked
 * for. Leaving it out is why a connection stopped working an hour after it was
 * approved and had to be approved again in a browser.
 */
export const OAUTH_SCOPES_ADVERTISED = [
	...MCP_SCOPES,
	'offline_access',
] as const

export const TOOL_SCOPES: Record<string, McpScope> = {
	get_workspace: 'workspace:read',
	get_app_setup: 'workspace:read',
	query_analytics: 'analytics:read',
	get_catalog: 'catalog:read',
	get_subscriber: 'subscribers:read',
	get_config: 'config:read',
	get_audit_log: 'audit:read',
	manage_remote_config: 'config:write',
	manage_experiments: 'config:write',
	manage_products: 'catalog:write',
	manage_entitlements: 'catalog:write',
	manage_offerings: 'catalog:write',
	manage_packages: 'catalog:write',
	create_project: 'workspace:write',
	create_app: 'workspace:write',
	delete_project: 'workspace:delete',
	delete_app: 'workspace:delete',
}

export function requiredScopeForRequest(request: Request): McpScope {
	const tool = request.headers.get('mcp-name')
	return (tool && TOOL_SCOPES[tool]) || 'workspace:read'
}
