/**
 * Turn deliverables from workspace version snapshots.
 *
 * The client cannot derive this itself: the conversation engine's Definition
 * contract is synchronous, so a Definition cannot await two snapshots while it
 * assembles a turn. The host can — it observes `turn/start` and `turn/end`, and
 * it is the side that can walk the filesystem. This plugin pairs the two
 * snapshots and publishes the difference as one `turn/deliverables` event.
 *
 * It complements, rather than replaces, tool-reported `locations`: a shell
 * command that writes a file reports no location at all, while an editor tool
 * reports one for a file the snapshot also sees. Consumers union the two.
 *
 * Failure is never fatal: a snapshot that cannot be taken, or a session that
 * disappears mid-turn, drops the event for that turn. Losing a deliverables
 * row is a UI regression; failing the turn would be a product regression.
 *
 * @module @deepseek-ai/dsh-turn-deliverables
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { collectVersions, turnDeliverables, type VersionSnapshot } from '@deepseek-ai/dsh-workspace'

/** Cordis plugin name. */
export const name = 'turn-deliverables'

interface PendingTurn {
  /** Snapshot promise taken at `turn/start`; undefined when the walk failed. */
  readonly before: Promise<VersionSnapshot | undefined>
}

/** One snapshot attempt that never rejects: a failed walk drops the event, not the turn. */
async function attempt(root: string): Promise<VersionSnapshot | undefined> {
  try {
    return await collectVersions(root)
  } catch {
    return undefined
  }
}

/**
 * Subscribe to the session event stream and publish one `turn/deliverables`
 * event per completed turn.
 * @param ctx - Cordis context carrying the session event stream.
 */
export function apply(ctx: Context): void {
  const pending = new Map<Session, PendingTurn>()

  ctx.on('session/event', (session, event) => {
    const root = session.header.cwd
    // A session without a project cwd has no workspace to observe.
    if (root === undefined) return

    if (event.type === 'turn/start') {
      pending.set(session, { before: attempt(root) })
      return
    }
    if (event.type !== 'turn/end') return

    const started = pending.get(session)
    pending.delete(session)
    if (started === undefined) return

    // Deferred on purpose: appending while the turn/end publication is open is
    // a reentrant append, which the session refuses.
    void (async () => {
      const before = await started.before
      if (before === undefined) return
      const after = await attempt(root)
      if (after === undefined) return
      session.append('turn/deliverables', turnDeliverables(event.data.turn, before, after))
    })()
  })

  ctx.on('session/disposed', (session) => {
    pending.delete(session)
  })
}
