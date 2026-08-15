import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'JUDY',
    short_name: 'JUDY',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.png',
      sizes: 'any',
      type: 'image/png',
      purpose: 'any',
    }],
  })
})

it('ships a PNG favicon', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.png'))
  expect(favicon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
})
