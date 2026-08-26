import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = join(import.meta.dir, '..')
const skillsDir = join(pluginRoot, 'skills')

function parseFrontmatter(source: string) {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
	if (!match) return null
	const fields: Record<string, string> = {}
	for (const line of (match[1] as string).split('\n')) {
		const separator = line.indexOf(':')
		if (separator === -1) continue
		fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
	}
	return fields
}

const skillNames = readdirSync(skillsDir).filter((entry) =>
	statSync(join(skillsDir, entry)).isDirectory(),
)

describe('AppActor plugin', () => {
	test('declares the remote MCP server', () => {
		const mcp = JSON.parse(
			readFileSync(join(pluginRoot, '.mcp.json'), 'utf8'),
		) as Record<string, { type: string; url: string }>
		expect(mcp.appactor).toEqual({
			type: 'http',
			url: 'https://mcp.appactor.com/mcp',
		})
	})

	test('has a plugin manifest with a name and description', () => {
		const manifest = JSON.parse(
			readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
		) as { name?: string; description?: string; version?: string }
		expect(manifest.name).toBe('appactor')
		expect(manifest.description?.length).toBeGreaterThan(20)
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
	})

	test('ships every skill this plugin is meant to provide', () => {
		expect(skillNames.sort()).toEqual([
			'appactor-android',
			'appactor-flutter',
			'appactor-ios',
			'appactor-paywalls-and-offerings',
			'appactor-react-native',
			'appactor-remote-config-and-experiments',
			'appactor-troubleshooting',
			'appactor-workspace',
		])
	})
})

describe.each(skillNames)('skill %s', (skillName) => {
	const source = readFileSync(join(skillsDir, skillName, 'SKILL.md'), 'utf8')
	const frontmatter = parseFrontmatter(source)

	test('has frontmatter whose name matches its directory', () => {
		expect(frontmatter).not.toBeNull()
		expect(frontmatter?.name).toBe(skillName)
	})

	test('has a description long enough to route on', () => {
		// The description is the only thing the model sees when deciding whether
		// to load a skill, so a bare restatement of the name is not enough.
		expect((frontmatter?.description ?? '').length).toBeGreaterThan(80)
	})

	test('has body content after the frontmatter', () => {
		expect(
			source.split('---\n').slice(2).join('---\n').trim().length,
		).toBeGreaterThan(400)
	})

	test('only cross-references skills that exist', () => {
		const referenced = [...source.matchAll(/`(appactor-[a-z-]+)`/g)].map(
			(match) => match[1] as string,
		)
		for (const reference of new Set(referenced)) {
			expect(skillNames).toContain(reference)
		}
	})
})
