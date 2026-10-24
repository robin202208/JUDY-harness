/**
 * Simple-mode toggle: a quiet text button that hides the technical chips in
 * the composer bar.
 *
 * The flag lives in localStorage (`judy.ui.simple`, default on) and is applied
 * as `data-judy-simple` on <html>; this plugin's stylesheet hides
 * `[data-judy-chip]` while it is set, so no component here needs to know about
 * the chips themselves.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './SimpleModeToggle.module.css'

/** localStorage key of the browser-local preference. */
const KEY = 'judy.ui.simple'

/** Attribute carrying the flag on <html>; the stylesheet keys off its presence. */
const FLAG = 'data-judy-simple'

/** Read the stored preference (default: simple). */
export function isSimple(): boolean {
  try {
    return (localStorage.getItem(KEY) ?? '1') === '1'
  } catch (_error: unknown) {
    // Unavailable browser storage leaves the default in force.
    return true
  }
}

/** Apply the stored preference to the document element. */
export function applySimpleFlag(): void {
  document.documentElement.toggleAttribute(FLAG, isSimple())
}

/** Full props of the simple-mode toggle: the slot seats plus its dictionary. */
export type SimpleModeToggleProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<typeof NS>

/**
 * Render the toggle.
 * @param props - Slot runtime seat and the `simple-mode` dictionary.
 * @returns the button switching between simple and advanced.
 */
export function SimpleModeToggle({ t }: SimpleModeToggleProps) {
  const [simple, setSimple] = useState(isSimple)

  const toggle = (): void => {
    const next = !simple
    setSimple(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch (_error: unknown) {
      // Private mode: the toggle still works for this page.
    }
    document.documentElement.toggleAttribute(FLAG, next)
  }

  return (
    <button
      type="button"
      className={css.toggle}
      onClick={toggle}
      title={simple ? t('toggle.title.simple') : t('toggle.title.advanced')}
    >
      {simple ? t('toggle.showAdvanced') : t('toggle.hideAdvanced')}
    </button>
  )
}
