import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { collectSkillBundleViolations } from './verify-skill-bundles.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Materialize a throwaway repository from a path → contents map. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-bundles-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return root
}

/** Diagnostics rendered as `severity: message`, so assertions read like the CLI. */
function messages(root: string): string[] {
  return collectSkillBundleViolations(root).map(diagnostic => `${diagnostic.severity}: ${diagnostic.message}`)
}

function hasPython(): boolean {
  try {
    execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

const skill = (frontmatter: string, body = ''): string => `---\n${frontmatter}\n---\n\n${body}`

describe('collectSkillBundleViolations', () => {
  it('accepts a bundle whose frontmatter and resources are complete', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: Does one thing.', 'Run `scripts/run.py`.'),
      '.agents/skills/alpha/scripts/run.py': 'print("ok")\n',
    })

    expect(messages(root)).toEqual([])
  })

  it('rejects a SKILL.md nested deeper than <root>/<name>/SKILL.md', () => {
    const root = fixture({
      '.agents/skills/alpha/nested/deep/SKILL.md': skill('name: alpha\ndescription: Hidden.'),
    })

    const found = messages(root).join('\n')
    expect(found).toContain('never discovered')
    expect(found).toContain('error')
  })

  it('rejects a missing description, because the catalog drops the skill', () => {
    const root = fixture({
      '.agents/skills/beta/SKILL.md': skill('name: beta'),
    })

    expect(messages(root)).toContainEqual(expect.stringContaining('needs a non-empty `description`'))
  })

  it('rejects a non-boolean invocation flag', () => {
    const root = fixture({
      '.agents/skills/gamma/SKILL.md': skill('name: gamma\ndescription: x.\nuser-invocable: "sometimes"'),
    })

    expect(messages(root)).toContainEqual(expect.stringContaining('`user-invocable` must be a YAML boolean'))
  })

  it('rejects a resource the body promises but the bundle does not ship', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: x.', 'Run `scripts/missing.py`.'),
    })

    expect(messages(root)).toContainEqual(
      expect.stringContaining('promises `scripts/missing.py`'),
    )
  })

  it('accepts a repository-level script reference, which the bundle need not own', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: x.', '[scripts/tool.ts](../../../scripts/tool.ts)'),
      'scripts/tool.ts': 'export {}\n',
    })

    expect(messages(root)).toEqual([])
  })

  it('ignores slash-separated prose that is not a path', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: x.', '- LLM/tools/system prompt and scripts/tests layout.'),
    })

    expect(messages(root)).toEqual([])
  })

  it.skipIf(!hasPython())('rejects a script that does not parse', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: x.', 'Run `scripts/broken.py`.'),
      '.agents/skills/alpha/scripts/broken.py': 'def broken(:\n',
    })

    expect(messages(root)).toContainEqual(expect.stringContaining('does not parse as Python'))
  })

  it('warns about a shipped script the body never names', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: x.', 'No scripts mentioned.'),
      '.agents/skills/alpha/scripts/ghost.py': 'print("ok")\n',
    })

    expect(messages(root)).toContainEqual(expect.stringContaining('never named in the body'))
  })

  it('warns when the frontmatter name and the bundle name disagree', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: renamed\ndescription: x.'),
    })

    expect(messages(root)).toContainEqual(expect.stringContaining('differs from the bundle name'))
  })

  it('rejects the same skill name in two ranked roots', () => {
    const root = fixture({
      '.agents/skills/alpha/SKILL.md': skill('name: alpha\ndescription: x.'),
      '.dsh/skills/alpha/SKILL.md': skill('name: alpha\ndescription: shadow copy.'),
    })

    expect(messages(root)).toContainEqual(expect.stringContaining('is already provided by'))
  })
})
