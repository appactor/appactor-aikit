import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	loadXmlPackageLookupKeyContract,
	renderGeneratedPackageLookupKeySource,
	resolveXmlAstDir,
} from '../scripts/sync-package-lookup-key-rule'
import {
	PACKAGE_LOOKUP_KEY_MAX_LENGTH,
	PACKAGE_LOOKUP_KEY_MESSAGE,
	PACKAGE_LOOKUP_KEY_PATTERN,
	isPackageLookupKey,
} from '../src/contracts/package-lookup-key.generated'
import { ManagePackagesRequestSchema } from '../src/contracts/write'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OFFERING_ID = '22222222-2222-4222-8222-222222222222'
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333'
const IDEMPOTENCY_KEY = 'idem_key_12345'

const VALID_KEYS = [
	'annual',
	'six_months',
	'$rc_annual',
	'$weekly',
	'credits_300',
	'a.b-c',
	'0',
	'$',
	'A_1.2-3$',
	'a'.repeat(PACKAGE_LOOKUP_KEY_MAX_LENGTH),
]

const INVALID_STRINGS = [
	'',
	'   ',
	'300 Kredi',
	'weekly plan',
	'_leading',
	'-leading',
	'.leading',
	'annual!',
	'annual/pro',
	'yıllık',
	'a'.repeat(PACKAGE_LOOKUP_KEY_MAX_LENGTH + 1),
]

const INVALID_RAW_VALUES: unknown[] = [
	...INVALID_STRINGS,
	' annual ',
	'annual\n',
	'\tannual',
	['annual'],
	true,
	1,
	null,
	undefined,
	{ key: 'annual' },
]

describe('package lookup_key generated rule & parity with AppActor-XML-AST (Plan 8-12 / 8-13)', () => {
	test('enforces the canonical charset, 100-char limit, and non-empty writes', () => {
		expect(PACKAGE_LOOKUP_KEY_MAX_LENGTH).toBe(100)

		for (const key of VALID_KEYS) {
			expect(isPackageLookupKey(key)).toBe(true)
			expect(
				ManagePackagesRequestSchema.safeParse({
					action: 'create',
					organizationId: ORG_ID,
					idempotencyKey: IDEMPOTENCY_KEY,
					offeringId: OFFERING_ID,
					packageType: 'annual',
					lookupKey: key,
					displayName: 'Annual',
				}).success,
			).toBe(true)
			expect(
				ManagePackagesRequestSchema.safeParse({
					action: 'update',
					organizationId: ORG_ID,
					idempotencyKey: IDEMPOTENCY_KEY,
					packageId: PACKAGE_ID,
					lookupKey: key,
				}).success,
			).toBe(true)
		}

		for (const value of INVALID_RAW_VALUES) {
			expect(isPackageLookupKey(value)).toBe(false)
		}

		// Both create and update reject empty/whitespace, >100-char, invalid-charset, and null lookupKey.
		for (const bad of [...INVALID_STRINGS, null]) {
			expect(
				ManagePackagesRequestSchema.safeParse({
					action: 'create',
					organizationId: ORG_ID,
					idempotencyKey: IDEMPOTENCY_KEY,
					offeringId: OFFERING_ID,
					packageType: 'annual',
					lookupKey: bad,
					displayName: 'Annual',
				}).success,
			).toBe(false)
			expect(
				ManagePackagesRequestSchema.safeParse({
					action: 'update',
					organizationId: ORG_ID,
					idempotencyKey: IDEMPOTENCY_KEY,
					packageId: PACKAGE_ID,
					lookupKey: bad,
				}).success,
			).toBe(false)
		}

		// Omitting lookupKey remains valid (create auto-fills on API; update keeps existing key).
		expect(
			ManagePackagesRequestSchema.safeParse({
				action: 'create',
				organizationId: ORG_ID,
				idempotencyKey: IDEMPOTENCY_KEY,
				offeringId: OFFERING_ID,
				packageType: 'annual',
				displayName: 'Annual',
			}).success,
		).toBe(true)
		expect(
			ManagePackagesRequestSchema.safeParse({
				action: 'update',
				organizationId: ORG_ID,
				idempotencyKey: IDEMPOTENCY_KEY,
				packageId: PACKAGE_ID,
				displayName: 'Renamed',
			}).success,
		).toBe(true)
	})

	test('matches AppActor-XML-AST source of truth exactly when available', async () => {
		const xmlAstDir = resolveXmlAstDir(import.meta.dir)
		if (!xmlAstDir) {
			if (process.env.REQUIRE_XML_AST_PARITY === '1') {
				throw new Error(
					'REQUIRE_XML_AST_PARITY=1 was set, but AppActor-XML-AST could not be found',
				)
			}
			return
		}

		const xmlContract = await loadXmlPackageLookupKeyContract(xmlAstDir)

		expect(PACKAGE_LOOKUP_KEY_MAX_LENGTH).toBe(
			xmlContract.PACKAGE_LOOKUP_KEY_MAX_LENGTH,
		)
		expect(PACKAGE_LOOKUP_KEY_PATTERN.source).toBe(
			xmlContract.packageLookupKeyPattern.source,
		)
		expect(PACKAGE_LOOKUP_KEY_PATTERN.flags).toBe(
			xmlContract.packageLookupKeyPattern.flags,
		)
		expect(PACKAGE_LOOKUP_KEY_MESSAGE).toBe(
			xmlContract.PACKAGE_LOOKUP_KEY_MESSAGE,
		)

		for (const candidate of [...VALID_KEYS, ...INVALID_RAW_VALUES]) {
			expect(isPackageLookupKey(candidate)).toBe(
				xmlContract.isPackageLookupKey(candidate),
			)
		}

		const generatedPath = resolve(
			import.meta.dir,
			'../src/contracts/package-lookup-key.generated.ts',
		)
		const actualSource = readFileSync(generatedPath, 'utf8')
		const expectedSource = renderGeneratedPackageLookupKeySource(xmlContract)
		expect(actualSource).toBe(expectedSource)
	})
})
