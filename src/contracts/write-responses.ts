import { z } from 'zod'

const Id = z.uuid()
const DateTime = z.string().datetime()

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
		position: z.number().int().min(0),
		isActive: z.boolean(),
		tokenAmount: z.number().int().min(0).nullable(),
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
				imported: z.number().int().min(0),
				total: z.number().int().min(0),
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
					packageCount: z.number().int().min(0),
					packageProductCount: z.number().int().min(0),
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
						position: z.number().int().min(0),
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
