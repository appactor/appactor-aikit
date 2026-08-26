import type { Config } from './config'
import { InternalTokenSigner, type InternalToolRequest } from './internal-jwt'

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

	private async get<T>(path: string, auth: InternalToolRequest): Promise<T> {
		const controller = new AbortController()
		const timeout = setTimeout(
			() => controller.abort(),
			this.config.APPACTOR_API_TIMEOUT_MS,
		)
		try {
			const response = await this.fetcher(
				new Request(new URL(path, this.config.APPACTOR_API_URL), {
					headers: {
						accept: 'application/json',
						authorization: `Bearer ${await this.signer.sign(auth)}`,
					},
					signal: controller.signal,
				}),
			)
			const body = (await response.json().catch(() => null)) as
				| ApiEnvelope<T>
				| ApiErrorEnvelope
				| null
			if (!response.ok || !body || !('data' in body)) {
				const error = body && 'error' in body ? body.error : undefined
				throw new AppActorApiError(
					error?.message ?? `AppActor API returned HTTP ${response.status}.`,
					response.status,
					error?.code,
					body?.requestId,
				)
			}
			return body.data
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

	getWorkspace(auth: InternalToolRequest, organizationId?: string) {
		const query = organizationId
			? `?organizationId=${encodeURIComponent(organizationId)}`
			: ''
		return this.get<Record<string, unknown>>(
			`/v1/internal/mcp/workspace${query}`,
			auth,
		)
	}

	getAppSetup(
		auth: InternalToolRequest,
		organizationId: string,
		appId: string,
	) {
		return this.get<Record<string, unknown>>(
			`/v1/internal/mcp/apps/${encodeURIComponent(appId)}/setup?organizationId=${encodeURIComponent(organizationId)}`,
			auth,
		)
	}
}
