import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config'

const valid = {
	MCP_RESOURCE_URL: 'https://mcp.example.com/mcp',
	MCP_AUTH_ISSUER: 'https://auth.example.com',
	MCP_AUTH_JWKS_URL: 'https://auth.example.com/api/auth/jwks',
	APPACTOR_API_URL: 'https://api.example.com',
	MCP_INTERNAL_JWT_PRIVATE_KEY: 'private-key',
}

describe('loadConfig', () => {
	test('applies bounded operational defaults', () => {
		const config = loadConfig(valid)
		expect(config.PORT).toBe(3100)
		expect(config.MCP_INTERNAL_JWT_ISSUER).toBe('appactor-mcp')
		expect(config.APPACTOR_API_TIMEOUT_MS).toBe(8_000)
	})

	test('rejects a non-URL MCP resource', () => {
		expect(() =>
			loadConfig({ ...valid, MCP_RESOURCE_URL: 'not-a-url' }),
		).toThrow()
	})

	test('requires protected metrics in production', () => {
		expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(
			'MCP_METRICS_AUTH_TOKEN',
		)
		expect(
			loadConfig({
				...valid,
				NODE_ENV: 'production',
				MCP_METRICS_AUTH_TOKEN: 'm'.repeat(32),
			}).NODE_ENV,
		).toBe('production')
	})
})
