import { type z as Zod, ZodError, z } from 'zod'
import type { Config } from './config'
import {
	type AnalyticsRequest,
	AnalyticsRequestSchema,
	AppSetupSchema,
	type CatalogRequest,
	CatalogRequestSchema,
	WorkspaceSchema,
} from './contracts'
import {
	type AuditRequest,
	AuditRequestSchema,
	AuditResponseSchema,
	type ConfigRequest,
	ConfigRequestSchema,
	ConfigResponseSchema,
	ConfigWriteResponseSchema,
	type ManageExperimentsRequest,
	ManageExperimentsRequestSchema,
	type ManageRemoteConfigRequest,
	ManageRemoteConfigRequestSchema,
} from './contracts/config'
import {
	type SubscriberRequest,
	SubscriberRequestSchema,
	SubscriberResponseSchema,
} from './contracts/subscriber'
import {
	type CreateAppRequest,
	CreateAppRequestSchema,
	type CreateProjectRequest,
	CreateProjectRequestSchema,
	type DeleteAppRequest,
	DeleteAppRequestSchema,
	type DeleteProjectRequest,
	DeleteProjectRequestSchema,
	type ManageEntitlementsRequest,
	ManageEntitlementsRequestSchema,
	type ManageOfferingsRequest,
	ManageOfferingsRequestSchema,
	type ManagePackagesRequest,
	ManagePackagesRequestSchema,
	type ManageProductsRequest,
	ManageProductsRequestSchema,
	type ManageRefundSaverRequest,
	ManageRefundSaverRequestSchema,
	type UpdateAppRequest,
	UpdateAppRequestSchema,
} from './contracts/write'
import {
	CreateAppResponseSchema,
	CreateProjectResponseSchema,
	DeleteAppResponseSchema,
	DeleteProjectResponseSchema,
	ManageEntitlementsResponseSchema,
	ManageOfferingsResponseSchema,
	ManagePackagesResponseSchema,
	ManageProductsResponseSchema,
	ManageRefundSaverResponseSchema,
	RefundSaverResponseSchema,
	UpdateAppResponseSchema,
} from './contracts/write-responses'
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
		/** Seconds the caller should wait, from the upstream Retry-After header. */
		readonly retryAfterSeconds?: number,
	) {
		super(message)
		this.name = 'AppActorApiError'
	}
}

