import type { AuthInfo } from '@modelcontextprotocol/server'
import { AppActorApiError } from './appactor-api'

export const READ_TOOL_ANNOTATIONS = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
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
	const retryHint =
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
					? `${message}\n${JSON.stringify(details)}${retryHint}`
					: message,
			},
		],
	}
}
