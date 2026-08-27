import { z } from 'zod'

const OrganizationId = z.uuid()
const ResourceId = z.uuid()
const IdempotencyKey = z
	.string()
	.min(8)
	.max(255)
	.regex(/^[A-Za-z0-9._:-]+$/)
	.describe(
		'Generate once per logical operation. After a timeout or uncertain result, retry the exact same arguments with this same key; never generate a new key for that retry.',
	)
const OptionalDisplayName = z.string().max(255).nullable().optional()
const PreviewToken = z
	.string()
	.min(32)
	.max(4096)
	.describe('The previewToken returned by the matching preview action.')
const PackageType = z.enum([
	'lifetime',
	'annual',
	'six_months',
	'three_months',
	'two_months',
	'monthly',
	'weekly',
	'custom',
])

const ImportedProduct = z
	.object({
		storeProductId: z.string().min(1).max(255),
		productType: z.string().min(1).max(50),
		appleSubscriptionGroupId: z.string().max(100).nullable().optional(),
		googleBasePlanId: z.string().max(100).nullable().optional(),
		googleOfferId: z.string().max(100).nullable().optional(),
		displayName: z.string().max(255).nullable().optional(),
	})
	.strict()

export const ManageProductsRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('discover'),
			organizationId: OrganizationId,
			appId: ResourceId,
		})
		.strict(),
	z
		.object({
			action: z.literal('import'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			appId: ResourceId,
			products: z.array(ImportedProduct).min(1).max(500),
		})
		.strict(),
	z
		.object({
			action: z.literal('classify'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			productId: ResourceId,
			productType: z.string().min(1).max(50),
			displayName: OptionalDisplayName,
		})
		.strict(),
])

export const ManageEntitlementsRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('create'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			projectId: ResourceId,
			lookupKey: z.string().min(1).max(100),
			displayName: OptionalDisplayName,
		})
		.strict(),
	z
		.object({
			action: z.literal('update'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			entitlementId: ResourceId,
			lookupKey: z.string().min(1).max(100).optional(),
			displayName: OptionalDisplayName,
		})
		.strict(),
	z
		.object({
			action: z.literal('attach_product'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			productId: ResourceId,
			entitlementIds: z.array(ResourceId).min(1).max(100),
		})
		.strict(),
])

export const ManageOfferingsRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('create'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			projectId: ResourceId,
			lookupKey: z.string().min(1).max(100),
			displayName: OptionalDisplayName,
		})
		.strict(),
	z
		.object({
			action: z.literal('update'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			offeringId: ResourceId,
			lookupKey: z.string().min(1).max(100).optional(),
			displayName: OptionalDisplayName,
		})
		.strict(),
	z
		.object({
			action: z.literal('preview_publish'),
			organizationId: OrganizationId,
			offeringId: ResourceId,
		})
		.strict(),
	z
		.object({
			action: z.literal('apply_publish'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			previewToken: PreviewToken,
		})
		.strict(),
])

export const ManagePackagesRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('create'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			offeringId: ResourceId,
			packageType: PackageType,
			displayName: z.string().min(1).max(255),
			position: z.number().int().min(0).optional(),
			isActive: z.boolean().optional(),
			tokenAmount: z.number().int().min(0).nullable().optional(),
		})
		.strict(),
	z
		.object({
			action: z.literal('update'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			packageId: ResourceId,
			packageType: PackageType.optional(),
			displayName: z.string().min(1).max(255).optional(),
			position: z.number().int().min(0).optional(),
			isActive: z.boolean().optional(),
			tokenAmount: z.number().int().min(0).nullable().optional(),
			expectedUpdatedAt: z.string().datetime().optional(),
		})
		.strict(),
	z
		.object({
			action: z.literal('attach_product'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			packageId: ResourceId,
			productId: ResourceId,
			position: z.number().int().min(0).optional(),
			googleOfferId: z.string().min(1).max(100).nullable().optional(),
		})
		.strict(),
])

export const CreateProjectRequestSchema = z
	.object({
		organizationId: OrganizationId,
		idempotencyKey: IdempotencyKey,
		name: z.string().min(1).max(255),
		slug: z
			.string()
			.min(1)
			.max(255)
			.regex(/^[a-z0-9-]+$/),
		description: z.string().max(1000).nullable().optional(),
	})
	.strict()

const CreateAppBase = {
	organizationId: OrganizationId,
	idempotencyKey: IdempotencyKey,
	projectId: ResourceId,
	name: z.string().min(1).max(255),
}

export const CreateAppRequestSchema = z.discriminatedUnion('platform', [
	z
		.object({
			...CreateAppBase,
			platform: z.literal('ios'),
			bundleId: z.string().trim().min(1).max(255),
		})
		.strict(),
	z
		.object({
			...CreateAppBase,
			platform: z.literal('android'),
			packageName: z.string().trim().min(1).max(255),
		})
		.strict(),
])

const DeleteConfirmName = z
	.string()
	.min(1)
	.max(255)
	.describe(
		"The name of the project or app exactly as the preview reported it, typed back by the user. Never invent this value or copy it from the preview on the user's behalf.",
	)

export const DeleteProjectRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('preview'),
			organizationId: OrganizationId,
			projectId: ResourceId,
		})
		.strict(),
	z
		.object({
			action: z.literal('apply'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			previewToken: PreviewToken,
			confirmName: DeleteConfirmName,
		})
		.strict(),
])

export const DeleteAppRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('preview'),
			organizationId: OrganizationId,
			appId: ResourceId,
		})
		.strict(),
	z
		.object({
			action: z.literal('apply'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			previewToken: PreviewToken,
			confirmName: DeleteConfirmName,
		})
		.strict(),
])

export type ManageProductsRequest = z.infer<typeof ManageProductsRequestSchema>
export type ManageEntitlementsRequest = z.infer<
	typeof ManageEntitlementsRequestSchema
>
export type ManageOfferingsRequest = z.infer<
	typeof ManageOfferingsRequestSchema
>
export type ManagePackagesRequest = z.infer<typeof ManagePackagesRequestSchema>
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>
export type CreateAppRequest = z.infer<typeof CreateAppRequestSchema>
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>
export type DeleteAppRequest = z.infer<typeof DeleteAppRequestSchema>
