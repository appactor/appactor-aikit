import { afterEach, describe, expect, test } from 'bun:test'
import {
	createMcpAppFixture,
	issueAccessToken,
	mcpRpc,
	modernMeta,
	stopTestServers,
} from './helpers/mcp-app-fixture'
import {
	appSetup,
	appleWebhookNotVerified,
	credentialActionRequired,
	ids,
	refundSaverChange,
	refundSaverView,
	updateOutcome,
} from './helpers/write-response-fixtures'

afterEach(stopTestServers)

async function call(
	fixture: Awaited<ReturnType<typeof createMcpAppFixture>>,
	scope: string,
	name: string,
	args: Record<string, unknown>,
) {
	const token = await issueAccessToken(fixture, scope)
	const response = await mcpRpc(
		fixture,
		token,
		'tools/call',
		{ name, arguments: args, _meta: modernMeta() },
		name,
	)
	return { response, body: await response.json() }
}

const updateArgs = {
	organizationId: ids.organization,
	idempotencyKey: 'update-app-1',
	appId: ids.resource,
}

describe('update_app', () => {
	test('sends only the fields the caller named', async () => {
		// The API writes exactly the keys present on the body, so a tool that filled in the untouched
		// ones would turn "change the credential" into "change the credential and clear the bundle id".
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: updateOutcome({ changed: ['credential'] }),
				requestId: 'request-update',
			})
		})
		await call(fixture, 'workspace:write', 'update_app', {
			...updateArgs,
			credentialName: 'AnimalSound ASC',
		})
		expect(bodies).toHaveLength(1)
		expect(Object.keys(bodies[0] as object).sort()).toEqual([
			'appId',
			'credentialName',
			'idempotencyKey',
			'organizationId',
		])
	})

	test('carries an explicit null through, because null is how you unbind', async () => {
		// A tool that dropped nulls alongside undefined would make "remove the Apple Ads connection"
		// silently do nothing and report success.
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: updateOutcome({ changed: ['asaConnection'] }),
				requestId: 'request-unbind',
			})
		})
		const { body } = await call(fixture, 'workspace:write', 'update_app', {
			...updateArgs,
			asaConnectionName: null,
		})
		expect(bodies[0]).toHaveProperty('asaConnectionName', null)
		// And the sentence says what unbinding did and did not do -- "removed" reads like a deletion.
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('imports stop')
		expect(text).toContain('nothing was deleted')
	})

	test('reports the Apple probe result, not just that the write succeeded', async () => {
		// Changing the credential resets the stored Apple state to not_configured, so "updated." on its
		// own leaves the caller looking at an app that reads as broken with no way to tell if it is.
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: updateOutcome({
					changed: ['credential'],
					appleConnection: {
						status: 'invalid',
						lastErrorCode: 'app_not_found',
						lastError: 'This key has no access to com.example.app.',
					},
				}),
				requestId: 'request-probe',
			}),
		)
		const { body } = await call(fixture, 'workspace:write', 'update_app', {
			...updateArgs,
			credentialName: 'Wrong Team ASC',
		})
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('invalid')
		expect(text).toContain('This key has no access to com.example.app.')
	})

	test('says the Apple Ads import has not started yet, so a fresh binding does not read as broken', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: updateOutcome({
					changed: ['asaConnection'],
					asaConnection: {
						name: 'WatchFace - Hedef Ulke',
						appleOrgId: 21_983_892,
					},
				}),
				requestId: 'request-asa',
			}),
		)
		const { body } = await call(fixture, 'workspace:write', 'update_app', {
			...updateArgs,
			asaConnectionName: 'WatchFace - Hedef Ulke',
		})
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('"WatchFace - Hedef Ulke"')
		expect(text).toContain('first ASA-attributed install')
	})

	test('turns an ambiguous credential into names the caller can retry with', async () => {
		// Before names existed this case was a dead end: more than one credential meant "open the
		// dashboard". The choices are the whole point, so they have to reach the text half too.
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: credentialActionRequired({
					choices: ['AnimalSound ASC', 'WatchFace ASC'],
				}),
				requestId: 'request-choices',
			}),
		)
		const { response, body } = await call(
			fixture,
			'workspace:write',
			'update_app',
			{ ...updateArgs, credentialName: 'Typo ASC' },
		)
		expect(response.status).toBe(200)
		expect(body.result?.isError).not.toBe(true)
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('"AnimalSound ASC"')
		expect(text).toContain('"WatchFace ASC"')
	})

	test('is not reachable with a delete-only grant', async () => {
		let upstreamCalls = 0
		const fixture = await createMcpAppFixture(async () => {
			upstreamCalls += 1
			throw new Error('update_app must not reach the API.')
		})
		const { response } = await call(fixture, 'workspace:delete', 'update_app', {
			...updateArgs,
			name: 'Renamed',
		})
		expect(response.status).toBe(403)
		expect(response.headers.get('www-authenticate')).toContain(
			'workspace:write',
		)
		expect(upstreamCalls).toBe(0)
	})
})

const refundArgs = {
	organizationId: ids.organization,
	idempotencyKey: 'refund-saver-1',
	appId: ids.resource,
}

