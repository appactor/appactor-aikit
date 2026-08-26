import { z } from 'zod'

const Id = z.string().min(1)
const NullableUrl = z.url().nullable()

export const PaginationSchema = z.object({
	limit: z.number().int().positive(),
	hasMore: z.boolean(),
	nextCursor: z.string().nullable(),
})

export const WorkspaceSchema = z.object({
	organizations: z.array(
		z.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			role: z.enum(['owner', 'member']),
		}),
	),
	selectedOrganization: z
		.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			role: z.enum(['owner', 'member']),
			access: z.object({
				accountPermissions: z.array(z.string()),
				projectAccessMode: z.string(),
				projectPermissions: z.array(z.string()),
				projectPermissionsByProject: z.record(z.string(), z.array(z.string())),
			}),
		})
		.nullable(),
	projects: z.array(
		z.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			description: z.string().nullable(),
			iconUrl: NullableUrl,
		}),
	),
	apps: z.array(
		z.object({
			id: Id,
			projectId: Id.nullable(),
			name: z.string(),
			platform: z.enum(['ios', 'android']),
			bundleId: z.string().nullable(),
			packageName: z.string().nullable(),
			iconUrl: NullableUrl,
			appleAppId: z.number().nullable(),
			appleConnection: z.unknown().nullable(),
		}),
	),
	appsPagination: PaginationSchema.nullable(),
})

export const AppSetupSchema = z.object({
	app: z.object({
		id: Id,
		projectId: Id.nullable(),
		name: z.string(),
		platform: z.enum(['ios', 'android']),
		bundleId: z.string().nullable(),
		packageName: z.string().nullable(),
		appleAppId: z.number().nullable(),
		publicApiKey: z.string().nullable(),
	}),
	connections: z.object({
		apple: z.unknown().nullable(),
		google: z.unknown().nullable(),
		appleWebhookStatus: z.unknown().nullable(),
	}),
	links: z.object({
		dashboard: z.url(),
		credentials: z.url(),
		appleWebhookSetup: NullableUrl,
		googleSetup: NullableUrl,
	}),
})

export type Workspace = z.infer<typeof WorkspaceSchema>
export type AppSetup = z.infer<typeof AppSetupSchema>
