/**
 * Composer download entry, browser half: one compact link in the composer's
 * right-hand slot that opens the workspace file browser (`/files/`).
 *
 * The file browser itself is served by the login gateway, which owns session
 * verification, so this is plain navigation — no RPC and no client state.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DownloadLink } from './DownloadLink.tsx'
import { en, NS, zh, type DownloadKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer download entry's copy. */
    download: DownloadKey
  }
}

export type { DownloadLinkProps } from './DownloadLink.tsx'

/** Required services: the slot registry and the dictionaries it renders. */
export const inject = ['slots', 'locale']

/**
 * Register the composer-side download entry.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-download: dictionaries')
  // The gateway serves /files/, so the entry needs no session capability of its own.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'download-files',
    order: 10,
    locale: NS,
  }, DownloadLink))
}