describe('Refund Saver tools', () => {
	test('a workspace:write grant does not carry refund handling with it', async () => {
		// The whole point of the separate scope: prefer_grant_full hands customer money back, and every
		// connection approved before this feature existed approved creating and changing apps, not that.
		let upstreamCalls = 0
		const fixture = await createMcpAppFixture(async () => {
			upstreamCalls += 1
			throw new Error('Refund Saver must not reach the API.')
		})
		const { response } = await call(
			fixture,
			'workspace:write',
			'manage_refund_saver',
			{ ...refundArgs, mode: 'prefer_decline' },
		)
		expect(response.status).toBe(403)
		expect(response.headers.get('www-authenticate')).toContain('refunds:write')
		expect(upstreamCalls).toBe(0)
	})

	test('reading it does not require the write scope', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({ data: refundSaverView(), requestId: 'request-read' }),
		)
		const { response, body } = await call(
			fixture,
			'refunds:read',
			'get_refund_saver',
			{ organizationId: ids.organization, appId: ids.resource },
		)
		expect(response.status).toBe(200)
		expect(body.result?.isError).not.toBe(true)
	})

	test('a write grant alone cannot read it either', async () => {
		// Both directions, because TOOL_SCOPES maps one scope per tool and a copy-paste between the two
		// registrations would be invisible from the write side alone.
		const fixture = await createMcpAppFixture(async () => {
			throw new Error('get_refund_saver must not reach the API.')
		})
		const { response } = await call(
			fixture,
			'refunds:write',
			'get_refund_saver',
			{ organizationId: ids.organization, appId: ids.resource },
		)
		expect(response.status).toBe(403)
		expect(response.headers.get('www-authenticate')).toContain('refunds:read')
	})

	test('calls an app OFF when the mode does nothing, whatever the stored toggle says', async () => {
		// The dashboard can save enabled: true with the mode left at do_not_handle. The worker returns
		// before contacting Apple in that mode, so reporting "set to do_not_handle" as if it were on
		// would describe an app that answers nothing as configured.
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: refundSaverView({
					mode: 'do_not_handle',
					enabled: true,
					active: false,
					effect:
						'Refund Saver is off. Apple decides alone and AppActor answers nothing.',
				}),
				requestId: 'request-inert',
			}),
		)
		const { body } = await call(fixture, 'refunds:read', 'get_refund_saver', {
			organizationId: ids.organization,
			appId: ids.resource,
		})
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('Refund Saver is OFF')
		expect(text).not.toContain('ACTIVE')
	})

	test('says why it cannot be turned on when the webhook is not verified', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: refundSaverView({
					mode: 'do_not_handle',
					canEnable: false,
					appleWebhook: appleWebhookNotVerified,
				}),
				requestId: 'request-gate',
			}),
		)
		const { body } = await call(fixture, 'refunds:read', 'get_refund_saver', {
			organizationId: ids.organization,
			appId: ids.resource,
		})
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('cannot be turned on yet')
		expect(text).toContain('not_verified')
	})

	test('reports what the mode changed from, not just what it is now', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: refundSaverChange({ previousMode: 'do_not_handle' }),
				requestId: 'request-change',
			}),
		)
		const { body } = await call(
			fixture,
			'refunds:write',
			'manage_refund_saver',
			{ ...refundArgs, mode: 'prefer_decline' },
		)
		const text = body.result?.content?.[0]?.text as string
		expect(text).toContain('from do_not_handle to prefer_decline')
		expect(text).toContain('DECLINE')
	})

	test('does not claim a change when the mode was already set', async () => {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: refundSaverChange({ previousMode: 'prefer_decline' }),
				requestId: 'request-noop',
			}),
		)
		const { body } = await call(
			fixture,
			'refunds:write',
			'manage_refund_saver',
			{ ...refundArgs, mode: 'prefer_decline' },
		)
		expect(body.result?.content?.[0]?.text as string).toContain(
			'nothing changed',
		)
	})

	test('refuses a consent policy the API has no meaning for, without asking the API', async () => {
		// Asserting isError alone proves nothing here: the fixture's fetcher throws for every request, so
		// a schema that had silently forwarded 'maybe' would produce the same isError: true.
		let upstreamCalls = 0
		const fixture = await createMcpAppFixture(async () => {
			upstreamCalls += 1
			throw new Error('An invalid request must not reach the API.')
		})
		const { body } = await call(
			fixture,
			'refunds:write',
			'manage_refund_saver',
			{
				...refundArgs,
				mode: 'prefer_decline',
				consentPolicy: 'maybe',
			},
		)
		expect(body.result?.isError).toBe(true)
		expect(upstreamCalls).toBe(0)
	})

	test('carries the app name back for the one mode that needs it', async () => {
		// Both schemas are .strict(). Dropping this field from either side deadlocks prefer_grant_full --
		// the API would refuse every request carrying the confirmation and every request without it --
		// and nothing else would fail.
		const bodies: Array<Record<string, unknown>> = []
		const fixture = await createMcpAppFixture(async (request) => {
			bodies.push((await request.json()) as Record<string, unknown>)
			return Response.json({
				data: refundSaverChange({ mode: 'prefer_grant_full' }),
				requestId: 'request-grant',
			})
		})
		await call(fixture, 'refunds:write', 'manage_refund_saver', {
			...refundArgs,
			mode: 'prefer_grant_full',
			confirmAppName: 'Example App',
		})
		expect(bodies[0]).toMatchObject({
			mode: 'prefer_grant_full',
			confirmAppName: 'Example App',
		})
	})

	test('does not call a consent-policy-only change a no-op', async () => {
		// Re-sending the current mode with a new consentPolicy is the ONLY way to change that policy, so
		// deciding "nothing changed" from the mode alone denied the one write that field exists for.
		const fixture = await createMcpAppFixture(async () =>
			Response.json({
				data: refundSaverChange({
					previousMode: 'prefer_decline',
					consentPolicy: 'opt_in',
					changed: ['consentPolicy'],
				}),
				requestId: 'request-consent',
			}),
		)
		const { body } = await call(
			fixture,
			'refunds:write',
			'manage_refund_saver',
			{
				...refundArgs,
				mode: 'prefer_decline',
				consentPolicy: 'opt_in',
			},
		)
		const text = body.result?.content?.[0]?.text as string
		expect(text).not.toContain('nothing changed')
		expect(text).toContain('consentPolicy')
		expect(text).toContain('opt_in')
	})
})

