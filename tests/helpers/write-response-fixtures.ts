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

export function deleteOutcome(
	target: 'project' | 'app',
	name: string,
	overrides: { alreadyAbsent?: boolean; replayed?: boolean } = {},
) {
	const alreadyAbsent = overrides.alreadyAbsent ?? false
	return succeeded(
		'apply',
		{
			deleted: true as const,
			alreadyAbsent,
			target,
			targetId: target === 'project' ? ids.project : ids.resource,
			name,
			// An absent target destroyed nothing, so there is no impact to report.
			impact: alreadyAbsent
				? null
				: target === 'project'
					? projectDeleteImpact
					: appDeleteImpact,
		},
		overrides.replayed ?? false,
	)
}

export const appleWebhookVerified = {
	state: 'verified' as const,
	source: 'test_notification' as const,
	verifiedAt: timestamp,
	lastCheckedAt: timestamp,
	lastCheckRequestedAt: timestamp,
	lastError: null,
	warning: null,
	environment: 'production' as const,
	testNotificationStatus: {
		state: 'success' as const,
		result: 'SUCCESS',
		checkedAt: timestamp,
		attemptDate: timestamp,
	},
}

export const appleWebhookNotVerified = {
	...appleWebhookVerified,
	state: 'not_verified' as const,
	source: null,
	verifiedAt: null,
	testNotificationStatus: null,
}

/**
 * Mirrors `updateMcpApp` in appactor-final-api/src/services/admin/mcp-write/workspace.ts.
 *
 * `appleConnection` is null unless the credential or bundle id moved on an iOS app, and `googleSetup`
 * is null for anything that is not Android -- they are not two views of one thing, and a fixture that
 * filled in both would hide a summary that reports the wrong platform's status.
 */
export function updateOutcome(
	overrides: {
		changed?: string[]
		appleConnection?: {
			status: string
			lastErrorCode: string | null
			lastError: string | null
		} | null
		googleSetup?: {
			credentialConfigured: boolean
			rtdnStatus: string
			reasonCode: string
			nextAction: string
			isUserFixable: boolean
		} | null
		asaConnection?: { name: string; appleOrgId: number | null } | null
		replayed?: boolean
	} = {},
) {
	return succeeded(
		'update',
		{
			app,
			changed: overrides.changed ?? ['name'],
			appleConnection: overrides.appleConnection ?? null,
			googleSetup: overrides.googleSetup ?? null,
			asaConnection: overrides.asaConnection ?? null,
		},
		overrides.replayed ?? false,
	)
}

export function credentialActionRequired(
	overrides: Partial<{
		code: string
		store: 'apple' | 'google'
		message: string
		choices: string[]
	}> = {},
) {
	return {
		status: 'action_required' as const,
		code: overrides.code ?? 'credential_selection_required',
		store: overrides.store ?? 'apple',
		message:
			overrides.message ??
			'This organization has 2 Apple credentials. Retry with credentialName set to the one this app should use.',
		url: 'https://dashboard.example.com/settings?tab=credentials',
		...(overrides.choices ? { choices: overrides.choices } : {}),
	}
}

/** Mirrors `buildMcpRefundSaverView` in appactor-final-api/src/services/admin/mcp-refunds.service.ts. */
export function refundSaverView(
	overrides: Partial<{
		mode: string
		consentPolicy: 'opt_out' | 'opt_in'
		enabled: boolean
		active: boolean
		effect: string
		canEnable: boolean
		appleWebhook: typeof appleWebhookVerified | typeof appleWebhookNotVerified
	}> = {},
) {
	const mode = overrides.mode ?? 'prefer_decline'
	const enabled = overrides.enabled ?? mode !== 'do_not_handle'
	return {
		app: { id: ids.resource, name: 'Example App', platform: 'ios' },
		mode,
		consentPolicy: overrides.consentPolicy ?? 'opt_out',
		enabled,
		active: overrides.active ?? (enabled && mode !== 'do_not_handle'),
		effect:
			overrides.effect ??
			'AppActor sends the consumption data and asks Apple to DECLINE the refund.',
		appleWebhook: overrides.appleWebhook ?? appleWebhookVerified,
		canEnable: overrides.canEnable ?? true,
		links: {
			dashboard: 'https://dashboard.example.com/apps/example',
			appleWebhookSetup: 'https://dashboard.example.com/apps/example',
		},
	}
}

/**
 * `changed` is what the API computes by diffing the stored row, so it does NOT follow from `mode`
 * alone -- a consent-policy change carries `mode` unchanged, which is the case the summary used to
 * report as a no-op. Defaulted from the mode diff, overridable for exactly that case.
 */
export function refundSaverChange(
	overrides: Parameters<typeof refundSaverView>[0] & {
		previousMode?: string
		changed?: string[]
		replayed?: boolean
	} = {},
) {
	const view = refundSaverView(overrides)
	const previousMode = overrides.previousMode ?? 'do_not_handle'
	return succeeded(
		'update',
		{
			...view,
			previousMode,
			previousEffect:
				'Refund Saver is off. Apple decides alone and AppActor answers nothing.',
			changed:
				overrides.changed ??
				(previousMode === view.mode ? [] : ['mode', 'enabled']),
		},
		overrides.replayed ?? false,
	)
}

/** Mirrors the `GET /apps/:appId/setup` response literal in appactor-final-api/src/routes/internal/mcp.ts. */
export function appSetup(asa?: unknown) {
	return {
		app: {
			id: ids.resource,
			projectId: ids.project,
			name: 'Example App',
			platform: 'ios',
			bundleId: 'com.example.app',
			packageName: null,
			appleAppId: null,
			publicApiKey: 'pk_live_example',
		},
		connections: {
			apple: null,
			google: null,
			appleWebhookStatus: null,
			...(asa === undefined ? {} : { asa }),
		},
		links: {
			dashboard: 'https://dashboard.example.com/apps/example',
			credentials: 'https://dashboard.example.com/settings?tab=credentials',
			appleWebhookSetup: null,
			googleSetup: null,
		},
	}
}
