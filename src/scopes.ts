export const MCP_SCOPES = [
	'workspace:read',
	'analytics:read',
	'catalog:read',
	'catalog:write',
	'workspace:write',
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

const TOOL_SCOPES: Record<string, McpScope> = {
	get_workspace: 'workspace:read',
	get_app_setup: 'workspace:read',
	query_analytics: 'analytics:read',
	get_catalog: 'catalog:read',
	manage_products: 'catalog:write',
	manage_entitlements: 'catalog:write',
	manage_offerings: 'catalog:write',
	manage_packages: 'catalog:write',
	create_project: 'workspace:write',
	create_app: 'workspace:write',
}

export function requiredScopeForRequest(request: Request): McpScope {
	const tool = request.headers.get('mcp-name')
	return (tool && TOOL_SCOPES[tool]) || 'workspace:read'
}