describe('read request targets', () => {
	// Every POST write pins its path and body hash through `toolCases` in write-tools.test.ts. The GETs
	// are not in that list, and the internal JWT is signed over the canonical target -- so a typo in a
	// path or a renamed query parameter is a 100% production failure that no test would have seen.
	async function capture(
		name: string,
		args: Record<string, unknown>,
		scope: string,
		data: unknown,
	) {
		const urls: string[] = []
		const fixture = await createMcpAppFixture(async (request) => {
			urls.push(request.url)
			return Response.json({ data, requestId: 'request-get' })
		})
		await call(fixture, scope, name, args)
		return new URL(urls[0] as string)
	}

	test('get_refund_saver reads the app it was asked about, on the route the API serves', async () => {
		const url = await capture(
			'get_refund_saver',
			{ organizationId: ids.organization, appId: ids.resource },
			'refunds:read',
			refundSaverView(),
		)
		expect(url.pathname).toBe(
			`/v1/internal/mcp/apps/${ids.resource}/refund-saver`,
		)
		// The API parses `organizationId`; any other spelling is silently absent and fails validation.
		expect(url.searchParams.get('organizationId')).toBe(ids.organization)
	})

	test('get_app_setup keeps its own target, which now carries the Apple Ads block', async () => {
		const url = await capture(
			'get_app_setup',
			{ organizationId: ids.organization, appId: ids.resource },
			'workspace:read',
			appSetup(),
		)
		expect(url.pathname).toBe(`/v1/internal/mcp/apps/${ids.resource}/setup`)
		expect(url.searchParams.get('organizationId')).toBe(ids.organization)
	})
})

describe('get_app_setup Apple Ads block', () => {
	async function setup(asa: unknown) {
		const fixture = await createMcpAppFixture(async () =>
			Response.json({ data: appSetup(asa), requestId: 'request-setup' }),
		)
		return call(fixture, 'workspace:read', 'get_app_setup', {
			organizationId: ids.organization,
			appId: ids.resource,
		})
	}

	test('accepts a response from an API that does not send the field yet', async () => {
		// This repo deploys around the API, so the schema has to tolerate its absence -- `nullable` alone
		// would have made every get_app_setup call a contract error for the length of the gap.
		const { body } = await setup(undefined)
		expect(body.result?.isError).not.toBe(true)
	})

	test('accepts the null an Android app returns', async () => {
		const { body } = await setup(null)
		expect(body.result?.isError).not.toBe(true)
	})

	test('carries the bound connection and the names available to choose from', async () => {
		const { body } = await setup({
			bound: { name: 'WatchFace - Hedef Ulke', appleOrgId: 21_983_892 },
			available: [
				{ name: 'Primary ASA', appleOrgId: 8_960_480 },
				{ name: 'WatchFace - Hedef Ulke', appleOrgId: 21_983_892 },
			],
			attributionState: 'awaiting_attribution',
			firstAttributionDay: null,
		})
		expect(body.result?.isError).not.toBe(true)
		const asa = body.result?.structuredContent?.connections?.asa
		expect(asa?.bound?.name).toBe('WatchFace - Hedef Ulke')
		// The list is the only way a caller can learn what to pass to update_app.
		expect(asa?.available?.map((item: { name: string }) => item.name)).toEqual([
			'Primary ASA',
			'WatchFace - Hedef Ulke',
		])
	})

	test('rejects an attribution state this build has no meaning for', async () => {
		// The three states drive whether a fresh binding reads as working or broken; a fourth arriving
		// unannounced must be a contract error, not a value passed through to the model.
		const { body } = await setup({
			bound: null,
			available: [],
			attributionState: 'paused',
			firstAttributionDay: null,
		})
		expect(body.result?.isError).toBe(true)
	})
})
