/**
 * The `turn/deliverables` session event: what one turn wrote, published by the
 * host at the turn boundary.
 *
 * The conversation engine's Definition contract is synchronous, so a client
 * cannot await two workspace snapshots while assembling a turn. The host can:
 * it already observes `turn/start` and `turn/end`, and it is the side that can
 * read the filesystem. This module owns the event payload and the snapshot pair
 * → payload mapping; the subscriber that drives it lives with the agent runtime.
 *
 * @module
 */
import { resolve } from 'node:path'
import type { TurnDeliverables } from '@deepseek-ai/dsh-session/types'
import { changedVersions, type VersionSnapshot } from './versions.ts'

export type { TurnDeliverables } from '@deepseek-ai/dsh-session/types'

/**
 * Build the event payload from the two snapshots bracketing a turn.
 *
 * Deletions are carried for the diff report but excluded from the usable set:
 * there is nothing to download. The union with tool-reported paths is the
 * consumer's job — it has the tool results, this module does not.
 * @param turn - the turn number being closed.
 * @param before - snapshot taken at `turn/start`.
 * @param after - snapshot taken at `turn/end`.
 * @returns the payload to append as `turn/deliverables`.
 */
export function turnDeliverables(turn: number, before: VersionSnapshot, after: VersionSnapshot): TurnDeliverables {
  const diff = changedVersions(before, after)
  // Absolute, because every other producer of a file path in this system — tool
  // `locations`, the files service, the download endpoint — speaks absolute. A
  // second unit in the same list would make the union undecidable without a
  // root lookup the client does not have.
  const absolute = (relative: string): string => resolve(after.root, relative)
  return {
    turn,
    root: after.root,
    created: diff.created.map(absolute),
    modified: diff.modified.map(absolute),
    removed: diff.removed.map(absolute),
    truncated: diff.truncated,
  }
}

/**
 * Paths a client should offer as downloads: created and modified, never removed.
 * @param deliverables - the published event payload.
 * @returns sorted absolute paths.
 */
export function deliverablePaths(deliverables: TurnDeliverables): readonly string[] {
  return [...deliverables.created, ...deliverables.modified].sort()
}
