import { z } from 'zod'
import { AppleWebhookStatusSchema } from '../contracts'

const Id = z.uuid()
const DateTime = z.string().datetime()
const Count = z.number().int().min(0)

const ProductSchema = z
	.object({
		id: Id,
		appId: Id,
		storeProductId: z.string(),
		productType: z.string(),
		appleSubscriptionGroupId: z.string().nullable(),
		googleBasePlanId: z.string().nullable(),
		googleOfferId: z.string().nullable(),
		displayName: z.string().nullable(),
		createdAt: DateTime,
		updatedAt: DateTime,
	})
	.strict()

const EntitlementSchema = z
	.object({
		id: Id,
		projectId: Id,
		appId: Id.nullable(),
		lookupKey: z.string(),
		displayName: z.string().nullable(),
		createdAt: DateTime,
	})
	.strict()

const OfferingSchema = z
	.object({
		id: Id,
		projectId: Id,
		lookupKey: z.string(),
		displayName: z.string().nullable(),
		isCurrent: z.boolean(),
		createdAt: DateTime,
		updatedAt: DateTime,
	})
	.strict()

const PackageSchema = z
	.object({
		id: Id,
		offeringId: Id,
		packageType: z.string(),
		displayName: z.string(),
		position: Count,
		isActive: z.boolean(),
		tokenAmount: Count.nullable(),
		createdAt: DateTime,
		updatedAt: DateTime,
	})
	.strict()

const ProjectSchema = z
	.object({
		id: Id,
		name: z.string(),
		slug: z.string(),
		description: z.string().nullable(),
		createdAt: DateTime,
		updatedAt: DateTime,
	})
	.strict()

const AppSchema = z
	.object({
		id: Id,
		projectId: Id.nullable(),
		name: z.string(),
		platform: z.enum(['ios', 'android']),
		bundleId: z.string().nullable(),
		packageName: z.string().nullable(),
		appleAppId: z.number().int().nullable(),
		iconUrl: z.string().nullable(),
		createdAt: DateTime,
		updatedAt: DateTime,
	})
	.strict()

function successfulOperation<
	const TAction extends string,
	TResult extends z.ZodType,
>(action: TAction, result: TResult) {
	return z
		.object({
			status: z.literal('succeeded'),
			action: z.literal(action),
			replayed: z.boolean(),
			operationId: Id,
			result,
		})
		.strict()
}

const DiscoveredProductsSchema = z
	.object({
		status: z.literal('discovered'),
		platform: z.enum(['ios', 'android']),
		products: z.array(
			z
				.object({
					storeProductId: z.string(),
					displayName: z.string().nullable(),
					productType: z.string(),
					appleSubscriptionGroupId: z.string().nullable().optional(),
					googleBasePlanId: z.string().nullable().optional(),
					googleOfferId: z.string().nullable().optional(),
				})
				.strict(),
		),
	})
	.strict()

export const ManageProductsResponseSchema = z.union([
	DiscoveredProductsSchema,
	successfulOperation(
		'import',
		z
			.object({
				imported: Count,
				total: Count,
				products: z.array(ProductSchema),
			})
			.strict(),
	),
	successfulOperation(
		'classify',
		z.object({ product: ProductSchema }).strict(),
	),
])

export const ManageEntitlementsResponseSchema = z.union([
	successfulOperation(
		'create',
		z.object({ entitlement: EntitlementSchema }).strict(),
	),
	successfulOperation(
		'update',
		z.object({ entitlement: EntitlementSchema }).strict(),
	),
	successfulOperation(
		'attach_product',
		z.object({ productId: Id, attachedEntitlementIds: z.array(Id) }).strict(),
	),
])

export const ManageOfferingsResponseSchema = z.union([
	z
		.object({
			status: z.literal('preview'),
			previewToken: z.string(),
			expiresAt: DateTime,
			changes: z
				.object({
					currentOfferingId: Id.nullable(),
					nextOfferingId: Id,
					packageCount: Count,
					packageProductCount: Count,
				})
				.strict(),
		})
		.strict(),
	successfulOperation(
		'create',
		z.object({ offering: OfferingSchema }).strict(),
	),
	successfulOperation(
		'update',
		z.object({ offering: OfferingSchema }).strict(),
	),
	successfulOperation(
		'apply_publish',
		z.object({ offering: OfferingSchema }).strict(),
	),
])

