import { afterEach, describe, expect, test } from 'bun:test'
import {
	issueAccessToken as accessToken,
	createMcpAppFixture,
	modernMeta,
	mcpRpc as rpc,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import { ids } from './helpers/write-response-fixtures'

afterEach(stopTestServers)

const organizationId = ids.organization

function rateLimited(retryAfter?: string) {
	return async () =>
		Response.json(
			{
				error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
				requestId: 'req-429',
			},
			{ status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
		)
}

async function callTool(
	name: string,
	scope: string,
	args: Record<string, unknown>,
	fetcher: typeof fetch,
) {
	const fixture = await createMcpAppFixture(fetcher)
	const token = await accessToken(fixture, scope)
	const response = await rpc(
		fixture,
		token,
		'tools/call',
		{ name, arguments: args, _meta: modernMeta() },
		name,
	)
	return (await response.json()).result
}

describe('rate limit handling', () => {
	test('tells the model how long to wait, using the upstream Retry-After', async () => {
		const result = await callTool(
			'get_workspace',
			'workspace:read',
			{ appLimit: 100 },
			rateLimited('42') as unknown as typeof fetch,
		)
		expect(result.isError).toBe(true)
		expect(result.content[0].text).toContain('Wait 42 second(s)')
		expect(result.content[0].text).toContain('Nothing was changed')
	})

	test('falls back to a sane wait when the header is missing or nonsense', async () => {
		for (const header of [undefined, 'not-a-number']) {
			const result = await callTool(
				'get_catalog',
				'catalog:read',
				{ view: 'context', organizationId, projectId: ids.project },
				rateLimited(header) as unknown as typeof fetch,
			)
			expect(result.content[0].text).toContain('Wait 60 second(s)')
		}
	})

	test('does not tell a write to retry with the same key after a 429', async () => {
		// A 429 is not an uncertain outcome: nothing was written, and replaying
		// the key immediately would just hit the limit again.
		const result = await callTool(
			'manage_entitlements',
			'catalog:write',
			{
				action: 'create',
				organizationId,
				idempotencyKey: 'create-entitlement-1',
				projectId: ids.project,
				lookupKey: 'premium',
			},
			rateLimited('30') as unknown as typeof fetch,
		)
		expect(result.isError).toBe(true)
		expect(result.content[0].text).toContain('Wait 30 second(s)')
		expect(result.content[0].text).not.toContain('same idempotencyKey')
	})

	test('still tells a write to reuse its key when the outcome is genuinely uncertain', async () => {
		const result = await callTool(
			'manage_entitlements',
			'catalog:write',
			{
				action: 'create',
				organizationId,
				idempotencyKey: 'create-entitlement-1',
				projectId: ids.project,
				lookupKey: 'premium',
			},
			(async () =>
				Response.json(
					{
						error: {
							code: 'TEMPORARY_UNAVAILABLE',
							message: 'The outcome could not be confirmed.',
						},
					},
					{ status: 503 },
				)) as unknown as typeof fetch,
		)
		expect(result.content[0].text).toContain('same idempotencyKey')
		expect(result.content[0].text).not.toContain('Wait')
	})
})
