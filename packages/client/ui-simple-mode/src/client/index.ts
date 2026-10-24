/**
 * Simple-mode toggle, browser half: one composer control that hides the
 * technical chips (agent preset, access mode, model) from the composer bar.
 *
 * The preference is browser-local; the chips advertise themselves with
 * `data-judy-chip`, and this plugin's stylesheet hides them while the flag is
 * on. Default is simple, so a first-time user never has to interpret them.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SimpleModeToggle, applySimpleFlag } from './SimpleModeToggle.tsx'
import { en, NS, zh, type SimpleModeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer simple-mode toggle's copy. */
    'simple-mode': SimpleModeKey
  }
}

export type { SimpleModeToggleProps } from './SimpleModeToggle.tsx'

/** Required services: the slot registry and the dictionaries it renders. */
export const inject = ['slots', 'locale']

/**
 * Restore the stored preference and register the composer toggle.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  applySimpleFlag()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-simple-mode: dictionaries')
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'simple-mode',
    order: 20,
    locale: NS,
  }, SimpleModeToggle))
}
