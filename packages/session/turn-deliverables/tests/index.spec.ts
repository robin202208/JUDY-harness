/**
 * Behaviour of the turn-deliverables publisher: one snapshot at `turn/start`,
 * one at `turn/end`, one event carrying what changed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

import * as plugin from '../src/index.ts'
import { escapingDeliverablePath } from '../src/invariant.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-turn-deliverables-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** The slice of Context this plugin uses: one event subscription. */
interface Harness {
  readonly ctx: Context
  /** A function property, not a method: the spec destructures it and calls it unbound. */
  readonly emit: (name: string, ...args: unknown[]) => void
}

function harness(): Harness {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const ctx = {
    on: (name: string, handler: (...args: unknown[]) => void) => {
      handlers.set(name, handler)
      return () => {}
    },
  } as unknown as Context
  return {
    ctx,
    emit: (name, ...args) => { handlers.get(name)?.(...args) },
  }
}

interface Appended {
  readonly type: string
  readonly data: unknown
}

function sessionAt(cwd: string | undefined, appended: Appended[]): Session {
  return {
    header: cwd === undefined ? {} : { cwd },
    append: (type: string, data: unknown) => {
      appended.push({ type, data })
      return {}
    },
  } as unknown as Session
}

/** Let the deferred snapshot pair finish; the walk is async and short. */
const settle = (ms = 400): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

describe('turn deliverables publisher', () => {
  it('publishes created and modified files for a completed turn', async () => {
    const appended: Appended[] = []
    const session = sessionAt(dir, appended)
    const { ctx, emit } = harness()
    plugin.apply(ctx)

    await writeFile(join(dir, 'existing.txt'), 'v1')
    emit('session/event', session, { type: 'turn/start', data: { turn: 3 } })
    await settle(200)
    await writeFile(join(dir, 'existing.txt'), 'v2')
    await writeFile(join(dir, 'fresh.txt'), 'new')
    emit('session/event', session, { type: 'turn/end', data: { turn: 3, reason: 'done' } })
    await settle()

    expect(appended).toHaveLength(1)
    expect(appended[0]?.type).toBe('turn/deliverables')
    expect(appended[0]?.data).toMatchObject({
      turn: 3,
      root: dir,
      created: [join(dir, 'fresh.txt')],
      modified: [join(dir, 'existing.txt')],
      removed: [],
      truncated: false,
    })
  })

  it('publishes nothing for a session with no project cwd', async () => {
    const appended: Appended[] = []
    const session = sessionAt(undefined, appended)
    const { ctx, emit } = harness()
    plugin.apply(ctx)

    emit('session/event', session, { type: 'turn/start', data: { turn: 1 } })
    emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: 'done' } })
    await settle()

    expect(appended).toHaveLength(0)
  })

  it('publishes nothing when a turn ends without a start snapshot', async () => {
    const appended: Appended[] = []
    const session = sessionAt(dir, appended)
    const { ctx, emit } = harness()
    plugin.apply(ctx)

    emit('session/event', session, { type: 'turn/end', data: { turn: 2, reason: 'done' } })
    await settle()

    expect(appended).toHaveLength(0)
  })

  it('drops the pending snapshot when the session is disposed', async () => {
    const appended: Appended[] = []
    const session = sessionAt(dir, appended)
    const { ctx, emit } = harness()
    plugin.apply(ctx)

    emit('session/event', session, { type: 'turn/start', data: { turn: 1 } })
    emit('session/disposed', session)
    emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: 'done' } })
    await settle()

    expect(appended).toHaveLength(0)
  })
})

describe('deliverable path invariant', () => {
  const root = '/srv/workspace'
  const event = (created: string[]): SessionEvent => ({
    type: 'turn/deliverables',
    data: { turn: 1, root, created, modified: [], removed: [], truncated: false },
  }) as unknown as SessionEvent

  it('accepts paths below the published root', () => {
    expect(escapingDeliverablePath(event([`${root}/out/report.xlsx`, `${root}/notes.md`]))).toBeUndefined()
  })

  it('rejects a path outside the published root', () => {
    expect(escapingDeliverablePath(event(['/etc/passwd']))).toBe('/etc/passwd')
    expect(escapingDeliverablePath(event(['/srv/workspace-other/x.md']))).toBe('/srv/workspace-other/x.md')
  })

  it('rejects a relative path', () => {
    expect(escapingDeliverablePath(event(['out/report.xlsx']))).toBe('out/report.xlsx')
  })

  it('rejects a path that walks out of the workspace', () => {
    expect(escapingDeliverablePath(event([`${root}/../secrets.txt`]))).toBe(`${root}/../secrets.txt`)
  })

  it('ignores other event types', () => {
    expect(escapingDeliverablePath({ type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent)).toBeUndefined()
  })
})
