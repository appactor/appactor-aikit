import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface XmlPackageLookupKeyContract {
	PACKAGE_LOOKUP_KEY_MAX_LENGTH: number
	PACKAGE_LOOKUP_KEY_MESSAGE: string
	packageLookupKeyPattern: RegExp
	isPackageLookupKey: (value: unknown) => boolean
}

export function resolveXmlAstDir(
	fromDir: string = import.meta.dir,
): string | null {
	const candidates = [
		process.env.APPACTOR_XML_AST_DIR,
		resolve(fromDir, '../../AppActor-XML-AST'),
		resolve(fromDir, '../../../AppActor-XML-AST'),
	].filter((dir): dir is string => Boolean(dir))

	for (const candidate of candidates) {
		if (existsSync(resolve(candidate, 'src/exports.mjs'))) {
			return candidate
		}
	}
	return null
}

export async function loadXmlPackageLookupKeyContract(
	xmlAstDir: string,
): Promise<XmlPackageLookupKeyContract> {
	const exportsUrl = pathToFileURL(resolve(xmlAstDir, 'src/exports.mjs')).href
	const mod = (await import(exportsUrl)) as Partial<XmlPackageLookupKeyContract>
	if (
		typeof mod.PACKAGE_LOOKUP_KEY_MAX_LENGTH !== 'number' ||
		typeof mod.PACKAGE_LOOKUP_KEY_MESSAGE !== 'string' ||
		!(mod.packageLookupKeyPattern instanceof RegExp) ||
		typeof mod.isPackageLookupKey !== 'function'
	) {
		throw new Error(
			`AppActor-XML-AST at ${xmlAstDir} does not export the canonical package lookup key contract`,
		)
	}
	return {
		PACKAGE_LOOKUP_KEY_MAX_LENGTH: mod.PACKAGE_LOOKUP_KEY_MAX_LENGTH,
		PACKAGE_LOOKUP_KEY_MESSAGE: mod.PACKAGE_LOOKUP_KEY_MESSAGE,
		packageLookupKeyPattern: mod.packageLookupKeyPattern,
		isPackageLookupKey: mod.isPackageLookupKey,
	}
}

export function renderGeneratedPackageLookupKeySource(
	contract: XmlPackageLookupKeyContract,
): string {
	const patternLiteral = `/${contract.packageLookupKeyPattern.source}/${contract.packageLookupKeyPattern.flags}`
	const messageLiteral = JSON.stringify(
		contract.PACKAGE_LOOKUP_KEY_MESSAGE,
	).replace(/^"|"$/g, "'")
	return [
		'// GENERATED FROM AppActor-XML-AST (src/schema/validation.mjs) — DO NOT EDIT BY HAND.',
		'// Regenerate with: bun run sync:package-lookup-key',
		'// Verified by: tests/package-lookup-key-parity.test.ts',
		'',
		`export const PACKAGE_LOOKUP_KEY_MAX_LENGTH = ${contract.PACKAGE_LOOKUP_KEY_MAX_LENGTH}`,
		`export const PACKAGE_LOOKUP_KEY_PATTERN = ${patternLiteral}`,
		'export const PACKAGE_LOOKUP_KEY_MESSAGE =',
		`\t${messageLiteral}`,
		'',
		'export function isPackageLookupKey(value: unknown): value is string {',
		'\treturn (',
		"\t\ttypeof value === 'string' &&",
		'\t\tPACKAGE_LOOKUP_KEY_PATTERN.test(value) &&',
		'\t\tvalue.length <= PACKAGE_LOOKUP_KEY_MAX_LENGTH',
		'\t)',
		'}',
		'',
	].join('\n')
}

if (import.meta.main) {
	const xmlAstDir = resolveXmlAstDir(import.meta.dir)
	if (!xmlAstDir) {
		console.error(
			'Could not locate AppActor-XML-AST. Set APPACTOR_XML_AST_DIR=/path/to/AppActor-XML-AST and re-run.',
		)
		process.exit(1)
	}
	const contract = await loadXmlPackageLookupKeyContract(xmlAstDir)
	const outPath = resolve(
		import.meta.dir,
		'../src/contracts/package-lookup-key.generated.ts',
	)
	writeFileSync(
		outPath,
		renderGeneratedPackageLookupKeySource(contract),
		'utf8',
	)
	console.log(`Synced ${outPath} from ${xmlAstDir}`)
}
