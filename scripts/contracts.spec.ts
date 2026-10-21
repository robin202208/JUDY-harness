import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  diffSnapshots,
  renderReport,
  snapshotFromRepo,
  stableSnapshot,
  type Snapshot,
} from './contracts.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A complete snapshot with one value overridable per field. */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1,
    source: { kind: 'asar', path: 'before.app', version: '1.0.0', capturedAt: '2026-01-01T00:00:00.000Z' },
    packages: { '@deepseek-ai/dsh-brand': '1.0.0' },
    clientModules: [{ name: '@deepseek-ai/dsh-client-ui-sidebar', inject: ['@deepseek-ai/dsh-client-ui-slots'], platform: 'web' }],
    bundlePatches: { '@deepseek-ai/dsh-web-app': ['cordis.patch.yml'] },
    rowIds: ['ui-brand-official', 'agent-loop'],
    slots: ['sidebar.brand.mark', 'sidebar.brand.name'],
    envVars: ['DSH_HOME', 'DSH_WEB_SEARCH_PROVIDER'],
    ...overrides,
  }
}

describe('diffSnapshots', () => {
  it('reports nothing for identical snapshots', () => {
    expect(diffSnapshots(snapshot(), snapshot())).toEqual([])
  })

  it('treats a removed slot as breaking and an added one as information', () => {
    const changes = diffSnapshots(
      snapshot(),
      snapshot({ slots: ['sidebar.brand.name', 'sidebar.brand.badge'] }),
    )

    expect(changes).toContainEqual({ severity: 'breaking', area: 'slot', detail: 'removed sidebar.brand.mark' })
    expect(changes).toContainEqual({ severity: 'info', area: 'slot', detail: 'added sidebar.brand.badge' })
  })

  it('treats a removed row id as breaking, because a patch layer targets it', () => {
    const changes = diffSnapshots(snapshot(), snapshot({ rowIds: ['agent-loop'] }))

    expect(changes).toContainEqual({ severity: 'breaking', area: 'row id', detail: 'removed ui-brand-official' })
  })

  it('treats a removed package as breaking and a version bump as information', () => {
    const changes = diffSnapshots(
      snapshot(),
      snapshot({ packages: { '@deepseek-ai/dsh-brand': '1.1.0', '@deepseek-ai/dsh-base': '1.1.0' } }),
    )

    expect(changes).toContainEqual({ severity: 'info', area: 'package', detail: '@deepseek-ai/dsh-brand 1.0.0 -> 1.1.0' })
    expect(changes).toContainEqual({ severity: 'info', area: 'package', detail: 'added @deepseek-ai/dsh-base@1.1.0' })
  })

  it('warns when an environment variable disappears, since a deployment may depend on it', () => {
    const changes = diffSnapshots(snapshot(), snapshot({ envVars: ['DSH_HOME'] }))

    expect(changes).toContainEqual({
      severity: 'warning',
      area: 'env var',
      detail: 'removed DSH_WEB_SEARCH_PROVIDER',
    })
  })

  it('treats a lost client-module inject edge as breaking', () => {
    const changes = diffSnapshots(
      snapshot(),
      snapshot({
        clientModules: [{ name: '@deepseek-ai/dsh-client-ui-sidebar', inject: [], platform: 'web' }],
      }),
    )

    expect(changes).toContainEqual(expect.objectContaining({ severity: 'breaking', area: 'inject' }))
  })

  it('flags a changed bundle patch file list', () => {
    const changes = diffSnapshots(
      snapshot(),
      snapshot({ bundlePatches: { '@deepseek-ai/dsh-web-app': ['cordis.patch.yml', 'desktop.yml'] } }),
    )

    expect(changes).toContainEqual(expect.objectContaining({ severity: 'warning', area: 'bundle patch' }))
  })
})

describe('renderReport', () => {
  it('grades changes into three sections with counts', () => {
    const report = renderReport(
      snapshot(),
      snapshot({ slots: ['sidebar.brand.name', 'sidebar.brand.badge'] }),
      [{ severity: 'breaking', area: 'slot', detail: 'removed sidebar.brand.mark' }],
    )

    expect(report).toContain('# 契约体检：1.0.0 → 1.0.0')
    expect(report).toContain('## 必须处理（1）')
    expect(report).toContain('- removed sidebar.brand.mark')
  })

  it('says so explicitly when nothing changed', () => {
    const report = renderReport(snapshot(), snapshot(), [])

    expect(report).toContain('契约无变化')
    expect(report).toContain('契约没变不代表行为没变')
  })
})

describe('stableSnapshot', () => {
  it('sorts and deduplicates every collection so snapshots diff cleanly', () => {
    const stabilized = stableSnapshot(snapshot({
      packages: { '@deepseek-ai/zeta': '1.0.0', '@deepseek-ai/alpha': '1.0.0' },
      slots: ['b.slot', 'a.slot', 'a.slot'],
      rowIds: ['z-row', 'a-row'],
      envVars: ['DSH_Z', 'DSH_A'],
    }))

    expect(Object.keys(stabilized.packages)).toEqual(['@deepseek-ai/alpha', '@deepseek-ai/zeta'])
    expect(stabilized.slots).toEqual(['a.slot', 'b.slot'])
    expect(stabilized.rowIds).toEqual(['a-row', 'z-row'])
    expect(stabilized.envVars).toEqual(['DSH_A', 'DSH_Z'])
  })
})

describe('snapshotFromRepo', () => {
  it('reads packages, client modules, bundle rows, slots and environment reads from source', () => {
    const root = mkdtempSync(join(tmpdir(), 'contracts-'))
    roots.push(root)
    const write = (path: string, content: string): void => {
      const absolute = join(root, path)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, content)
    }

    write('package.json', JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '9.9.9' }))
    write('packages/client/ui-brand/package.json', JSON.stringify({
      name: '@deepseek-ai/dsh-client-ui-brand',
      version: '9.9.9',
      dsh: { client: { inject: ['@deepseek-ai/dsh-client-ui-sidebar'], platform: 'web' } },
    }))
    write(
      'packages/client/ui-brand/lib/client.js',
      'const x = renderSlot("sidebar.brand.mark")\nprocess.env.DSH_BRAND_PROFILE\n',
    )
    write('packages/web/app/package.json', JSON.stringify({
      name: '@deepseek-ai/dsh-web-app',
      version: '9.9.9',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }))
    write('packages/web/app/cordis.patch.yml', "- id: ui-brand-official\n  disabled: true\n")

    const captured = snapshotFromRepo(root)

    expect(captured.source.version).toBe('9.9.9')
    expect(Object.keys(captured.packages).sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-brand',
      '@deepseek-ai/dsh-root',
      '@deepseek-ai/dsh-web-app',
    ])
    expect(captured.clientModules).toEqual([{
      name: '@deepseek-ai/dsh-client-ui-brand',
      inject: ['@deepseek-ai/dsh-client-ui-sidebar'],
      platform: 'web',
    }])
    expect(captured.rowIds).toEqual(['ui-brand-official'])
    expect(captured.slots).toEqual(['sidebar.brand.mark'])
    expect(captured.envVars).toEqual(['DSH_BRAND_PROFILE'])
    expect(captured.bundlePatches).toEqual({ '@deepseek-ai/dsh-web-app': ['cordis.patch.yml'] })
  })
})
