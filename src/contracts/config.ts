import { z } from 'zod'

const OrganizationId = z.uuid()
const ResourceId = z.uuid()
const IdempotencyKey = z
	.string()
	.min(8)
	.max(255)
	.regex(/^[A-Za-z0-9._:-]+$/)
	.describe(
		'Generate once per logical operation. Retrying with the same key replays a succeeded result; a pending or uncertain operation returns a conflict, which needs inspection rather than another attempt.',
	)
const ExpectedUpdatedAt = z
	.string()
	.datetime()
	.describe(
		'The updatedAt value read from get_config. The write is rejected if the resource changed since then.',
	)
const ResultMode = z
	.enum(['lifetime_cohort', 'd30_after_assignment', 'during_experiment'])
	.default('lifetime_cohort')
const ConfigValueType = z.enum(['boolean', 'number', 'string', 'json'])
const Platform = z.enum(['ios', 'android'])
const Pagination = {
	limit: z.number().int().min(1).max(100).default(50),
	cursor: z.string().max(2048).optional(),
}

const ConfigCondition = z
	.object({
		type: z.enum(['store', 'app_version', 'country', 'entitlement']),
		op: z.enum([
			'eq',
			'neq',
			'gt',
			'gte',
			'lt',
			'lte',
			'in',
			'not_in',
			'has',
			'not_has',
		]),
		value: z.unknown(),
	})
	.strict()

export const ConfigRequestSchema = z.discriminatedUnion('view', [
	z
		.object({
			view: z.literal('remote_configs'),
			organizationId: OrganizationId,
			projectId: ResourceId.optional(),
			appId: ResourceId.optional(),
			status: z.enum(['active', 'inactive']).optional(),
			platform: Platform.optional(),
			search: z.string().trim().max(120).optional(),
			...Pagination,
		})
		.strict(),
	z
		.object({
			view: z.literal('remote_config'),
			organizationId: OrganizationId,
			configId: ResourceId,
		})
		.strict(),
	z
		.object({
			view: z.literal('experiments'),
			organizationId: OrganizationId,
			projectId: ResourceId.optional(),
			appId: ResourceId.optional(),
			resultMode: ResultMode,
			includeResults: z.boolean().default(true),
			...Pagination,
		})
		.strict(),
	z
		.object({
			view: z.literal('experiment'),
			organizationId: OrganizationId,
			experimentId: ResourceId,
			resultMode: ResultMode,
		})
		.strict(),
])

export type ConfigRequest = z.infer<typeof ConfigRequestSchema>

export const AuditRequestSchema = z
	.object({
		organizationId: OrganizationId,
		scope: z
			.enum(['mine', 'organization'])
			.default('mine')
			.describe(
				'"mine" needs no extra permission. "organization" reads every member\'s operations and requires the AppActor team.manage permission.',
			),
		status: z.enum(['pending', 'succeeded', 'failed', 'uncertain']).optional(),
		tool: z.string().trim().min(1).max(64).optional(),
		...Pagination,
	})
	.strict()

export type AuditRequest = z.infer<typeof AuditRequestSchema>

const PlatformOverride = z
	.object({
		id: ResourceId.optional(),
		platform: Platform,
		defaultValue: z.unknown(),
		isActive: z.boolean().optional(),
	})
	.strict()

function uniquePlatforms(
	items: Array<{ platform: string }>,
	ctx: {
		addIssue: (issue: {
			code: 'custom'
			message: string
			path: (string | number)[]
		}) => void
	},
) {
	const seen = new Set<string>()
	for (const [index, item] of items.entries()) {
		if (seen.has(item.platform)) {
			ctx.addIssue({
				code: 'custom',
				message: 'Platform overrides must be unique',
				path: [index, 'platform'],
			})
		}
		seen.add(item.platform)
	}
}