export const ManagePackagesResponseSchema = z.union([
	successfulOperation('create', z.object({ package: PackageSchema }).strict()),
	successfulOperation('update', z.object({ package: PackageSchema }).strict()),
	successfulOperation(
		'attach_product',
		z
			.object({
				packageProduct: z
					.object({
						packageId: Id,
						productId: Id,
						googleOfferId: z.string().nullable(),
						position: Count,
						createdAt: DateTime,
					})
					.strict(),
			})
			.strict(),
	),
])

export const CreateProjectResponseSchema = successfulOperation(
	'create',
	z.object({ project: ProjectSchema }).strict(),
)

const CreateAppSuccessSchema = successfulOperation(
	'create',
	z
		.object({
			app: AppSchema,
			publicApiKey: z.string().min(1),
			// Carries two mutually exclusive cases: an Apple credential was bound and its probe failed,
			// or no credential was bound at all. Both mean the same thing to the operator -- this app's
			// Apple connection needs a person in the dashboard.
			appleConnectionWarning: z.string().optional(),
		})
		.strict(),
)

/**
 * Every way "no credential got bound" can happen, and what the caller can do about it.
 *
 * `choices` is what makes these recoverable without a human: it names the credentials that WOULD
 * have worked, so the next call can pass one. It is absent -- never empty -- when there is nothing
 * to choose from, and absent for `credential_read_forbidden` because the names are the thing being
 * withheld from a connection that may not read them.
 *
 * The two `google_*` codes are the pre-rename spelling. They are still accepted so this schema can
 * ship BEFORE the API that stops emitting them; without them, every Android create_app during the
 * deploy gap would fail this `.strict()` union after having already created the app.
 */
const CredentialActionRequiredSchema = z
	.object({
		status: z.literal('action_required'),
		code: z.enum([
			'credential_required',
			'credential_selection_required',
			'credential_not_found',
			'credential_read_forbidden',
			'google_credential_required',
			'google_credential_selection_required',
		]),
		store: z.enum(['apple', 'google']).optional(),
		message: z.string(),
		url: z.url(),
		choices: z.array(z.string()).optional(),
	})
	.strict()

export const CreateAppResponseSchema = z.union([
	CredentialActionRequiredSchema,
	CreateAppSuccessSchema,
])

const AsaConnectionRefSchema = z
	.object({ name: z.string(), appleOrgId: z.number().nullable() })
	.strict()

export const UpdateAppResponseSchema = z.union([
	CredentialActionRequiredSchema,
	successfulOperation(
		'update',
		z
			.object({
				app: AppSchema,
				// Which fields actually moved, so a summary can say what changed instead of restating the
				// request back at the user.
				changed: z.array(z.string()),
				// Present only when the credential or bundle id changed on an iOS app: changing either
				// invalidates the stored Apple connection state, so it is re-probed and reported here
				// rather than left reading as `not_configured` with no way to tell if it really is.
				appleConnection: z
					.object({
						status: z.string(),
						lastErrorCode: z.string().nullable(),
						lastError: z.string().nullable(),
					})
					.strict()
					.nullable(),
				googleSetup: z
					.object({
						credentialConfigured: z.boolean(),
						rtdnStatus: z.string(),
						reasonCode: z.string(),
						nextAction: z.string(),
						isUserFixable: z.boolean(),
					})
					.strict()
					.nullable(),
				asaConnection: AsaConnectionRefSchema.nullable(),
			})
			.strict(),
	),
])

const BoundedCountSchema = z
	.object({
		count: Count,
		// True when the real number is larger than `count`: the preview probes with a bounded scan
		// instead of counting every row of a table that can hold millions.
		atLeast: z.boolean(),
	})
	.strict()

