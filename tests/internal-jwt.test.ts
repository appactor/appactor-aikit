import { describe, expect, test } from 'bun:test'
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose'
import type { Config } from '../src/config'
import { InternalTokenSigner } from '../src/internal-jwt'

describe('InternalTokenSigner', () => {
	test('binds a short-lived token to one user, client, scope set, and tool', async () => {
		const { privateKey, publicKey } = await generateKeyPair('ES256', {
			extractable: true,
		})
		const config = {
			MCP_INTERNAL_JWT_PRIVATE_KEY: await exportPKCS8(privateKey),
			MCP_INTERNAL_JWT_KEY_ID: 'test-key',
			MCP_INTERNAL_JWT_ISSUER: 'appactor-mcp',
			MCP_INTERNAL_JWT_AUDIENCE: 'appactor-api',
		} as Config
		const token = await new InternalTokenSigner(config).sign({
			userId: 'user-1',
			clientId: 'client-1',
			scopes: ['workspace:read'],
			tool: 'get_workspace',
			method: 'GET',
			target: '/v1/internal/mcp/workspace?organizationId=org-1',
			bodySha256: 'body-digest',
		})
		const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
			issuer: 'appactor-mcp',
			audience: 'appactor-api',
		})

		expect(protectedHeader).toMatchObject({
			alg: 'ES256',
			kid: 'test-key',
			typ: 'JWT',
		})
		expect(payload).toMatchObject({
			sub: 'user-1',
			client_id: 'client-1',
			scope: 'workspace:read',
			tool: 'get_workspace',
			method: 'GET',
			target: '/v1/internal/mcp/workspace?organizationId=org-1',
			body_sha256: 'body-digest',
		})
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(45)
	})
})
