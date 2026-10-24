// @vitest-environment jsdom
/**
 * The composer download entry: link markup plus its plugin halves — the
 * dictionaries and the composer-right registration, with fiber teardown
 * proving removal (HMR safety).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { DownloadLink, type DownloadLinkProps } from '../src/client/DownloadLink.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'

const SLOT = 'conversation.input.right'
const t = makeTranslate(zh)

afterEach(() => {
  cleanup()
})

/** Render the entry with the framework seats stubbed down to its dictionary. */
function renderEntry(translate: DownloadLinkProps['t'] = t) {
  return render(<DownloadLink {...({ t: translate } as DownloadLinkProps)} />)
}

/** Boot the browser half over a real slot tree that declares the composer-right list. */
async function bench() {
  const host = await SlotTestRuntime.create()
  onTestFinished(() => host.dispose())
  const locale = new LocaleRuntime(host.ctx)
  host.ctx.provide('locale', locale)
  host.slots.installLocale(locale)
  // jsdom derives the browser language, so state the asserted locale explicitly.
  locale.setLocale('zh')
  await host.declare({ [SLOT]: { kind: 'list', scope: 'session' } })
  return { host, locale }
}

describe('DownloadLink', () => {
  it('opens the workspace file browser in a new tab', () => {
    renderEntry()
    const link = screen.getByRole('link', { name: zh['entry.aria'] })
    expect(link.getAttribute('href')).toBe('/files/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener')
    expect(link.textContent).toBe(zh['entry.label'])
    expect(link.getAttribute('title')).toBe(zh['entry.title'])
  })

  it('renders the active language copy', () => {
    renderEntry(makeTranslate(en))
    const link = screen.getByRole('link', { name: en['entry.aria'] })
    expect(link.textContent).toBe(en['entry.label'])
    expect(link.getAttribute('title')).toBe(en['entry.title'])
  })
})

describe('ui-download browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the composer entry, and fiber teardown removes it (HMR safety)', async () => {
    const { host } = await bench()
    const plugin = await host.mount({ inject, apply })
    expect(host.slots.entries(SLOT).map(entry => entry.options.id)).toEqual(['download-files'])
    await plugin.dispose()
    expect(host.slots.entries(SLOT)).toHaveLength(0)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { host, locale } = await bench()
    const plugin = await host.mount({ inject, apply })
    const translate = locale.bind(NS)
    expect(translate('entry.label')).toBe(zh['entry.label'])
    locale.setLocale('en')
    expect(translate('entry.label')).toBe(en['entry.label'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await plugin.dispose()
    expect(translate('entry.label')).not.toBe(en['entry.label'])
  })
})

describe('ui-download node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
