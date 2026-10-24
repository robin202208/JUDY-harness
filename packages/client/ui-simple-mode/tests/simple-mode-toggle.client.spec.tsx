// @vitest-environment jsdom
/**
 * The simple-mode toggle: preference persistence, the `<html>` flag, and the
 * plugin halves — flag restoration before the first paint plus the
 * composer-right registration, with fiber teardown proving removal.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import {
  SimpleModeToggle, applySimpleFlag, isSimple, type SimpleModeToggleProps,
} from '../src/client/SimpleModeToggle.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'

const SLOT = 'conversation.input.right'
const KEY = 'judy.ui.simple'
const FLAG = 'data-judy-simple'
const t = makeTranslate(zh)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(FLAG)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Render the toggle with the framework seats stubbed down to its dictionary. */
function renderToggle(translate: SimpleModeToggleProps['t'] = t) {
  return render(<SimpleModeToggle {...({ t: translate } as SimpleModeToggleProps)} />)
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

describe('SimpleModeToggle', () => {
  it('starts in simple mode and offers the advanced options', () => {
    expect(isSimple()).toBe(true)
    renderToggle()
    const button = screen.getByRole('button')
    expect(button.textContent).toBe(zh['toggle.showAdvanced'])
    expect(button.getAttribute('title')).toBe(zh['toggle.title.simple'])
  })

  it('toggles advanced mode through localStorage and the html flag', () => {
    renderToggle()
    fireEvent.click(screen.getByRole('button'))
    expect(localStorage.getItem(KEY)).toBe('0')
    expect(document.documentElement.hasAttribute(FLAG)).toBe(false)
    expect(screen.getByRole('button').textContent).toBe(zh['toggle.hideAdvanced'])

    fireEvent.click(screen.getByRole('button'))
    expect(localStorage.getItem(KEY)).toBe('1')
    expect(document.documentElement.hasAttribute(FLAG)).toBe(true)
    expect(screen.getByRole('button').textContent).toBe(zh['toggle.showAdvanced'])
  })

  it('restores a stored advanced preference in the active language', () => {
    localStorage.setItem(KEY, '0')
    applySimpleFlag()
    expect(document.documentElement.hasAttribute(FLAG)).toBe(false)
    renderToggle(makeTranslate(en))
    expect(screen.getByRole('button').textContent).toBe(en['toggle.hideAdvanced'])
    expect(screen.getByRole('button').getAttribute('title')).toBe(en['toggle.title.advanced'])
  })

  it('falls back to simple when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    expect(isSimple()).toBe(true)
    applySimpleFlag()
    expect(document.documentElement.hasAttribute(FLAG)).toBe(true)
  })

  it('still toggles for this page when storage rejects the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    renderToggle()
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.hasAttribute(FLAG)).toBe(false)
    expect(screen.getByRole('button').textContent).toBe(zh['toggle.hideAdvanced'])
  })
})

describe('ui-simple-mode browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('restores the flag before registering the toggle and releases both with the fiber', async () => {
    const { host, locale } = await bench()
    const plugin = await host.mount({ inject, apply })
    expect(document.documentElement.hasAttribute(FLAG)).toBe(true)
    expect(host.slots.entries(SLOT).map(entry => entry.options.id)).toEqual(['simple-mode'])

    const translate = locale.bind(NS)
    expect(translate('toggle.showAdvanced')).toBe(zh['toggle.showAdvanced'])
    locale.setLocale('en')
    expect(translate('toggle.showAdvanced')).toBe(en['toggle.showAdvanced'])

    await plugin.dispose()
    expect(host.slots.entries(SLOT)).toHaveLength(0)
    expect(translate('toggle.showAdvanced')).not.toBe(en['toggle.showAdvanced'])
  })

  it('honors a stored advanced preference on load', async () => {
    localStorage.setItem(KEY, '0')
    const { host } = await bench()
    await host.mount({ inject, apply })
    expect(document.documentElement.hasAttribute(FLAG)).toBe(false)
  })
})

describe('ui-simple-mode node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
