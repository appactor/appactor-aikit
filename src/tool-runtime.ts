import type { AuthInfo } from '@modelcontextprotocol/server'
import { AppActorApiError } from './appactor-api'

export const READ_TOOL_ANNOTATIONS = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const

/**
 * A read whose answer the API has to go and find out.
 *
 * `readOnlyHint` gates auto-approval in most hosts, so it has to mean what it
 * says: this tool changes nothing. `get_refund_saver` no longer qualifies —
 * reading it advances the Apple webhook verification the answer is about, which
 * writes verification state and can ask Apple to deliver a test notification.
 * Nothing is destroyed, but a repeat call is not free and the domain is not
 * closed, which is the same reason every store-touching write here carries
 * `openWorldHint: true`.
 */
export const READ_TOOL_ANNOTATIONS_OPEN_WORLD = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
} as const

export function writeToolAnnotations(
	destructiveHint: boolean,
	openWorldHint: boolean,
) {
	return {
		readOnlyHint: false,
		destructiveHint,
		idempotentHint: true,
		openWorldHint,
	} as const
}

function scopesFrom(authInfo: AuthInfo) {
	return [...new Set(authInfo.scopes)]
}

export function requirePrincipal(
	authInfo: AuthInfo | undefined,
	scope: string,
) {
	const userId = authInfo?.extra?.userId
	if (!authInfo || typeof userId !== 'string' || !userId)
		throw new Error('Authenticated user is missing.')
	if (!authInfo.scopes.includes(scope))
		throw new Error(`This tool requires the ${scope} scope.`)
	return { userId, clientId: authInfo.clientId, scopes: scopesFrom(authInfo) }
}

export function successResult<T extends Record<string, unknown>>(
	data: T,
	text: string,
) {
	return {
		content: [{ type: 'text' as const, text }],
		structuredContent: data,
	}
}

export function errorResult(error: unknown, idempotentWrite = false) {
	const message =
		error instanceof Error ? error.message : 'Unknown AppActor error.'
	const details =
		error instanceof AppActorApiError
			? { code: error.code, requestId: error.requestId, status: error.status }
			: undefined
	// A 429 is the one failure the model can actually act on: it is not
	// uncertain, nothing was written, and there is a concrete wait attached.
	// Saying so stops an agent from hammering the limit it just hit.
	const rateLimited = error instanceof AppActorApiError && error.status === 429
	const waitHint = rateLimited
		? `\nRate limit reached. Wait ${error.retryAfterSeconds ?? 60} second(s) before calling any AppActor tool again, and slow down afterwards. Nothing was changed by this call.`
		: ''
	const retryHint =
		!rateLimited &&
		idempotentWrite &&
		error instanceof AppActorApiError &&
		(error.status === 408 || error.status >= 500)
			? '\nThe result may be uncertain. Retry the exact same arguments with the same idempotencyKey; do not generate a new key.'
			: ''
	return {
		isError: true,
		content: [
			{
				type: 'text' as const,
				text: details
					? `${message}\n${JSON.stringify(details)}${waitHint}${retryHint}`
					: `${message}${waitHint}`,
			},
		],
	}
}
