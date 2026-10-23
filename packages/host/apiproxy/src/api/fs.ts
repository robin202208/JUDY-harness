/**
 * fs domain contract: workspace-scoped filesystem reads that the browser UI
 * needs but must not perform itself. Addressed by session, never by path — the
 * session header's cwd resolves host-side, so a client can only observe the
 * workspace it is already attached to.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One file's identity at snapshot time, keyed by workspace-relative POSIX path. */
export interface WorkspaceFileVersion {
  /** Path relative to the session workspace, always `/`-separated. */
  readonly path: string
  /** Opaque version token; equal tokens mean the file did not change. */
  readonly version: string
  /** Size in bytes at snapshot time. */
  readonly size: number
}

/** One snapshot of the session workspace. */
export interface WorkspaceVersionListing {
  /** Absolute workspace root the snapshot was taken from. */
  readonly root: string
  /** Entries sorted by path, so two snapshots diff without extra ordering. */
  readonly entries: readonly WorkspaceFileVersion[]
  /**
   * True when a cap ended the walk early. The listing is then a lower bound:
   * a caller may not report "nothing else changed" from a truncated snapshot.
   */
  readonly truncated: boolean
  /** Directories that could not be read; skipped, never fatal. */
  readonly unreadable: number
}

/**
 * Filesystem-domain unary methods (the map key fs.* of RpcMethodMap). Reads
 * only: this domain cannot write, delete, or resolve a path outside the
 * session workspace.
 */
export interface FsApi {
  /**
   * Snapshot the session workspace as path → version, for turn-scoped
   * "what did this turn write" diffing.
   * @param request - the session whose workspace to walk, plus optional caps.
   * @param signal - cancellation; a cancelled walk answers `cancelled`.
   * @returns the snapshot; an unknown session answers `session-not-found` and
   * a session without a project cwd `fs-unavailable`, both before any walk.
   */
  listVersions(
    request: RpcRequest<{ sessionId: SessionId; maxDepth?: number; maxEntries?: number }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<WorkspaceVersionListing>>
}
