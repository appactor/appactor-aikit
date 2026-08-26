import type { z } from 'zod'
import type { Config } from './config'
import { AppSetupSchema, WorkspaceSchema } from './contracts'
import { InternalTokenSigner, type InternalToolPrincipal } from './internal-jwt'
import { canonicalRequestTarget, sha256Hex } from './request-binding'

type ApiEnvelope<T> = { data: T; requestId: string }
type ApiErrorEnvelope = {
	error?: { code?: string; message?: string }
	requestId?: string
}

export class AppActorApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly requestId?: string,
	) {
		super(message)
		this.name = 'AppActorApiError'
	}
}

export class AppActorApiClient {
	private readonly signer: InternalTokenSigner

	constructor(
		private readonly config: Config,
		private readonly fetcher: typeof fetch = fetch,
	) {
		this.signer = new InternalTokenSigner(config)
	}

	ready() {
		return this.signer.ready()
	}

	private async request<T>(
		method: 'GET' | 'POST' | 'PATCH' | 'PUT',
		path: string,
		auth: InternalToolPrincipal,
		requestBody?: string,
		responseSchema?: z.ZodType<T>,
	): Promise<T> {
		const controller = new AbortController()
		const timeout = setTimeout(
			() => controller.abort(),
			this.config.APPACTOR_API_TIMEOUT_MS,
		)
		try {
			const url = new URL(path, this.config.APPACTOR_API_URL)
			const token = await this.signer.sign({
				...auth,
				method,
				target: canonicalRequestTarget(url),
				bodySha256: await sha256Hex(requestBody),
			})
			const response = await this.fetcher(
				new Request(url, {
					method,
					body: requestBody,
					headers: {
						accept: 'application/json',
						authorization: `Bearer ${token}`,
						...(requestBody ? { 'content-type': 'application/json' } : {}),
					},
					signal: controller.signal,
				}),
			)
			const responseBody = (await response.json().catch(() => null)) as
				| ApiEnvelope<T>
				| ApiErrorEnvelope
				| null
			if (!response.ok || !responseBody || !('data' in responseBody)) {
				const error =
					responseBody && 'error' in responseBody
						? responseBody.error
						: undefined
				throw new AppActorApiError(
					error?.message ?? `AppActor API returned HTTP ${response.status}.`,
					response.status,
					error?.code,
					responseBody?.requestId,
				)
			}
			return responseSchema
				? responseSchema.parse(responseBody.data)
				: responseBody.data
		} catch (error) {
			if (error instanceof AppActorApiError) throw error
			if (error instanceof Error && error.name === 'AbortError') {
				throw new AppActorApiError(
					'AppActor API request timed out.',
					504,
					'UPSTREAM_TIMEOUT',
				)
			}
			throw new AppActorApiError(
				'AppActor API could not be reached.',
				502,
				'UPSTREAM_UNAVAILABLE',
			)
		} finally {
			clearTimeout(timeout)
		}
	}

	getWorkspace(
		auth: InternalToolPrincipal,
		options: { organizationId?: string; appCursor?: string; appLimit?: number },
	) {
		const query = new URLSearchParams()
		if (options.organizationId)
			query.set('organizationId', options.organizationId)
		if (options.appCursor) query.set('appCursor', options.appCursor)
		if (options.appLimit) query.set('appLimit', String(options.appLimit))
		const suffix = query.size ? `?${query}` : ''
		return this.request(
			'GET',
			`/v1/internal/mcp/workspace${suffix}`,
			auth,
			undefined,
			WorkspaceSchema,
		)
	}

	getAppSetup(
		auth: InternalToolPrincipal,
		organizationId: string,
		appId: string,
	) {
		return this.request(
			'GET',
			`/v1/internal/mcp/apps/${encodeURIComponent(appId)}/setup?organizationId=${encodeURIComponent(organizationId)}`,
			auth,
			undefined,
			AppSetupSchema,
		)
	}
}
