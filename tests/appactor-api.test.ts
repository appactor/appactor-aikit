import { describe, expect, test } from 'bun:test'
import { exportPKCS8, generateKeyPair } from 'jose'
import { AppActorApiClient } from '../src/appactor-api'
import type { Config } from '../src/config'

describe('AppActor API client contracts', () => {
	test('distinguishes malformed upstream data from network failures', async () => {
		const { privateKey } = await generateKeyPair('ES256', { extractable: true })
		const client = new AppActorApiClient(
			{
				APPACTOR_API_URL: 'https://api.example.com',
				APPACTOR_API_TIMEOUT_MS: 1_000,
				MCP_INTERNAL_JWT_PRIVATE_KEY: await exportPKCS8(privateKey),
				MCP_INTERNAL_JWT_KEY_ID: 'test',
				MCP_INTERNAL_JWT_ISSUER: 'appactor-mcp',
				MCP_INTERNAL_JWT_AUDIENCE: 'appactor-api',
			} as Config,
			(async () =>
				Response.json({
					data: { organizations: 'invalid' },
					requestId: 'req-1',
				})) as unknown as typeof fetch,
		)

		await expect(
			client.getWorkspace(
				{
					userId: 'user-1',
					clientId: 'client-1',
					scopes: ['workspace:read'],
					tool: 'get_workspace',
				},
				{},
			),
		).rejects.toMatchObject({
			status: 502,
			code: 'UPSTREAM_CONTRACT_INVALID',
		})
	})
})
