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

const CredentialName = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.describe(
		'The NAME of a store credential as it appears in AppActor Settings > Credentials, e.g. "AnimalSound ASC". Never a credential id, and never credential JSON. Omit it when the organization has exactly one credential for this platform; if it has several, the tool answers with the names to choose from.',
	)

const CreateAppBase = {
	organizationId: OrganizationId,
	idempotencyKey: IdempotencyKey,
	projectId: ResourceId,
	name: z.string().trim().min(1).max(255),
	credentialName: CredentialName.optional(),
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

export const UpdateAppRequestSchema = z
	.object({
		organizationId: OrganizationId,
		idempotencyKey: IdempotencyKey,
		appId: ResourceId,
		name: z.string().trim().min(1).max(255).optional(),
		bundleId: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.optional()
			.describe(
				'iOS apps only. Changing it re-verifies the Apple connection, which is scoped to the bundle id.',
			),
		packageName: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.optional()
			.describe('Android apps only.'),
		credentialName: CredentialName.optional(),
		// Its own base string, not `CredentialName`: a description set on the outer nullable wrapper is
		// published ALONGSIDE the inner one, so reusing CredentialName advertised "as it appears in
		// Settings > Credentials ... omit it when the organization has exactly one" for a field where
		// every clause of that is false.
		asaConnectionName: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.nullable()
			.optional()
			.describe(
				'iOS apps only. The NAME of an Apple Ads connection, as get_app_setup lists under connections.asa.available. Pass null to unbind, which stops Apple Ads imports for this app and destroys nothing. Omit it to leave the current binding alone.',
			),
	})
	.strict()
	.describe(
		'Send only the fields you want to change. A field you omit is not written at all, so changing the credential cannot clear the bundle id.',
	)

export const ManageRefundSaverRequestSchema = z
	.object({
		organizationId: OrganizationId,
		idempotencyKey: IdempotencyKey,
		appId: ResourceId,
		mode: z
			.enum([
				'do_not_handle',
				'submit_consumption_data',
				'prefer_decline',
				'prefer_grant_full',
			])
			.describe(
				'What AppActor answers when Apple asks whether to refund a purchase. do_not_handle: answer nothing, which turns Refund Saver off. submit_consumption_data: send how much was consumed without asking for an outcome. prefer_decline: ask Apple to decline the refund. prefer_grant_full: ask Apple to grant it in full — this gives customer money back and cannot be reversed.',
			),
		consentPolicy: z
			.enum(['opt_out', 'opt_in'])
			.optional()
			.describe(
				"Whether a customer's consumption data may be sent to Apple. Leave it out unless the user asks: omitting it keeps whatever is already set, and an app that was never configured is already opt_out.",
			),
		confirmAppName: z
			.string()
			.min(1)
			.max(255)
			.optional()
			.describe(
				"Required for prefer_grant_full only, and must be the app's exact name. Ask the user to confirm in a message of their own before sending it; a granted refund cannot be taken back.",
			),
	})
	.strict()

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
export type UpdateAppRequest = z.infer<typeof UpdateAppRequestSchema>
export type ManageRefundSaverRequest = z.infer<
	typeof ManageRefundSaverRequestSchema
>
