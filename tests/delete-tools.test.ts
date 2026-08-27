import { afterEach, describe, expect, test } from 'bun:test'
import {
	createMcpAppFixture,
	issueAccessToken,
	mcpRpc,
	modernMeta,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import {
	deleteImpact,
	deletePreview,
	ids,
	succeeded,
} from './helpers/write-response-fixtures'

afterEach(stopTestServers)

const previewArguments = {
	action: 'preview',
	organizationId: ids.organization,
	projectId: ids.project,
} as const

describe('MCP delete tools', () => {
	test('a write scope does not carry delete with it', async () => {
		// The whole point of a separate scope: a connection approved before deletion existed must not
		// gain it silently, and the refusal has to happen before the API is ever called.
		let upstreamCalls = 0
		const fixture = await createMcpAppFixture(async () => {
			upstreamCalls += 1
			throw new Error('Delete must not reach the API.')
		})
		const writeToken = await issueAccessToken(fixture, 'workspace:write')
		const response = await mcpRpc(
			fixture,
			writeToken,
			'tools/call',
			{
				name: 'delete_project',
				arguments: previewArguments,
				_meta: modernMeta(),
			},
			'delete_project',
		)
		expect(response.status).toBe(403)
		expect(upstreamCalls).toBe(0)
	})

	test('the preview summary spells out the blast radius and who must confirm', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: deletePreview('project', 'AnimalSound'),
				requestId: 'request-preview',
			}),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_project',
				arguments: previewArguments,
				_meta: modernMeta(),
			},
			'delete_project',
		)
		const body = await response.json()
		expect(response.status).toBe(200)
		expect(body.result?.isError).not.toBe(true)
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('"AnimalSound"')
		expect(text).toContain('1 app(s)')
		expect(text).toContain('2 product(s)')
		// Bounded counts have to read as a floor, not as the exact number.
		expect(text).toContain('10000+ transaction(s)')
		expect(text).toContain('cannot be undone')
		expect(text).toContain('have THEM type the name back')
		// The token has to survive into the structured payload or apply has nothing to send.
		expect(body.result?.structuredContent?.previewToken).toBe('p'.repeat(48))
	})

	test('reports an already-deleted target as done rather than as an error', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: succeeded('apply', {
					deleted: true,
					alreadyAbsent: true,
					target: 'app',
					targetId: ids.resource,
					name: 'AnimalSound iOS',
					impact: null,
				}),
				requestId: 'request-absent',
			}),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_app',
				arguments: {
					action: 'apply',
					organizationId: ids.organization,
					idempotencyKey: 'delete-app-retry-1',
					previewToken: 'p'.repeat(48),
					confirmName: 'AnimalSound iOS',
				},
				_meta: modernMeta(),
			},
			'delete_app',
		)
		const body = await response.json()
		expect(response.status).toBe(200)
		expect(body.result?.isError).not.toBe(true)
		expect(body.result?.content?.[0]?.text).toContain('was already deleted')
	})

	test('confirms with the name the API reported, not one the caller invented', async () => {
		// The API is the one that compares confirmName against the signed token; the tool must pass
		// it through untouched so that comparison is meaningful.
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: succeeded('apply', {
					deleted: true,
					alreadyAbsent: false,
					target: 'project',
					targetId: ids.project,
					name: 'AnimalSound',
					impact: deleteImpact,
				}),
				requestId: 'request-apply',
			})
		})
		const token = await issueAccessToken(fixture, 'workspace:delete')
		await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_project',
				arguments: {
					action: 'apply',
					organizationId: ids.organization,
					idempotencyKey: 'delete-project-apply-1',
					previewToken: 'p'.repeat(48),
					confirmName: 'AnimalSound',
				},
				_meta: modernMeta(),
			},
			'delete_project',
		)
		expect(bodies).toHaveLength(1)
		expect(bodies[0]).toMatchObject({
			action: 'apply',
			confirmName: 'AnimalSound',
			previewToken: 'p'.repeat(48),
		})
	})

	test('tells the model to reuse the key when an apply times out', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json(
				{
					error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out.' },
					requestId: 'request-timeout',
				},
				{ status: 504 },
			),
		)
		const token = await issueAccessToken(fixture, 'workspace:delete')
		const response = await mcpRpc(
			fixture,
			token,
			'tools/call',
			{
				name: 'delete_project',
				arguments: {
					action: 'apply',
					organizationId: ids.organization,
					idempotencyKey: 'delete-project-timeout-1',
					previewToken: 'p'.repeat(48),
					confirmName: 'AnimalSound',
				},
				_meta: modernMeta(),
			},
			'delete_project',
		)
		const body = await response.json()
		expect(body.result?.isError).toBe(true)
		expect(body.result?.content?.[0]?.text).toContain('same idempotencyKey')
	})
})
