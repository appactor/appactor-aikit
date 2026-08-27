import { z } from 'zod'

const OrganizationId = z.uuid()
const ResourceId = z.uuid()
const AppUserId = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.describe(
		'The exact app user ID the customer is identified by in the AppActor SDK. Matching is exact; partial identifiers never match.',
	)

export const SubscriberRequestSchema = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('lookup'),
			organizationId: OrganizationId,
			appUserId: AppUserId,
			projectId: ResourceId.optional(),
			appId: ResourceId.optional(),
			limit: z.number().int().min(1).max(25).default(10),
			cursor: z
				.string()
				.max(2048)
				.optional()
				.describe(
					'The nextCursor from a previous lookup, to read the next page.',
				),
		})
		.strict(),
	z
		.object({
			action: z.literal('get'),
			organizationId: OrganizationId,
			subscriberId: ResourceId.optional().describe(
				'AppActor subscriber ID from a previous lookup. Preferred when the same app user ID exists in several apps.',
			),
			appUserId: AppUserId.optional(),
			projectId: ResourceId.optional(),
			appId: ResourceId.optional(),
			// The AppActor API reads at most 25 transactions for this projection;
			// asking for more would report a truncated history as complete.
			transactionLimit: z.number().int().min(1).max(25).default(20),
		})
		.strict(),
])

export type SubscriberRequest = z.infer<typeof SubscriberRequestSchema>

const DateTimeOrNull = z.string().nullable()

// Plain (non-strict) objects: zod strips unknown keys, so an additive AppActor
// API change can never widen what an MCP client sees.
const SubscriberSummarySchema = z.object({
	subscriberId: z.string(),
	appUserId: z.string(),
	appId: z.string().nullable(),
	appName: z.string().nullable(),
	projectId: z.string().nullable(),
	status: z.string(),
	country: z.string().nullable(),
	firstSeenAt: DateTimeOrNull,
	lastSeenAt: DateTimeOrNull,
	entitlementCounts: z.object({
		total: z.number().int().min(0),
		active: z.number().int().min(0),
	}),
})

const SubscriberEntitlementSchema = z.object({
	entitlementId: z.string(),
	lookupKey: z.string(),
	displayName: z.string().nullable(),
	isActive: z.boolean(),
	status: z.string().nullable(),
	store: z.string().nullable(),
	grantedBy: z.string().nullable(),
	storeProductId: z.string().nullable(),
	productType: z.string().nullable(),
	environment: z.string().nullable(),
	periodType: z.string().nullable(),
	ownershipType: z.string().nullable(),
	willRenew: z.boolean(),
	startsAt: DateTimeOrNull,
	expiresAt: DateTimeOrNull,
	gracePeriodExpiresAt: DateTimeOrNull,
	billingIssueDetectedAt: DateTimeOrNull,
	unsubscribeDetectedAt: DateTimeOrNull,
	scheduledStoreProductId: z.string().nullable(),
	scheduledRenewalAt: DateTimeOrNull,
})

const SubscriberTransactionSchema = z.object({
	transactionId: z.string(),
	store: z.string().nullable(),
	storeProductId: z.string().nullable(),
	productType: z.string().nullable(),
	displayType: z.string(),
	isTrial: z.boolean(),
	isTrialConversion: z.boolean(),
	conversionKind: z.string().nullable(),
	environment: z.string().nullable(),
	origin: z.string().nullable(),
	originLabel: z.string().nullable(),
	placement: z.string().nullable(),
	amountUsd: z.number().nullable(),
	originalAmount: z.number().nullable(),
	originalCurrency: z.string().nullable(),
	purchasedAt: DateTimeOrNull,
	expiresAt: DateTimeOrNull,
	createdAt: DateTimeOrNull,
})

const SubscriberMembershipSchema = z.object({
	appId: z.string(),
	appName: z.string().nullable(),
	projectId: z.string().nullable(),
	firstSeenAt: DateTimeOrNull,
	lastSeenAt: DateTimeOrNull,
})

const PaginationSchema = z.object({
	limit: z.number().int().min(1),
	hasMore: z.boolean(),
	nextCursor: z.string().nullable(),
})

export const SubscriberResponseSchema = z.union([
	z.object({
		action: z.literal('lookup'),
		data: z.object({
			matches: z.array(SubscriberSummarySchema),
			pagination: PaginationSchema,
		}),
		generatedAt: z.string(),
	}),
	z.object({
		action: z.literal('get'),
		data: z.object({
			subscriber: SubscriberSummarySchema,
			summary: z.object({
				status: z.enum(['active', 'trialing', 'inactive']),
				activeEntitlementKeys: z.array(z.string()),
				hasBillingIssue: z.boolean(),
				hasCancellation: z.boolean(),
				nextExpirationAt: DateTimeOrNull,
			}),
			entitlements: z.array(SubscriberEntitlementSchema),
			transactions: z.array(SubscriberTransactionSchema),
			transactionsTruncated: z.boolean(),
			appMemberships: z.array(SubscriberMembershipSchema),
		}),
		generatedAt: z.string(),
	}),
])

export type SubscriberResponse = z.infer<typeof SubscriberResponseSchema>