function parseRetryAfter(response: Response) {
	const raw = response.headers.get('retry-after')
	if (!raw) return undefined
	const seconds = Number(raw)
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
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
		responseSchema?: Zod.ZodType<T>,
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
					parseRetryAfter(response),
				)
			}
			return responseSchema
				? responseSchema.parse(responseBody.data)
				: responseBody.data
		} catch (error) {
			if (error instanceof AppActorApiError) throw error
			if (error instanceof ZodError) {
				throw new AppActorApiError(
					'AppActor API returned an invalid response contract.',
					502,
					'UPSTREAM_CONTRACT_INVALID',
				)
			}
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

	private postValidated<TRequest, TResponse>(
		path: string,
		auth: InternalToolPrincipal,
		request: TRequest,
		requestSchema: Zod.ZodType<TRequest>,
		responseSchema: Zod.ZodType<TResponse>,
	) {
		return this.request(
			'POST',
			path,
			auth,
			JSON.stringify(requestSchema.parse(request)),
			responseSchema,
		)
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

	queryAnalytics(auth: InternalToolPrincipal, request: AnalyticsRequest) {
		const body = JSON.stringify(AnalyticsRequestSchema.parse(request))
		return this.request(
			'POST',
			'/v1/internal/mcp/analytics',
			auth,
			body,
			z.object({
				kind: z.string(),
				data: z.record(z.string(), z.unknown()),
				generatedAt: z.string().datetime(),
			}),
		)
	}

	getCatalog(auth: InternalToolPrincipal, request: CatalogRequest) {
		const body = JSON.stringify(CatalogRequestSchema.parse(request))
		return this.request(
			'POST',
			'/v1/internal/mcp/catalog',
			auth,
			body,
			z.object({
				view: z.string(),
				data: z.record(z.string(), z.unknown()),
				generatedAt: z.string().datetime(),
			}),
		)
	}

	getSubscriber(auth: InternalToolPrincipal, request: SubscriberRequest) {
		return this.postValidated(
			'/v1/internal/mcp/subscribers',
			auth,
			request,
			SubscriberRequestSchema,
			SubscriberResponseSchema,
		)
	}

	getConfig(auth: InternalToolPrincipal, request: ConfigRequest) {
		return this.postValidated(
			'/v1/internal/mcp/config',
			auth,
			request,
			ConfigRequestSchema,
			ConfigResponseSchema,
		)
	}

	getAuditLog(auth: InternalToolPrincipal, request: AuditRequest) {
		return this.postValidated(
			'/v1/internal/mcp/audit-log',
			auth,
			request,
			AuditRequestSchema,
			AuditResponseSchema,
		)
	}

	manageRemoteConfig(
		auth: InternalToolPrincipal,
		request: ManageRemoteConfigRequest,
	) {
		return this.postValidated(
			'/v1/internal/mcp/remote-config',
			auth,
			request,
			ManageRemoteConfigRequestSchema,
			ConfigWriteResponseSchema,
		)
	}

	manageExperiments(
		auth: InternalToolPrincipal,
		request: ManageExperimentsRequest,
	) {
		return this.postValidated(
			'/v1/internal/mcp/experiments',
			auth,
			request,
			ManageExperimentsRequestSchema,
			ConfigWriteResponseSchema,
		)
	}

	manageProducts(auth: InternalToolPrincipal, request: ManageProductsRequest) {
		return this.postValidated(
			'/v1/internal/mcp/products',
			auth,
			request,
			ManageProductsRequestSchema,
			ManageProductsResponseSchema,
		)
	}

	manageEntitlements(
		auth: InternalToolPrincipal,
		request: ManageEntitlementsRequest,
	) {
		return this.postValidated(
			'/v1/internal/mcp/entitlements',
			auth,
			request,
			ManageEntitlementsRequestSchema,
			ManageEntitlementsResponseSchema,
		)
	}

	manageOfferings(
		auth: InternalToolPrincipal,
		request: ManageOfferingsRequest,
	) {
		return this.postValidated(
			'/v1/internal/mcp/offerings',
			auth,
			request,
			ManageOfferingsRequestSchema,
			ManageOfferingsResponseSchema,
		)
	}

	managePackages(auth: InternalToolPrincipal, request: ManagePackagesRequest) {
		return this.postValidated(
			'/v1/internal/mcp/packages',
			auth,
			request,
			ManagePackagesRequestSchema,
			ManagePackagesResponseSchema,
		)
	}

	createProject(auth: InternalToolPrincipal, request: CreateProjectRequest) {
		return this.postValidated(
			'/v1/internal/mcp/projects',
			auth,
			request,
			CreateProjectRequestSchema,
			CreateProjectResponseSchema,
		)
	}

	createApp(auth: InternalToolPrincipal, request: CreateAppRequest) {
		return this.postValidated(
			'/v1/internal/mcp/apps',
			auth,
			request,
			CreateAppRequestSchema,
			CreateAppResponseSchema,
		)
	}

	deleteProject(auth: InternalToolPrincipal, request: DeleteProjectRequest) {
		return this.postValidated(
			'/v1/internal/mcp/projects/delete',
			auth,
			request,
			DeleteProjectRequestSchema,
			DeleteProjectResponseSchema,
		)
	}

	deleteApp(auth: InternalToolPrincipal, request: DeleteAppRequest) {
		return this.postValidated(
			'/v1/internal/mcp/apps/delete',
			auth,
			request,
			DeleteAppRequestSchema,
			DeleteAppResponseSchema,
		)
	}

	updateApp(auth: InternalToolPrincipal, request: UpdateAppRequest) {
		return this.postValidated(
			'/v1/internal/mcp/apps/update',
			auth,
			request,
			UpdateAppRequestSchema,
			UpdateAppResponseSchema,
		)
	}

	getRefundSaver(
		auth: InternalToolPrincipal,
		organizationId: string,
		appId: string,
	) {
		return this.request(
			'GET',
			`/v1/internal/mcp/apps/${encodeURIComponent(appId)}/refund-saver?organizationId=${encodeURIComponent(organizationId)}`,
			auth,
			undefined,
			RefundSaverResponseSchema,
		)
	}

	manageRefundSaver(
		auth: InternalToolPrincipal,
		request: ManageRefundSaverRequest,
	) {
		return this.postValidated(
			'/v1/internal/mcp/refund-saver',
			auth,
			request,
			ManageRefundSaverRequestSchema,
			ManageRefundSaverResponseSchema,
		)
	}
}
