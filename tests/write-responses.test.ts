import { describe, expect, test } from 'bun:test'
import {
	CreateAppResponseSchema,
	CreateProjectResponseSchema,
	DeleteAppResponseSchema,
	DeleteProjectResponseSchema,
	ManageEntitlementsResponseSchema,
	ManageOfferingsResponseSchema,
	ManagePackagesResponseSchema,
	ManageProductsResponseSchema,
} from '../src/contracts/write-responses'
import {
	app,
	deletePreview,
	entitlement,
	ids,
	offering,
	pkg,
	product,
	project,
	projectDeleteImpact,
	succeeded,
	timestamp,
} from './helpers/write-response-fixtures'

describe('MCP controlled write responses', () => {
	test('accepts every supported response action and replay family', () => {
		const responses = [
			[
				ManageProductsResponseSchema,
				{ status: 'discovered', platform: 'ios', products: [] },
			],
			[
				ManageProductsResponseSchema,
				succeeded('import', { imported: 1, total: 1, products: [product] }),
			],
			[ManageProductsResponseSchema, succeeded('classify', { product }, true)],
			[ManageEntitlementsResponseSchema, succeeded('create', { entitlement })],
			[
				ManageEntitlementsResponseSchema,
				succeeded('update', { entitlement }, true),
			],
			[
				ManageEntitlementsResponseSchema,
				succeeded('attach_product', {
					productId: ids.resource,
					attachedEntitlementIds: [ids.secondary],
				}),
			],
			[
				ManageOfferingsResponseSchema,
				{
					status: 'preview',
					previewToken: 'p'.repeat(64),
					expiresAt: timestamp,
					changes: {
						currentOfferingId: null,
						nextOfferingId: ids.resource,
						packageCount: 1,
						packageProductCount: 1,
					},
				},
			],
			[ManageOfferingsResponseSchema, succeeded('create', { offering })],
			[ManageOfferingsResponseSchema, succeeded('update', { offering })],
			[
				ManageOfferingsResponseSchema,
				succeeded(
					'apply_publish',
					{
						offering: { ...offering, isCurrent: true },
					},
					true,
				),
			],
			[ManagePackagesResponseSchema, succeeded('create', { package: pkg })],
			[
				ManagePackagesResponseSchema,
				succeeded('update', { package: pkg }, true),
			],
			[
				ManagePackagesResponseSchema,
				succeeded('attach_product', {
					packageProduct: {
						packageId: ids.resource,
						productId: ids.secondary,
						googleOfferId: null,
						position: 0,
						createdAt: timestamp,
					},
				}),
			],
			[CreateProjectResponseSchema, succeeded('create', { project })],
			[
				CreateAppResponseSchema,
				{
					status: 'action_required',
					code: 'google_credential_required',
					message: 'Connect Google credentials.',
					url: 'https://dashboard.example.com/settings?tab=credentials',
				},
			],
			[
				CreateAppResponseSchema,
				succeeded('create', { app, publicApiKey: 'pk_public' }, true),
			],
			[
				CreateAppResponseSchema,
				succeeded('create', {
					app,
					publicApiKey: 'pk_public',
					appleConnectionWarning:
						'No Apple credential is connected, so the app was created without one.',
				}),
			],
			[DeleteProjectResponseSchema, deletePreview('project', 'New Project')],
			[DeleteAppResponseSchema, deletePreview('app', 'Example App')],
			[
				DeleteProjectResponseSchema,
				succeeded('apply', {
					deleted: true,
					alreadyAbsent: false,
					target: 'project',
					targetId: ids.project,
					name: 'New Project',
					impact: projectDeleteImpact,
				}),
			],
			[
				DeleteAppResponseSchema,
				succeeded(
					'apply',
					{
						deleted: true,
						alreadyAbsent: true,
						target: 'app',
						targetId: ids.resource,
						name: 'Example App',
						impact: null,
					},
					true,
				),
			],
		] as const

		for (const [schema, response] of responses) {
			expect(schema.safeParse(response).success).toBe(true)
		}
	})

	test('fails closed on secret-bearing or unexpected upstream fields', () => {
		const unsafeResponses = [
			[
				// A delete response that claims the wrong target would let a project preview be
				// presented to the user as an app deletion.
				DeleteAppResponseSchema,
				deletePreview('project', 'New Project'),
			],
			[
				DeleteProjectResponseSchema,
				succeeded('apply', {
					deleted: true,
					alreadyAbsent: false,
					target: 'project',
					targetId: ids.project,
					name: 'New Project',
					impact: projectDeleteImpact,
					previewToken: 'must-not-leak',
				}),
			],
			[
				// `deleted: false` has no meaning here: apply either deleted or found it already gone.
				DeleteProjectResponseSchema,
				succeeded('apply', {
					deleted: false,
					alreadyAbsent: false,
					target: 'project',
					targetId: ids.project,
					name: 'New Project',
					impact: projectDeleteImpact,
				}),
			],
			[
				CreateAppResponseSchema,
				succeeded('create', {
					app: { ...app, googleCredentialId: ids.secondary },
					publicApiKey: 'pk_public',
				}),
			],
			[
				CreateAppResponseSchema,
				succeeded('create', {
					app: { ...app, webhookSecret: 'must-not-leak' },
					publicApiKey: 'pk_public',
				}),
			],
			[
				CreateProjectResponseSchema,
				succeeded('create', {
					project,
					credentialJson: { private_key: 'must-not-leak' },
				}),
			],
			[
				ManageProductsResponseSchema,
				succeeded('classify', {
					product: { ...product, metadata: { privateKey: 'must-not-leak' } },
				}),
			],
		] as const

		for (const [schema, response] of unsafeResponses) {
			expect(() => schema.parse(response)).toThrow()
		}
	})
})