export const ManageRemoteConfigRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('create'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			projectId: ResourceId.optional(),
			appId: ResourceId.optional(),
			platform: Platform.nullish(),
			key: z.string().min(1).max(100),
			valueType: ConfigValueType,
			defaultValue: z.unknown(),
			description: z.string().max(1000).nullish(),
		})
		.strict(),
	z
		.object({
			action: z.literal('create_scope_set'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			projectId: ResourceId,
			key: z.string().min(1).max(100),
			valueType: ConfigValueType,
			defaultValue: z.unknown(),
			description: z.string().max(1000).nullish(),
			isActive: z.boolean().optional(),
			platformOverrides: z
				.array(PlatformOverride.omit({ id: true }))
				.max(2)
				.superRefine(uniquePlatforms)
				.default([]),
		})
		.strict(),
	z
		.object({
			action: z.literal('update'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			configId: ResourceId,
			expectedUpdatedAt: ExpectedUpdatedAt,
			key: z.string().min(1).max(100).optional(),
			valueType: ConfigValueType.optional(),
			defaultValue: z.unknown().optional(),
			description: z.string().max(1000).nullish(),
			isActive: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			action: z.literal('update_scope_set'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			configId: ResourceId,
			key: z.string().min(1).max(100),
			defaultValue: z.unknown(),
			description: z.string().max(1000).nullish(),
			isActive: z.boolean(),
			expectedValues: z
				.array(
					z
						.object({ id: ResourceId, updatedAt: z.string().datetime() })
						.strict(),
				)
				.min(1)
				.max(3),
			platformOverrides: z
				.array(PlatformOverride)
				.max(2)
				.superRefine(uniquePlatforms)
				.default([]),
		})
		.strict(),
	z
		.object({
			action: z.literal('replace_rules'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			configId: ResourceId,
			expectedUpdatedAt: ExpectedUpdatedAt,
			rules: z
				.array(
					z
						.object({
							priority: z.number().int().min(0),
							value: z.unknown(),
							conditions: z.array(ConfigCondition).max(10),
							isActive: z.boolean().optional().default(true),
						})
						.strict(),
				)
				.max(50)
				.describe(
					'Replaces every rule on the config. Omitted rules are removed.',
				),
		})
		.strict(),
])

export type ManageRemoteConfigRequest = z.infer<
	typeof ManageRemoteConfigRequestSchema
>

const PrimaryMetric = z.enum([
	'userToTrialConversionRate',
	'userToPaidConversionRate',
	'trialToPaidConversionRate',
	'trialsCancellationRate',
	'subscriptionsCancellationRate',
	'newTrials',
	'newSubscriptions',
	'sales',
	'proceeds',
	'refunds',
	'grossLtvPerUser',
	'netLtvPerUser',
	'netLtvPerPaidUser',
])
const ExperimentKey = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
const Goal = z
	.object({
		key: z
			.string()
			.min(1)
			.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
		type: PrimaryMetric,
		isPrimary: z.boolean().optional().default(false),
	})
	.strict()
const VariantWeights = z
	.array(
		z
			.object({ id: ResourceId, weightBp: z.number().int().min(0).max(10000) })
			.strict(),
	)
	.max(100)
	.describe(
		'Weights are basis points and must sum to 10000 across the experiment.',
	)

/**
 * Bucketing accumulates weights and falls through to the last variant when the
 * total is short, so a set that does not sum to 10000 silently hands nearly all
 * traffic to one arm rather than failing. Checked here as well as in the API so
 * the model sees the error before the request leaves.
 */
const VariantWeightsSummingToFull = VariantWeights.min(1).superRefine(
	(variants, ctx) => {
		const total = variants.reduce((sum, variant) => sum + variant.weightBp, 0)
		if (total !== 10000) {
			ctx.addIssue({
				code: 'custom',
				message: `Variant weights must sum to 10000 basis points (got ${total}).`,
			})
		}
	},
)
const CreateVariant = z
	.object({
		key: ExperimentKey,
		name: z.string().max(200).nullish(),
		isControl: z.boolean().optional().default(false),
		weightBp: z.number().int().min(0).max(10000),
		valueType: ConfigValueType.optional().default('json'),
		payload: z.unknown().optional().default({}),
	})
	.strict()

export const ManageExperimentsRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('create'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			appId: ResourceId,
			key: ExperimentKey,
			name: z.string().max(200).nullish(),
			description: z.string().max(2000).nullish(),
			trafficAllocationBp: z
				.number()
				.int()
				.min(0)
				.max(10000)
				.optional()
				.default(10000),
			targetingConditions: z
				.array(ConfigCondition)
				.max(10)
				.optional()
				.default([]),
			goals: z.array(Goal).max(10).optional().default([]),
		})
		.strict(),
	z
		.object({
			action: z.literal('update'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			experimentId: ResourceId,
			expectedUpdatedAt: ExpectedUpdatedAt.optional(),
			name: z.string().max(200).nullish(),
			description: z.string().max(2000).nullish(),
			trafficAllocationBp: z.number().int().min(0).max(10000).optional(),
			targetingConditions: z.array(ConfigCondition).max(10).optional(),
			goals: z.array(Goal).max(10).optional(),
		})
		.strict(),
	z
		.object({
			action: z.literal('set_status'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			experimentId: ResourceId,
			status: z.enum(['start', 'pause', 'stop', 'resume', 'to_draft']),
		})
		.strict(),
	z
		.object({
			action: z.literal('create_variants'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			experimentId: ResourceId,
			variants: z.array(CreateVariant).min(1).max(100),
		})
		.strict(),
	z
		.object({
			action: z.literal('update_variant'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			experimentId: ResourceId,
			variantId: ResourceId,
			expectedUpdatedAt: ExpectedUpdatedAt.optional(),
			key: ExperimentKey.optional(),
			name: z.string().max(200).nullish(),
			isControl: z.boolean().optional(),
			// No weightBp: the API rejects any value that differs from the stored
			// one. Weights change through replace_variant_weights.
			valueType: ConfigValueType.optional(),
			payload: z.unknown().optional(),
		})
		.strict(),
	z
		.object({
			action: z.literal('replace_variant_weights'),
			organizationId: OrganizationId,
			idempotencyKey: IdempotencyKey,
			experimentId: ResourceId,
			expectedVariants: VariantWeights,
			variants: VariantWeightsSummingToFull,
		})
		.strict(),
])

export type ManageExperimentsRequest = z.infer<
	typeof ManageExperimentsRequestSchema
>

const Payload = z.record(z.string(), z.unknown())

export const ConfigResponseSchema = z.object({
	view: z.string(),
	data: Payload,
	generatedAt: z.string(),
})

export const AuditResponseSchema = z.object({
	view: z.literal('mcp_write_operations'),
	scope: z.enum(['mine', 'organization']),
	data: Payload,
	generatedAt: z.string(),
})

export const ConfigWriteResponseSchema = z.object({
	status: z.literal('succeeded'),
	action: z.string(),
	replayed: z.boolean(),
	operationId: z.uuid(),
	result: Payload,
})

export type ConfigWriteResponse = z.infer<typeof ConfigWriteResponseSchema>
