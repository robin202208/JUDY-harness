/**
 * "IP 打造" studio on the plugin page: the three prompts that carry a person
 * from positioning to a shootable script, plus the next rows we plan. The
 * prototype's action is copy-then-paste; starting the session in place is the
 * next wiring step, so no button here pretends to create one.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { IP_TASKS, IP_UPCOMING } from './ip-studio.ts'
import type { Translate } from './presentation.ts'
import css from './IpStudio.module.css'

/** Clipboard write with a selection fallback for non-secure or denying origins. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

/**
 * Render the studio section.
 * @param props.t - the plugin page's locale seat.
 * @returns the studio section.
 */
export function IpStudio({ t }: { t: Translate }): ReactNode {
  const [openId, setOpenId] = useState<string | undefined>(undefined)
  const [copiedId, setCopiedId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (copiedId === undefined) return
    const timer = window.setTimeout(() => { setCopiedId(undefined) }, 2000)
    return () => { window.clearTimeout(timer) }
  }, [copiedId])

  return (
    <section className={css.section} data-ip-studio>
      <header className={css.head}>
        <div className={css.headText}>
          <div className={css.titleRow}>
            <h3 className={css.title}>{t('ip.title')}</h3>
            <span className={css.badge}>{t('ip.badge')}</span>
          </div>
          <p className={css.intro}>{t('ip.intro')}</p>
        </div>
        <p className={css.howto}>{t('ip.howto')}</p>
      </header>

      <ul className={css.grid}>
        {IP_TASKS.map((task, index) => (
          <li key={task.id} className={css.card} data-ip-task={task.id}>
            <div className={css.cardHead}>
              <span className={css.index}>{index + 1}</span>
              <div className={css.cardTitleRow}>
                <span className={css.cardTitle}>{t(task.titleKey)}</span>
                <span className={css.minutes}>{t('ip.minutes', { min: String(task.minutes) })}</span>
              </div>
            </div>
            <p className={css.desc}>{t(task.descKey)}</p>
            <p className={css.output}>{t('ip.output', { text: t(task.outputKey) })}</p>
            <div className={css.actions}>
              <button
                type="button"
                className={css.linkButton}
                onClick={() => { setOpenId(openId === task.id ? undefined : task.id) }}
                aria-expanded={openId === task.id}
              >
                {openId === task.id ? t('ip.hidePrompt') : t('ip.showPrompt')}
              </button>
              <button
                type="button"
                className={css.copyButton}
                onClick={() => { void copyText(task.prompt).then((ok) => { if (ok) setCopiedId(task.id) }) }}
              >
                {copiedId === task.id ? t('ip.copied') : t('ip.copy')}
              </button>
            </div>
            {openId === task.id && (
              <pre className={css.prompt} aria-label={t('ip.showPrompt')}>{task.prompt}</pre>
            )}
          </li>
        ))}
      </ul>

      <div className={css.upcoming}>
        <span className={css.upcomingLabel}>{t('ip.soon')}</span>
        {IP_UPCOMING.map(item => (
          <span key={item.id} className={css.upcomingChip}>{t(item.key)}</span>
        ))}
      </div>
    </section>
  )
}
