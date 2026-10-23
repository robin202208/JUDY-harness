import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { JUDY_REPO, brandManifestText, brandProseText, brandTree } from './brand.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-brand-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return root
}

/** One upstream manifest, formatted the way upstream formats them. */
const UPSTREAM = `${JSON.stringify({
  name: '@deepseek-ai/dsh-llm',
  version: '0.2.1-rc.2',
  description: 'Provider-neutral LLM service interface for the JUDY',
  repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git' },
  dependencies: { '@deepseek-ai/dsh-brand': 'workspace:*' },
}, null, 2)}\n`


/** The manifest fields this spec reads back. */
interface Manifest {
  description: string
  version: string
  repository: { url: string }
}

function readManifest(text: string): Manifest {
  return JSON.parse(text) as Manifest
}

describe('brandManifestText', () => {
  it('rewrites the description and the repository url', () => {
    const { text, changes } = brandManifestText(UPSTREAM)
    expect(changes).toEqual({ description: 1, repository: 1, version: 0 })
    expect(readManifest(text).description).toBe('Provider-neutral LLM service interface for the JUDY')
    expect(readManifest(text).repository.url).toBe(JUDY_REPO)
  })

  it('touches only the rewritten lines, keeping upstream formatting', () => {
    const before = UPSTREAM.split('\n')
    const after = brandManifestText(UPSTREAM).text.split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((line, index) => line !== before[index])
    expect(changed).toHaveLength(2)
    expect(changed[0]).toContain('"description"')
    expect(changed[1]).toContain('"url"')
  })

  it('is idempotent', () => {
    const once = brandManifestText(UPSTREAM).text
    const twice = brandManifestText(once)
    expect(twice.text).toBe(once)
    expect(twice.changes).toEqual({ description: 0, repository: 0, version: 0 })
  })

  it('keeps the clause after the product name', () => {
    const raw = '{\n  "description": "Agent runtime for the JUDY — plugins all the way down"\n}\n'
    expect(brandManifestText(raw).text).toContain('Agent runtime for the JUDY — plugins all the way down')
  })

  it('rewrites the bare-string repository form too', () => {
    const raw = '{\n  "repository": "git+https://github.com/deepseek-ai/deepseek-harness.git"\n}\n'
    expect(brandManifestText(raw).text).toContain(JUDY_REPO)
  })

  it('leaves a repository that is already the fork alone', () => {
    const raw = `{\n  "repository": "${JUDY_REPO}"\n}\n`
    expect(brandManifestText(raw).changes.repository).toBe(0)
  })

  it('forces a version only when one is requested and it differs', () => {
    expect(brandManifestText(UPSTREAM, { version: '0.1.0-rc.5' }).changes.version).toBe(1)
    expect(readManifest(brandManifestText(UPSTREAM, { version: '0.1.0-rc.5' }).text).version).toBe('0.1.0-rc.5')
    expect(brandManifestText(UPSTREAM, { version: '0.2.1-rc.2' }).changes.version).toBe(0)
    expect(brandManifestText(UPSTREAM).changes.version).toBe(0)
  })

  it('leaves text that names no upstream product untouched', () => {
    const raw = '{\n  "description": "Something else entirely"\n}\n'
    expect(brandManifestText(raw).text).toBe(raw)
  })
})

describe('brandProseText', () => {
  it('replaces both product spellings', () => {
    expect(brandProseText('The JUDY and the deepseek-harness repo')).toBe('The JUDY and the JUDY-harness repo')
  })

  it('does not touch words that merely contain the name', () => {
    const raw = 'DeepSeekHarness is not a word; JUDY is.'
    expect(brandProseText(raw)).toBe('DeepSeekHarness is not a word; JUDY is.')
  })
})

describe('brandTree', () => {
  it('rewrites manifests and skips installed dependencies', () => {
    const root = fixture({
      'packages/a/package.json': UPSTREAM,
      'node_modules/dep/package.json': UPSTREAM,
    })
    const { stats, changed } = brandTree(root)

    expect(stats.files).toBe(1)
    expect(changed).toEqual(['packages/a/package.json'])
    expect(readFileSync(join(root, 'packages/a/package.json'), 'utf8')).toContain('for the JUDY')
    expect(readFileSync(join(root, 'node_modules/dep/package.json'), 'utf8')).toBe(UPSTREAM)
  })

  it('writes nothing on a dry run', () => {
    const root = fixture({ 'packages/a/package.json': UPSTREAM })
    const { stats } = brandTree(root, { dryRun: true })

    expect(stats.files).toBe(1)
    expect(readFileSync(join(root, 'packages/a/package.json'), 'utf8')).toBe(UPSTREAM)
  })

  it('leaves prose alone unless asked', () => {
    const root = fixture({ 'docs/readme.md': 'the JUDY\n' })

    expect(brandTree(root).stats.files).toBe(0)
    expect(readFileSync(join(root, 'docs/readme.md'), 'utf8')).toBe('the JUDY\n')

    brandTree(root, { prose: true })
    expect(readFileSync(join(root, 'docs/readme.md'), 'utf8')).toBe('the JUDY\n')
  })
})
