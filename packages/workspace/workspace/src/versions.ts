/**
 * Turn-scoped file version snapshots for a workspace root.
 *
 * The deliverables surface needs "which files did this turn write" without
 * asking the tool that wrote them: a shell command, a Python script, and an
 * editor patch all land in the same place on disk, and only the filesystem
 * knows about all three. A snapshot is a cheap `stat` walk (no file reads), and
 * two snapshots diff by version token, whose dev/ino/size/mtimeNs/ctimeNs
 * tuple changes even for a same-size rewrite.
 *
 * It lives here, not in a filesystem provider: "what changed in this
 * workspace" is a workspace question, and the BFF that serves it must not learn
 * which provider is installed.
 *
 * @module
 */
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** One file's identity at snapshot time, keyed by workspace-relative POSIX path. */
export interface FileVersionEntry {
  /** Path relative to the snapshot root, always `/`-separated. */
  path: string
  /** Opaque version token; equal tokens mean the file did not change. */
  version: string
  /** Size in bytes at snapshot time. */
  size: number
}

/** A whole-tree version snapshot. */
export interface VersionSnapshot {
  /** Absolute root the snapshot was taken from. */
  root: string
  /** Entries keyed by relative path. */
  entries: ReadonlyMap<string, FileVersionEntry>
  /**
   * True when a cap (`maxDepth` or `maxEntries`) ended the walk early. A
   * truncated snapshot under-reports: the diff it produces is a lower bound,
   * never a statement that nothing else changed.
   */
  truncated: boolean
  /** Directories skipped because they could not be read; never fatal. */
  unreadable: number
}

/** Bounds that keep a snapshot cheap enough to take twice per turn. */
export interface CollectVersionsOptions {
  /** Directory depth below the root to walk. Default 8. */
  maxDepth?: number
  /** Stop after this many files. Default 20000. */
  maxEntries?: number
  /** Directory names skipped at every level. Defaults to the noise set. */
  ignore?: readonly string[]
  /** Cancels the walk; resolves with what was collected so far. */
  signal?: AbortSignal
}

/** Directory names a turn-scoped snapshot never descends into. */
const DEFAULT_IGNORE = ['.git', 'node_modules', '.pnpm', 'dist', 'lib', 'build', 'coverage', '.turbo'] as const

/** Rebuild the version token from a stat, matching the filesystem seam. */
function versionOf(info: {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
}

/**
 * Walk a directory tree and record one version per regular file.
 *
 * Failures degrade instead of throwing: an unreadable directory is counted and
 * skipped, and a broken entry (deleted mid-walk) is dropped. A turn-end
 * snapshot must never be the reason a reply fails.
 * @param root - absolute directory to snapshot.
 * @param options - depth/entry caps, ignored directory names, cancellation.
 * @returns the snapshot, with `truncated` set when a cap stopped the walk.
 */
export async function collectVersions(root: string, options: CollectVersionsOptions = {}): Promise<VersionSnapshot> {
  const maxDepth = options.maxDepth ?? 8
  const maxEntries = options.maxEntries ?? 20000
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE)
  const entries = new Map<string, FileVersionEntry>()
  // Two different reasons to under-report, kept apart: hitting maxDepth ends
  // one branch but must not discard the siblings already queued at an allowed
  // depth, while hitting maxEntries ends the walk outright.
  // Counters rather than booleans: the linter narrows a `let flag = false`
  // that only ever flips inside a closure to the literal `false`, and the
  // truncation decision below then reads as dead code.
  let depthLimited = 0
  let entryLimited = 0
  let unreadable = 0

  const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
    if (depth > maxDepth) {
      depthLimited++
      return
    }
    if (options.signal?.aborted === true) return
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      unreadable++
      return
    }
    for (const name of names) {
      if (entryLimited) return
      if (ignore.has(name)) continue
      const absolute = join(dir, name)
      const relativePath = prefix === '' ? name : `${prefix}/${name}`
      let info
      try {
        info = await lstat(absolute, { bigint: true })
      } catch {
        continue // raced with a delete; the next snapshot sees the truth
      }
      if (info.isDirectory()) {
        await walk(absolute, depth + 1, relativePath)
        continue
      }
      // Symlinks are recorded by their own stat, never followed: a link cycle
      // must not turn a turn-end snapshot into an infinite walk.
      if (!info.isFile() && !info.isSymbolicLink()) continue
      if (entries.size >= maxEntries) {
        entryLimited++
        return
      }
      entries.set(relativePath, { path: relativePath, version: versionOf(info), size: Number(info.size) })
    }
  }

  await walk(root, 0, '')
  return { root, entries, truncated: depthLimited > 0 || entryLimited > 0, unreadable }
}

/** What two snapshots say changed, by path. */
export interface VersionDiff {
  /** Files in `after` that `before` did not have. */
  created: string[]
  /** Files present in both whose version token moved. */
  modified: string[]
  /** Files `before` had that `after` no longer does. */
  removed: string[]
  /** True when either snapshot was truncated, so this diff is a lower bound. */
  truncated: boolean
}

/**
 * Diff two snapshots of the same root.
 * @param before - snapshot taken before the turn.
 * @param after - snapshot taken after it.
 * @returns created/modified/removed paths, each sorted, plus the truncation flag.
 */
export function changedVersions(before: VersionSnapshot, after: VersionSnapshot): VersionDiff {
  const created: string[] = []
  const modified: string[] = []
  const removed: string[] = []

  for (const [path, entry] of after.entries) {
    const previous = before.entries.get(path)
    if (previous === undefined) created.push(path)
    else if (previous.version !== entry.version) modified.push(path)
  }
  for (const path of before.entries.keys()) {
    if (!after.entries.has(path)) removed.push(path)
  }

  return {
    created: created.sort(),
    modified: modified.sort(),
    removed: removed.sort(),
    truncated: before.truncated || after.truncated,
  }
}
