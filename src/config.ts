import { z } from 'zod'

const ConfigSchema = z
	.object({
		NODE_ENV: z
			.enum(['development', 'test', 'production'])
			.default('development'),
		PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
		LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
		MCP_RESOURCE_URL: z.url(),
		MCP_AUTH_ISSUER: z.url(),
		MCP_AUTH_JWKS_URL: z.url(),
		APPACTOR_API_URL: z.url(),
		MCP_INTERNAL_JWT_PRIVATE_KEY: z.string().min(1),
		MCP_INTERNAL_JWT_KEY_ID: z.string().min(1).default('appactor-mcp-v1'),
		MCP_INTERNAL_JWT_ISSUER: z.string().min(1).default('appactor-mcp'),
		MCP_INTERNAL_JWT_AUDIENCE: z.string().min(1).default('appactor-api'),
		MCP_METRICS_AUTH_TOKEN: z.string().min(32).optional(),
		APPACTOR_API_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(100)
			.max(60_000)
			.default(35_000),
	})
	.superRefine((config, ctx) => {
		if (config.NODE_ENV === 'production' && !config.MCP_METRICS_AUTH_TOKEN) {
			ctx.addIssue({
				code: 'custom',
				path: ['MCP_METRICS_AUTH_TOKEN'],
				message: 'MCP_METRICS_AUTH_TOKEN is required in production.',
			})
		}
	})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(
	source: Record<string, string | undefined> = process.env,
): Config {
	return ConfigSchema.parse(source)
}
