import type { AuthInfo, McpServer } from '@modelcontextprotocol/server'
import type { AppActorApiClient } from '../appactor-api'
import {
	ManageEntitlementsRequestSchema,
	ManageOfferingsRequestSchema,
	ManagePackagesRequestSchema,
	ManageProductsRequestSchema,
} from '../contracts/write'
import {
	ManageEntitlementsResponseSchema,
	ManageOfferingsResponseSchema,
	ManagePackagesResponseSchema,
	ManageProductsResponseSchema,
} from '../contracts/write-responses'
import {
	errorResult,
	requirePrincipal,
	successResult,
	writeToolAnnotations,
} from '../tool-runtime'

function operationSummary(
	domain: string,
	result: { status: string; action?: string; replayed?: boolean },
) {
	if (result.status === 'preview')
		return `${domain} publish preview created. Review the changes before apply_publish.`
	if (result.status === 'discovered')
		return `${domain} discovered from the connected store.`
	return `${domain} ${result.action ?? 'operation'} succeeded${result.replayed ? ' (replayed)' : ''}.`
}

export function registerCatalogWriteTools(
	server: McpServer,
	api: AppActorApiClient,
	authInfo?: AuthInfo,
) {
	server.registerTool(
		'manage_products',
		{
			title: 'Manage AppActor Products',
			description:
				'Discover store products or idempotently import/classify products. This tool cannot delete products or manage credentials.',
			inputSchema: ManageProductsRequestSchema,
			outputSchema: ManageProductsResponseSchema,
			annotations: writeToolAnnotations(true, true),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'catalog:write')
				const result = await api.manageProducts(
					{ ...principal, tool: 'manage_products' },
					request,
				)
				return successResult(
					result,
					operationSummary('Product catalog', result),
				)
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
			}
		},
	)

	server.registerTool(
		'manage_entitlements',
		{
			title: 'Manage AppActor Entitlements',
			description:
				'Idempotently create/update entitlements or add product bindings. Detach and delete operations are not available.',
			inputSchema: ManageEntitlementsRequestSchema,
			outputSchema: ManageEntitlementsResponseSchema,
			annotations: writeToolAnnotations(true, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'catalog:write')
				const result = await api.manageEntitlements(
					{ ...principal, tool: 'manage_entitlements' },
					request,
				)
				return successResult(result, operationSummary('Entitlement', result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)

	server.registerTool(
		'manage_offerings',
		{
			title: 'Manage AppActor Offerings',
			description:
				'Create/update non-current offerings or preview/apply current publication. Always show preview changes to the user and obtain approval before apply_publish.',
			inputSchema: ManageOfferingsRequestSchema,
			outputSchema: ManageOfferingsResponseSchema,
			annotations: writeToolAnnotations(true, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'catalog:write')
				const result = await api.manageOfferings(
					{ ...principal, tool: 'manage_offerings' },
					request,
				)
				return successResult(result, operationSummary('Offering', result))
			} catch (error) {
				return errorResult(error, 'idempotencyKey' in request)
			}
		},
	)

	server.registerTool(
		'manage_packages',
		{
			title: 'Manage AppActor Packages',
			description:
				'Idempotently create/update offering packages or add product bindings. Detach, replacement, and delete operations are not available.',
			inputSchema: ManagePackagesRequestSchema,
			outputSchema: ManagePackagesResponseSchema,
			annotations: writeToolAnnotations(true, false),
		},
		async (request) => {
			try {
				const principal = requirePrincipal(authInfo, 'catalog:write')
				const result = await api.managePackages(
					{ ...principal, tool: 'manage_packages' },
					request,
				)
				return successResult(result, operationSummary('Package', result))
			} catch (error) {
				return errorResult(error, true)
			}
		},
	)
}
