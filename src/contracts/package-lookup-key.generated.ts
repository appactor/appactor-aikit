// GENERATED FROM AppActor-XML-AST (src/schema/validation.mjs) — DO NOT EDIT BY HAND.
// Regenerate with: bun run sync:package-lookup-key
// Verified by: tests/package-lookup-key-parity.test.ts

export const PACKAGE_LOOKUP_KEY_MAX_LENGTH = 100
export const PACKAGE_LOOKUP_KEY_PATTERN = /^[a-zA-Z0-9$][a-zA-Z0-9._$-]*$/
export const PACKAGE_LOOKUP_KEY_MESSAGE =
	'Package key must start with a letter, digit or $ and use only letters, digits, dot, underscore, dash or $.'

export function isPackageLookupKey(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		PACKAGE_LOOKUP_KEY_PATTERN.test(value) &&
		value.length <= PACKAGE_LOOKUP_KEY_MAX_LENGTH
	)
}
