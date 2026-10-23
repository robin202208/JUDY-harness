/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-turn-deliverables`.
 * @module @deepseek-ai/dsh-turn-deliverables/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-turn-deliverables'

/** Cordis companion plugin name. */
export const name = 'turn-deliverables-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Whether `candidate` is `root` itself or sits below it, on either separator. */
function underRoot(root: string, candidate: string): boolean {
  if (!candidate.startsWith(root)) return false
  const rest = candidate.slice(root.length)
  return rest === '' || rest.startsWith('/') || rest.startsWith('\\')
}

/**
 * The first path in one published set that is not inside the workspace, if any.
 *
 * Every published path is absolute and must sit below the payload's own `root`.
 * A path outside it would let a client build a download link the files service
 * must then refuse, so the durable record itself has to be safe to render. The
 * `..` check is belt and braces: the paths are already resolved, so a surviving
 * `..` means the payload did not come from the snapshot path.
 * @param event - one committed session event.
 * @returns the offending path, or undefined when the event is unrelated or safe.
 */
export function escapingDeliverablePath(event: SessionEvent): string | undefined {
  if (event.type !== 'turn/deliverables') return undefined
  const { root } = event.data
  for (const path of [...event.data.created, ...event.data.modified, ...event.data.removed]) {
    if (!underRoot(root, path) || path.split(/[\\/]/).includes('..')) return path
  }
  return undefined
}

/**
 * Assert every committed deliverables set is workspace-relative.
 * @param ctx - Cordis context carrying the session event stream.
 * @param fail - the invariant service's fail sink.
 */
export const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (_session, event) => {
    const path = escapingDeliverablePath(event)
    if (path !== undefined) fail(`turn/deliverables path must be inside the workspace root: ${path}`)
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
