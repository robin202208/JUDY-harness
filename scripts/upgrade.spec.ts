import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { appendLedgerRow, patchFiles, steps } from './upgrade.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, content)
  }
  return root
}

describe('steps', () => {
  it('orders the cheap checks before the expensive ones', () => {
    const names = steps().map(step => step.name)

    expect(names.indexOf('contract diff')).toBeLessThan(names.indexOf('build'))
    expect(names.indexOf('preflight')).toBeLessThan(names.indexOf('contract diff'))
  })

  it('gives every step a distinct name and a stated reason', () => {
    const declared = steps()

    expect(new Set(declared.map(step => step.name)).size).toBe(declared.length)
    for (const step of declared) expect(step.why.length).toBeGreaterThan(0)
  })
})

describe('patchFiles', () => {
  it('returns nothing when the upgrade patch directory is absent', () => {
    const root = fixture({ 'package.json': '{}\n' })

    expect(patchFiles(root)).toEqual([])
  })

  it('applies only patches/upgrade, in sorted order, never pnpm patches', () => {
    const root = fixture({
      'patches/node-pty@1.1.0.patch': 'dependency patch\n',
      'patches/upgrade/b-second.patch': 'b\n',
      'patches/upgrade/a-first.patch': 'a\n',
      'patches/upgrade/notes.md': 'not a patch\n',
    })

    expect(patchFiles(root)).toEqual(['patches/upgrade/a-first.patch', 'patches/upgrade/b-second.patch'])
  })
})

describe('appendLedgerRow', () => {
  const ledger = (): string =>
    '# 升级记账\n\n| 日期 | 从 |\n|---|---|\n<!-- ledger:append -->\n\n尾部说明\n'

  it('inserts the row above the sentinel and keeps the sentinel last', () => {
    const root = fixture({ 'contracts/upgrade-ledger.md': ledger() })
    const path = join(root, 'contracts/upgrade-ledger.md')

    const line = appendLedgerRow(path, { date: '2026-11-02', from: 'a', to: 'b', minutes: '90' })

    const written = readFileSync(path, 'utf8')
    expect(line).toContain('| 2026-11-02 | a | b |')
    expect(written.indexOf(line!)).toBeLessThan(written.indexOf('<!-- ledger:append -->'))
    expect(written).toContain('尾部说明')
  })

  it('renders missing columns as an em dash rather than a hole', () => {
    const root = fixture({ 'contracts/upgrade-ledger.md': ledger() })
    const path = join(root, 'contracts/upgrade-ledger.md')

    const line = appendLedgerRow(path, { date: '2026-11-02' })

    expect(line).toBe('| 2026-11-02 | — | — | — | — | — | — | — |')
  })

  it('appends successive rows in call order', () => {
    const root = fixture({ 'contracts/upgrade-ledger.md': ledger() })
    const path = join(root, 'contracts/upgrade-ledger.md')

    appendLedgerRow(path, { date: '2026-11-02', from: 'first' })
    appendLedgerRow(path, { date: '2026-11-03', from: 'second' })

    const written = readFileSync(path, 'utf8')
    expect(written.indexOf('first')).toBeLessThan(written.indexOf('second'))
  })

  it('refuses to invent a sentinel, and leaves the file untouched', () => {
    const source = '# 升级记账\n\n没有哨兵\n'
    const root = fixture({ 'contracts/upgrade-ledger.md': source })
    const path = join(root, 'contracts/upgrade-ledger.md')

    expect(appendLedgerRow(path, { date: '2026-11-02' })).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  it('returns undefined when the ledger file is absent', () => {
    const root = fixture({ 'package.json': '{}\n' })

    expect(appendLedgerRow(join(root, 'contracts/upgrade-ledger.md'), { date: '2026-11-02' })).toBeUndefined()
  })
})
