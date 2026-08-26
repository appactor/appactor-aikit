function bytesToHex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function canonicalRequestTarget(url: URL) {
	const entries = [...url.searchParams.entries()].sort(
		([leftKey, leftValue], [rightKey, rightValue]) => {
			const keyOrder = leftKey.localeCompare(rightKey)
			return keyOrder || leftValue.localeCompare(rightValue)
		},
	)
	const query = new URLSearchParams(entries).toString()
	return query ? `${url.pathname}?${query}` : url.pathname
}

export async function sha256Hex(body: string | undefined) {
	const bytes = new TextEncoder().encode(body ?? '')
	return bytesToHex(
		new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)),
	)
}
