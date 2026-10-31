/**
 * Capability showcase on the plugin page: which office, business, industrial
 * and healthcare systems JUDY can drive today, and over which transports.
 * Static by design — the catalog advertises integration breadth, while the
 * experimental plugin list above it stays the place where connectors are
 * actually enabled.
 */
import type { ReactNode } from 'react'
import { INTEGRATION_CATEGORIES } from './integration-catalog.ts'
import type { Translate } from './presentation.ts'
import css from './IntegrationCatalog.module.css'

/** Status pill copy keys, kept out of the data so both locales share it. */
function statusLabel(t: Translate, status: 'builtin' | 'custom'): string {
  return status === 'builtin' ? t('integrations.builtin') : t('integrations.custom')
}

/**
 * Render the whole integration catalog.
 * @param props.t - the plugin page's locale seat.
 * @returns the catalog section.
 */
export function IntegrationCatalog({ t }: { t: Translate }): ReactNode {
  const systems = INTEGRATION_CATEGORIES.flatMap(category => category.systems)
  const protocolCount = new Set(systems.flatMap(system => system.protocols)).size
  return (
    <section className={css.section} data-integration-catalog>
      <header className={css.head}>
        <div className={css.headText}>
          <h3 className={css.title}>{t('integrations.title')}</h3>
          <p className={css.intro}>{t('integrations.intro')}</p>
        </div>
        <p className={css.summary}>
          {t('integrations.summary', {
            systems: String(systems.length),
            protocols: String(protocolCount),
            industries: String(INTEGRATION_CATEGORIES.length),
          })}
        </p>
      </header>
      <div className={css.legend}>
        <span><i className={css.dotBuiltin} aria-hidden="true" />{t('integrations.builtin')}</span>
        <span><i className={css.dotCustom} aria-hidden="true" />{t('integrations.custom')}</span>
      </div>
      <div className={css.categories}>
        {INTEGRATION_CATEGORIES.map(category => (
          <section key={category.key} className={css.category} data-integration-category={category.key}>
            <h4 className={css.categoryTitle}>{t(category.titleKey)}</h4>
            <ul className={css.grid}>
              {category.systems.map(system => (
                <li key={system.name} className={css.system} data-status={system.status}>
                  <div className={css.systemHead}>
                    <span className={css.systemName} title={system.name}>{system.name}</span>
                    <span className={css.status} data-status={system.status}>
                      {statusLabel(t, system.status)}
                    </span>
                  </div>
                  <p className={css.systemNote}>{system.note}</p>
                  <div className={css.tags}>
                    {system.protocols.map(protocol => (
                      <span key={protocol} className={css.tag}>{protocol}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className={css.footnote}>{t('integrations.footnote')}</p>
    </section>
  )
}
