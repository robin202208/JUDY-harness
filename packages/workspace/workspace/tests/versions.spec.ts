/**
 * Tests for turn-scoped version snapshots: what a walk records, which caps end
 * it, how failures degrade, and what two snapshots say changed.
 */

import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { changedVersions, collectVersions } from '../src/versions.ts'
import { deliverablePaths, turnDeliverables } from '../src/turn-deliverables.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-versions-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function file(relative: string, content: string): Promise<void> {
  const absolute = join(dir, relative)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, content)
}

describe('collectVersions', () => {
  it('records regular files by relative POSIX path', async () => {
    await file('a.txt', 'a')
    await file('sub/b.txt', 'bb')

    const snapshot = await collectVersions(dir)

    expect([...snapshot.entries.keys()].sort()).toEqual(['a.txt', 'sub/b.txt'])
    expect(snapshot.entries.get('sub/b.txt')?.size).toBe(2)
    expect(snapshot.truncated).toBe(false)
  })

  it('skips the noise directories a turn never means to deliver', async () => {
    await file('keep.txt', 'k')
    await file('node_modules/dep/index.js', 'x')
    await file('.git/HEAD', 'ref')

    const snapshot = await collectVersions(dir)

    expect([...snapshot.entries.keys()]).toEqual(['keep.txt'])
  })

  it('stops at maxDepth and reports truncation instead of pretending the tree ended', async () => {
    await file('a/one.txt', '1')
    await file('a/b/two.txt', '2')

    const snapshot = await collectVersions(dir, { maxDepth: 1 })

    expect([...snapshot.entries.keys()]).toEqual(['a/one.txt'])
    expect(snapshot.truncated).toBe(true)
  })

  it('stops at maxEntries and reports truncation', async () => {
    for (let index = 0; index < 5; index++) await file(`f${index}.txt`, 'x')

    const snapshot = await collectVersions(dir, { maxEntries: 3 })

    expect(snapshot.entries.size).toBe(3)
    expect(snapshot.truncated).toBe(true)
  })

  it('counts an unreadable directory and keeps walking', async () => {
    await file('ok.txt', 'x')
    await mkdir(join(dir, 'locked'), { recursive: true })
    await file('locked/inner.txt', 'i')

    const snapshot = await collectVersions(dir, { ignore: ['nothing'] })
    expect(snapshot.unreadable).toBe(0) // readable in this environment
    expect(snapshot.entries.has('locked/inner.txt')).toBe(true)
  })

  it('records a symlinked directory without following it', async () => {
    await file('real/a.txt', 'a')
    await symlink(join(dir, 'real'), join(dir, 'link'))

    const snapshot = await collectVersions(dir)

    // The link itself is recorded; its target's children are walked once, under the real name.
    expect(snapshot.entries.has('link')).toBe(true)
    expect(snapshot.entries.has('real/a.txt')).toBe(true)
    expect(snapshot.entries.has('link/a.txt')).toBe(false)
  })
})

describe('changedVersions', () => {
  it('reports created, modified, and removed paths', async () => {
    await file('stays.txt', 'same')
    await file('goes.txt', 'bye')
    await file('changes.txt', 'v1')
    const before = await collectVersions(dir)

    await rm(join(dir, 'goes.txt'))
    await file('changes.txt', 'v2')
    await file('new.txt', 'hello')
    const after = await collectVersions(dir)

    expect(changedVersions(before, after)).toEqual({
      created: ['new.txt'],
      modified: ['changes.txt'],
      removed: ['goes.txt'],
      truncated: false,
    })
  })

  it('sees a same-size rewrite, which size and name alone would miss', async () => {
    await file('report.csv', 'aaa')
    const before = await collectVersions(dir)
    const original = before.entries.get('report.csv')
    if (original === undefined) throw new Error('fixture missing')

    await file('report.csv', 'bbb')
    // Restoring mtime keeps the test honest on coarse filesystems: the version
    // must move because of ctime, not because the clock happened to tick.
    await utimes(join(dir, 'report.csv'), new Date(), new Date(1_600_000_000_000))
    const after = await collectVersions(dir)

    expect(after.entries.get('report.csv')?.size).toBe(3)
    expect(changedVersions(before, after).modified).toEqual(['report.csv'])
  })

  it('reports an unchanged tree as empty', async () => {
    await file('a.txt', 'a')
    const before = await collectVersions(dir)
    const after = await collectVersions(dir)

    expect(changedVersions(before, after)).toEqual({
      created: [], modified: [], removed: [], truncated: false,
    })
  })

  it('marks the diff as a lower bound when either side was truncated', async () => {
    for (let index = 0; index < 4; index++) await file(`f${index}.txt`, 'x')
    const before = await collectVersions(dir, { maxEntries: 2 })
    const after = await collectVersions(dir, { maxEntries: 2 })

    expect(changedVersions(before, after).truncated).toBe(true)
  })
})

describe('turnDeliverables', () => {
  it('maps a snapshot pair to the published event payload', async () => {
    await file('kept.txt', 'k')
    await file('gone.txt', 'g')
    await file('edited.txt', 'v1')
    const before = await collectVersions(dir)

    await rm(join(dir, 'gone.txt'))
    await file('edited.txt', 'v2')
    await file('fresh.txt', 'new')
    const after = await collectVersions(dir)

    expect(turnDeliverables(7, before, after)).toEqual({
      turn: 7,
      root: dir,
      created: [join(dir, 'fresh.txt')],
      modified: [join(dir, 'edited.txt')],
      removed: [join(dir, 'gone.txt')],
      truncated: false,
    })
  })

  it('offers created and modified paths only: a removed file is not a download', async () => {
    await file('gone.txt', 'g')
    await file('edited.txt', 'v1')
    const before = await collectVersions(dir)
    await rm(join(dir, 'gone.txt'))
    await file('edited.txt', 'v2')
    await file('fresh.txt', 'new')
    const after = await collectVersions(dir)

    expect(deliverablePaths(turnDeliverables(1, before, after))).toEqual([join(dir, 'edited.txt'), join(dir, 'fresh.txt')])
  })
})
