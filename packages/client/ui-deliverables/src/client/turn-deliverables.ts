/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: the vocabulary is the mutation tools' own follow-along
 * `locations`, never the closing prose.
 */
import type {
  ConversationNodeDefinition, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, ToolResultNode['callView']>
}

/**
 * Paths a call view reports having created or changed, by render intent rather
 * than tool name: a diff card, or a generic card whose kind is `edit` (the
 * shape `str_replace_editor`'s insert presents). Every other card produces
 * nothing to open — a read looked, a delete removed, a terminal ran. Only
 * root call views enter this Turn accumulator; nested Code Mode dispatches
 * preserve the pre-assembly behavior and do not contribute independently.
 */
function producedPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? []).map(location => location.path)
  }
  return []
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the mutation tools' own follow-along `locations`, not the
 * closing prose: a produced file must be listed whether or not the model
 * remembered to name it. A mutation is recognized by render intent, not by
 * tool name — a diff card, or a generic card whose `kind` is `edit` (the shape
 * `str_replace_editor`'s insert presents) — so a new mutation tool joins by
 * declaring what it does. Reads contribute nothing (looking at a file does not
 * produce it), and neither do deletes (there is nothing left to open) or
 * failed calls. Paths keep first-seen order and appear once, so a file written
 * and then edited in the same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    // The host publishes what the filesystem saw at the turn boundary, which is
    // the only source for files a shell command wrote: those report no location.
    if (event.type === 'turn/deliverables') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        match.view?.for === 'call' ? match.view.view : null,
      )
      return { ...context.state, calls }
    }
    if (match.event.type === 'turn/deliverables') {
      // Absolute paths, the same unit tool locations use, so the union below
      // compares strings directly and a file both sources saw stays one entry.
      const additions = [...match.event.data.created, ...match.event.data.modified]
        .map(path => ({ seq: match.event.seq, path }))
      return additions.length === 0
        ? context.state
        : { ...context.state, produced: [...context.state.produced, ...additions] }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions = producedPaths(context.state.calls.get(callId) ?? null)
      .map(path => ({ seq: match.event.seq, path }))
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced },
    },
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
/** Same-origin endpoint that streams one Host file as an attachment. */
const DOWNLOAD_PREFIX = '/files/download?path='

/**
 * Build the browser download URL for one absolute Host path.
 * @param path - absolute path on the Host.
 * @returns same-origin URL the files service authorizes and serves.
 */
export function fileDownloadHref(path: string): string {
  return `${DOWNLOAD_PREFIX}${encodeURIComponent(path)}`
}

/**
 * Whether an authored token reads as an absolute file path rather than a
 * command, URL, or prose fragment. Deliberately conservative: absolute,
 * whitespace-free, and a final segment carrying an extension.
 * @param value - inline-code token exactly as authored.
 * @returns true when the token should become a download link.
 */
export function looksLikeAbsoluteFile(value: string): boolean {
  if (!value.startsWith('/') || value.length > 400) return false
  if (/\s/.test(value) || value.includes('://')) return false
  const base = value.slice(value.lastIndexOf('/') + 1)
  return base.length > 1 && base.includes('.') && !base.startsWith('.')
}

/**
 * Prose vocabulary for every assistant message: produced files first (their
 * full paths are known), then any absolute file path the model typed. Both
 * render as browser downloads; the files service enforces the allowed roots.
 * @param paths - produced file paths claimed by the closing turn (may be empty).
 * @param openFile - Host opener, kept for non-download consumers.
 * @param label - locale-bound accessible label for one path.
 * @returns resolver the chat markdown renderer consumes.
 */
export function proseFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  const produced = producedFileMentions(paths, openFile, label)
  return {
    resolve(value) {
      const hit = produced.resolve(value)
      if (hit !== undefined) return { ...hit, href: fileDownloadHref(hit.title) }
      if (!looksLikeAbsoluteFile(value)) return undefined
      return { href: fileDownloadHref(value), label: label(value), title: value }
    },
  }
}

export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = resolveProducedPath(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/**
 * Resolve a mention to one produced path. Exact path wins, then a unique
 * basename, then a unique path suffix — the last one is what lets the closing
 * prose name a file the way the writer sees it (`out/report.xlsx`) instead of
 * repeating the absolute path. Two candidates at the same level stay inert:
 * opening the wrong file is worse than opening nothing.
 * @param paths - the turn's produced paths.
 * @param value - the authored token, relative or absolute.
 * @returns the resolved path, or undefined when ambiguous or unknown.
 */
export function resolveProducedPath(paths: readonly string[], value: string): string | undefined {
  if (paths.includes(value)) return value
  const byBasename = paths.filter(path => basename(path) === value)
  if (byBasename.length === 1) return byBasename[0]
  const bySuffix = paths.filter(path => path.endsWith(`/${value}`) || path.endsWith(`\\${value}`))
  return bySuffix.length === 1 ? bySuffix[0] : undefined
}
