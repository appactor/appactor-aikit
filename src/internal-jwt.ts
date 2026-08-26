import { randomUUID } from 'node:crypto'
import { SignJWT, importPKCS8 } from 'jose'
import type { Config } from './config'

const ALGORITHM = 'ES256'

export type InternalToolRequest = {
	userId: string
	clientId: string
	scopes: string[]
	tool: string
}

function normalizePem(value: string) {
	return value.replace(/\\n/g, '\n').trim()
}

export class InternalTokenSigner {
	private keyPromise: ReturnType<typeof importPKCS8> | null = null

	constructor(private readonly config: Config) {}

	private getKey() {
		this.keyPromise ??= importPKCS8(
			normalizePem(this.config.MCP_INTERNAL_JWT_PRIVATE_KEY),
			ALGORITHM,
		)
		return this.keyPromise
	}

	async sign(request: InternalToolRequest): Promise<string> {
		return new SignJWT({
			scope: request.scopes.join(' '),
			client_id: request.clientId,
			tool: request.tool,
		})
			.setProtectedHeader({
				alg: ALGORITHM,
				kid: this.config.MCP_INTERNAL_JWT_KEY_ID,
				typ: 'JWT',
			})
			.setSubject(request.userId)
			.setIssuer(this.config.MCP_INTERNAL_JWT_ISSUER)
			.setAudience(this.config.MCP_INTERNAL_JWT_AUDIENCE)
			.setJti(randomUUID())
			.setIssuedAt()
			.setExpirationTime('45s')
			.sign(await this.getKey())
	}
}
