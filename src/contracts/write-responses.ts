import { z } from 'zod'

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

export const CreateAppResponseSchema = z.union([
	z
		.object({
			status: z.literal('action_required'),
			code: z.enum([
				'google_credential_required',
				'google_credential_selection_required',
			]),
			message: z.string(),
			url: z.url(),
		})
		.strict(),
	CreateAppSuccessSchema,
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

export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>
export type CreateAppResponse = z.infer<typeof CreateAppResponseSchema>
export type DeleteImpact = z.infer<typeof DeleteImpactSchema>
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>
export type DeleteAppResponse = z.infer<typeof DeleteAppResponseSchema>
export type DeleteResponse =
	| z.infer<typeof DeleteProjectResponseSchema>
	| z.infer<typeof DeleteAppResponseSchema>
