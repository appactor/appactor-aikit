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

/**
 * Two shapes, not one. The API can never return the project shape for an app: an app delete leaves the
 * project's entitlements, offerings and packages standing and reports them as zero, while reporting
 * the bindings it strips out of them. A shared fixture would let a bug that renders one as the other
 * pass unnoticed.
 */
export const projectDeleteImpact = {
	apps: 2,
	appNames: ['Example App', 'Example App Android'],
	appNamesTruncated: false,
	products: 4,
	entitlements: 1,
	offerings: 1,
	packages: 3,
	packageProducts: 6,
	productEntitlements: 4,
	remoteConfigs: 2,
	experiments: 1,
	tokenBalances: 0,
	secretKeys: 1,
	subscribers: { count: 12, atLeast: false },
	transactions: { count: 10_000, atLeast: true },
	analyticsPurged: true,
}

export const appDeleteImpact = {
	apps: 1,
	appNames: ['Example App'],
	appNamesTruncated: false,
	products: 2,
	entitlements: 0,
	offerings: 0,
	packages: 0,
	packageProducts: 3,
	productEntitlements: 2,
	remoteConfigs: 1,
	experiments: 0,
	tokenBalances: 0,
	secretKeys: 0,
	subscribers: { count: 12, atLeast: false },
	transactions: { count: 10_000, atLeast: true },
	analyticsPurged: true,
}

export function deletePreview(target: 'project' | 'app', name: string) {
	return {
		status: 'preview' as const,
		target,
		targetId: target === 'project' ? ids.project : ids.resource,
		name,
		impact: target === 'project' ? projectDeleteImpact : appDeleteImpact,
		previewToken: 'p'.repeat(48),
		expiresAt: timestamp,
	}
}
