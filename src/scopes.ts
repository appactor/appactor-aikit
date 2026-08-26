export const MCP_SCOPES = ['workspace:read'] as const

export type McpScope = (typeof MCP_SCOPES)[number]

const TOOL_SCOPES: Record<string, McpScope> = {
	get_workspace: 'workspace:read',
	get_app_setup: 'workspace:read',
}

export function requiredScopeForRequest(request: Request): McpScope {
	const tool = request.headers.get('mcp-name')
	return (tool && TOOL_SCOPES[tool]) || 'workspace:read'
}
