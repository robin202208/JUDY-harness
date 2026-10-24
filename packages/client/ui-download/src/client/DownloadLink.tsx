/** Composer entry to the workspace file browser served by the login gateway. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './DownloadLink.module.css'

/** Full props of the composer download entry: the slot seats plus its dictionary. */
export type DownloadLinkProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<typeof NS>

/**
 * Render the download entry as a new-tab link to the gateway file browser.
 * @param props - Slot runtime seat and the `download` dictionary.
 * @returns the composer pill linking to `/files/`.
 */
export function DownloadLink({ t }: DownloadLinkProps) {
  return (
    <a
      className={css.entry}
      href="/files/"
      target="_blank"
      rel="noopener"
      title={t('entry.title')}
      aria-label={t('entry.aria')}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12" />
        <path d="m7 11 5 5 5-5" />
        <path d="M4 21h16" />
      </svg>
      <span>{t('entry.label')}</span>
    </a>
  )
}
