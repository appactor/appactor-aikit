import { SignJWT, exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { createApp } from '../../src/app'
import type { Config } from '../../src/config'

const activeServers: Array<ReturnType<typeof Bun.serve>> = []

export function stopTestServers() {
	for (const server of activeServers.splice(0)) server.stop(true)
}

export async function createMcpAppFixture(
	fetcher?: (request: Request) => Promise<Response>,
) {
	const oauthKeys = await generateKeyPair('ES256', { extractable: true })
	const internalKeys = await generateKeyPair('ES256', { extractable: true })
	const jwk = await exportJWK(oauthKeys.publicKey)
	Object.assign(jwk, { alg: 'ES256', kid: 'oauth-test', use: 'sig' })
	const jwks = Bun.serve({
		port: 0,
		fetch: () => Response.json({ keys: [jwk] }),
	})
	activeServers.push(jwks)

	const config: Config = {
		NODE_ENV: 'test',
		PORT: 3100,
		LOG_LEVEL: 'error',
		MCP_RESOURCE_URL: 'https://mcp.example.com/mcp',
		MCP_AUTH_ISSUER: 'https://auth.example.com',
		MCP_AUTH_JWKS_URL: new URL('/jwks', jwks.url).toString(),
		APPACTOR_API_URL: 'https://api.example.com',
		MCP_INTERNAL_JWT_PRIVATE_KEY: await exportPKCS8(internalKeys.privateKey),
		MCP_INTERNAL_JWT_KEY_ID: 'internal-test',
		MCP_INTERNAL_JWT_ISSUER: 'appactor-mcp',
		MCP_INTERNAL_JWT_AUDIENCE: 'appactor-api',
		APPACTOR_API_TIMEOUT_MS: 1_000,
	}

	return {
		app: await createApp(
			config,
			(fetcher ??
				(() =>
					Promise.reject(new Error('Unexpected API call')))) as typeof fetch,
		),
		config,
		oauthKeys,
		internalPublicKey: internalKeys.publicKey,
	}
}

export function modernMeta() {
	return {
		'io.modelcontextprotocol/protocolVersion': '2026-07-28',
		'io.modelcontextprotocol/clientCapabilities': {},
	}
}

export type McpAppFixture = Awaited<ReturnType<typeof createMcpAppFixture>>

export function issueAccessToken(fixture: McpAppFixture, scope: string) {
	return new SignJWT({ client_id: 'codex-client', scope })
		.setProtectedHeader({ alg: 'ES256', kid: 'oauth-test' })
		.setIssuer(fixture.config.MCP_AUTH_ISSUER)
		.setAudience(fixture.config.MCP_RESOURCE_URL)
		.setSubject('user-1')
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(fixture.oauthKeys.privateKey)
}

export function mcpRpc(
	fixture: McpAppFixture,
	token: string,
	method: string,
	params: Record<string, unknown>,
	toolName?: string,
) {
	return fixture.app.request('https://mcp.example.com/mcp', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'mcp-method': method,
			...(toolName ? { 'mcp-name': toolName } : {}),
			'mcp-protocol-version': '2026-07-28',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: toolName ?? method,
			method,
			params,
		}),
	})
}
