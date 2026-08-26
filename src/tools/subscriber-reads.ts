import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	SubscriberRequestSchema,
	type SubscriberResponse,
	SubscriberResponseSchema,
} from '../contracts/subscriber'
import {
	READ_TOOL_ANNOTATIONS,
	errorResult,
	requirePrincipal,
	successResult,
} from '../tool-runtime'

function subscriberSummary(result: SubscriberResponse) {
	if (result.action === 'lookup') {
		const count = result.data.matches.length
		if (count === 0)
			return 'No subscriber matches that exact app user ID in the accessible apps.'
		return `${count} subscriber match(es) for that exact app user ID.`
	}
	const { subscriber, summary, entitlements } = result.data
	const keys = summary.activeEntitlementKeys.join(', ') || 'none'
	return `${subscriber.appUserId} is ${summary.status} with ${entitlements.length} entitlement record(s). Active: ${keys}.`
}

export function registerSubscriberReadTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	server.registerTool(
		'get_subscriber',
		{
			title: 'Get AppActor Subscriber',
			description:
				'Look up one AppActor subscriber by their exact app user ID and read their entitlements, subscription status, and recent purchases. Matching is exact, so this tool cannot list or browse a customer base. Custom attributes, email, phone, push tokens, and integration identifiers are never returned. Requires subscribers:read plus the AppActor subscribers.read permission on the app.',
			inputSchema: SubscriberRequestSchema,
			outputSchema: SubscriberResponseSchema,
			annotations: READ_TOOL_ANNOTATIONS,
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'subscribers:read')
				const result = await api.getSubscriber(
					{ ...principal, tool: 'get_subscriber' },
					request,
				)
				return successResult(result, subscriberSummary(result))
			} catch (error) {
				return errorResult(error)
			}
		},
	)
}
