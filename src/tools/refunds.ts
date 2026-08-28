import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AppActorApiClient } from '../appactor-api'
import { ManageRefundSaverRequestSchema } from '../contracts/write'
import {
	type ManageRefundSaverResponse,
	ManageRefundSaverResponseSchema,
	type RefundSaverResponse,
	RefundSaverResponseSchema,
} from '../contracts/write-responses'
import {
	READ_TOOL_ANNOTATIONS_OPEN_WORLD,
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'

/**
 * Said once, in both descriptions and in the summary of every read.
 *
 * Refund Saver is the one AppActor feature whose whole job is to answer a question nobody sees
 * arrive, so a model reasoning about it has no observable state to check -- it has to be told that
 * the webhook is what carries the question, or an unverified app looks like an unexplained refusal.
 */
const REFUND_WEBHOOK_RULE =
	"Apple's refund question arrives over the app's App Store Server Notifications webhook, so Refund Saver cannot be turned on until that webhook is verified. Turning it off always works."

const GET_REFUND_SAVER_DESCRIPTION = `Read how one iOS app currently answers Apple's refund requests: the mode, whether it is actually doing anything, the consent policy, and whether the Apple webhook is verified. ${REFUND_WEBHOOK_RULE}`

const MANAGE_REFUND_SAVER_DESCRIPTION = `Set how one iOS app answers Apple when a customer asks for a refund. Pick prefer_decline to argue against refunds, prefer_grant_full to grant them automatically, submit_consumption_data to send usage without an opinion, or do_not_handle to turn Refund Saver off. ${REFUND_WEBHOOK_RULE} prefer_grant_full gives customer money back and cannot be reversed: ask the user to confirm in a message of their own, then pass confirmAppName. Android apps are refused — this answers an App Store question.`

/**
 * `mode` alone is not the state. The stored row carries a separate `enabled` flag, and the two can
 * disagree: the dashboard toggle on with the mode left at `do_not_handle` reads as configured and
 * answers Apple nothing. Leading with `active` and `effect` is what stops a model reporting
 * "Refund Saver is set to prefer_decline" about an app that is answering nothing.
 */
function stateSentence(view: RefundSaverResponse) {
	const webhook = view.appleWebhook?.state ?? 'unknown'
	const gate = view.canEnable
		? ''
		: ` It cannot be turned on yet: the Apple webhook is ${webhook}.`
	return `${view.app.name}: Refund Saver is ${view.active ? `ACTIVE in ${view.mode} mode` : 'OFF'}. ${view.effect} Consent policy: ${view.consentPolicy}.${gate}`
}

/**
 * Decided from `changed`, not from the mode.
 *
 * The caller names only `mode`, but a write moves up to three stored fields: `enabled` is derived
 * from the mode, and `consentPolicy` rides along -- and re-sending the CURRENT mode with a new
 * consent policy is the only way to change that policy at all. Comparing modes alone reported that
 * write, and the switch-on of a row the dashboard had left at `enabled: false`, as "nothing changed".
 */
function changeSummary(result: ManageRefundSaverResponse) {
	const view = result.result
	const replayed = result.replayed ? ' (replayed)' : ''
	if (view.changed.length === 0) {
		return `${stateSentence(view)} (Already set that way${replayed}; nothing changed.)`
	}
	const mode = view.changed.includes('mode')
		? `changed from ${view.previousMode} to ${view.mode}`
		: `stays in ${view.mode} mode (changed: ${view.changed.join(', ')})`
	return `${view.app.name}: Refund Saver ${mode}${replayed}. ${view.effect} Consent policy: ${view.consentPolicy}.`
}

export function registerRefundTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	server.registerTool(
		'get_refund_saver',
		{
			title: 'Get Refund Saver Settings',
			description: GET_REFUND_SAVER_DESCRIPTION,
			inputSchema: z.object({ organizationId: z.uuid(), appId: z.uuid() }),
			outputSchema: RefundSaverResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS_OPEN_WORLD,
		},
		async ({ organizationId, appId }) => {
			try {
				const principal = requirePrincipal(authInfo, 'refunds:read')
				const view = await api.getRefundSaver(
					{ ...principal, tool: 'get_refund_saver' },
					organizationId,
					appId,
				)
				return successResult(view, stateSentence(view))
			} catch (error) {
				return errorResult(error)
			}
		},
	)

	server.registerTool(
		'manage_refund_saver',
		{
			title: 'Set Refund Saver Mode',
			description: MANAGE_REFUND_SAVER_DESCRIPTION,
			inputSchema: ManageRefundSaverRequestSchema,
			outputSchema: ManageRefundSaverResponseSchema,
			// Overwrites a policy that decides where money goes, but the write itself never leaves
			// AppActor -- Apple is only consulted later, when a refund request actually arrives.
			annotations: writeToolAnnotations(true, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'refunds:write')
				const result = await api.manageRefundSaver(
					{ ...principal, tool: 'manage_refund_saver' },
					request,
				)
				return successResult(result, changeSummary(result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)
}