const DeleteImpactSchema = z
	.object({
		apps: Count,
		appNames: z.array(z.string()),
		// True when `appNames` is a sample: it is shorter than `apps` and must not be shown as the
		// complete list.
		appNamesTruncated: z.boolean(),
		products: Count,
		entitlements: Count,
		offerings: Count,
		packages: Count,
		// Bindings, not rows. An app delete leaves the project's packages and entitlements standing
		// while stripping this app's products out of them.
		packageProducts: Count,
		productEntitlements: Count,
		remoteConfigs: Count,
		experiments: Count,
		tokenBalances: Count,
		secretKeys: Count,
		subscribers: BoundedCountSchema,
		transactions: BoundedCountSchema,
		// Destruction with no row count to give: the ClickHouse analytics history is queued for a
		// permanent purge.
		analyticsPurged: z.boolean(),
	})
	.strict()

function deletePreview(target: 'project' | 'app') {
	return z
		.object({
			status: z.literal('preview'),
			target: z.literal(target),
			targetId: Id,
			// The name the user has to type back. Deliberately NOT also echoed under the request's own
			// field name: handing a model a `confirmName` in the response is an invitation to copy it
			// straight into the request without anyone reading anything.
			name: z.string(),
			impact: DeleteImpactSchema,
			previewToken: z.string(),
			expiresAt: DateTime,
		})
		.strict()
}

function deleteOutcome(target: 'project' | 'app') {
	return z
		.object({
			deleted: z.literal(true),
			// True when the target was already gone: the delete was a no-op, not a failure.
			alreadyAbsent: z.boolean(),
			target: z.literal(target),
			targetId: Id,
			name: z.string(),
			impact: DeleteImpactSchema.nullable(),
		})
		.strict()
}

export const DeleteProjectResponseSchema = z.union([
	deletePreview('project'),
	successfulOperation('apply', deleteOutcome('project')),
])

export const DeleteAppResponseSchema = z.union([
	deletePreview('app'),
	successfulOperation('apply', deleteOutcome('app')),
])

/**
 * `enabled` and `active` are both here on purpose. The stored row carries `enabled` and `mode`
 * separately, and the dashboard can leave them disagreeing -- the toggle on with the mode left at
 * `do_not_handle` reads as configured and answers Apple nothing. `active` is the honest summary of
 * the pair, and `effect` says in one sentence what happens today.
 */
const RefundSaverViewSchema = z
	.object({
		app: z.object({ id: Id, name: z.string(), platform: z.string() }).strict(),
		mode: z.enum([
			'do_not_handle',
			'submit_consumption_data',
			'prefer_decline',
			'prefer_grant_full',
		]),
		consentPolicy: z.enum(['opt_out', 'opt_in']),
		enabled: z.boolean(),
		active: z.boolean(),
		effect: z.string(),
		appleWebhook: AppleWebhookStatusSchema.nullable(),
		// False means Apple's refund question never reaches AppActor, so nothing can be turned on --
		// but turning OFF stays available, which is why this gates only one direction.
		canEnable: z.boolean(),
		links: z
			.object({ dashboard: z.url(), appleWebhookSetup: z.url() })
			.strict(),
	})
	.strict()

export const RefundSaverResponseSchema = RefundSaverViewSchema

export const ManageRefundSaverResponseSchema = successfulOperation(
	'update',
	RefundSaverViewSchema.extend({
		previousMode: z.string(),
		previousEffect: z.string(),
		// `mode` alone cannot answer "did anything change": `enabled` is derived from it and
		// `consentPolicy` rides along, and re-sending the current mode with a new consent policy is the
		// ONLY way to change that policy from here.
		changed: z.array(z.string()),
	}).strict(),
)

export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>
export type CreateAppResponse = z.infer<typeof CreateAppResponseSchema>
export type DeleteImpact = z.infer<typeof DeleteImpactSchema>
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>
export type DeleteAppResponse = z.infer<typeof DeleteAppResponseSchema>
export type DeleteResponse =
	| z.infer<typeof DeleteProjectResponseSchema>
	| z.infer<typeof DeleteAppResponseSchema>
export type UpdateAppResponse = z.infer<typeof UpdateAppResponseSchema>
export type RefundSaverResponse = z.infer<typeof RefundSaverResponseSchema>
export type ManageRefundSaverResponse = z.infer<
	typeof ManageRefundSaverResponseSchema
>
