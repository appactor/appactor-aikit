export const ids = {
	organization: '00000000-0000-4000-8000-000000000001',
	project: '00000000-0000-4000-8000-000000000002',
	resource: '00000000-0000-4000-8000-000000000003',
	operation: '00000000-0000-4000-8000-000000000004',
	secondary: '00000000-0000-4000-8000-000000000005',
} as const

export const timestamp = '2026-08-26T12:00:00.000Z'

export const product = {
	id: ids.resource,
	appId: ids.secondary,
	storeProductId: 'premium_monthly',
	productType: 'subscription',
	appleSubscriptionGroupId: null,
	googleBasePlanId: null,
	googleOfferId: null,
	displayName: 'Premium Monthly',
	createdAt: timestamp,
	updatedAt: timestamp,
}

export const entitlement = {
	id: ids.resource,
	projectId: ids.project,
	appId: null,
	lookupKey: 'premium',
	displayName: 'Premium',
	createdAt: timestamp,
}

export const offering = {
	id: ids.resource,
	projectId: ids.project,
	lookupKey: 'default',
	displayName: 'Default',
	isCurrent: false,
	createdAt: timestamp,
	updatedAt: timestamp,
}

export const pkg = {
	id: ids.resource,
	offeringId: ids.secondary,
	packageType: 'monthly',
	displayName: 'Monthly',
	position: 0,
	isActive: true,
	tokenAmount: null,
	createdAt: timestamp,
	updatedAt: timestamp,
}

export const project = {
	id: ids.project,
	name: 'New Project',
	slug: 'new-project',
	description: null,
	createdAt: timestamp,
	updatedAt: timestamp,
}

export const app = {
	id: ids.resource,
	projectId: ids.project,
	name: 'Example App',
	platform: 'ios' as const,
	bundleId: 'com.example.app',
	packageName: null,
	appleAppId: null,
	iconUrl: null,
	createdAt: timestamp,
	updatedAt: timestamp,
}

export function succeeded<
	const TAction extends string,
	const TResult extends Record<string, unknown>,
>(action: TAction, result: TResult, replayed = false) {
	return {
		status: 'succeeded' as const,
		action,
		replayed,
		operationId: ids.operation,
		result,
	}
}
