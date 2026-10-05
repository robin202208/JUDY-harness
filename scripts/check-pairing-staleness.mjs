#!/usr/bin/env node
/**
 * scripts/check-pairing-staleness.mjs
 *
 * 检查每个 *.i18n.yaml 记录的两个 blob hash 是否等于对应文件的当前内容，
 * 可选地用 --fix 重新记录。复现 verify-translation-pairing 的哈希那一半
 * （scripts/translation-pairing.ts 的 blobHash）。
 *
 * 零依赖。用法:
 *   node scripts/check-pairing-staleness.mjs [仓库根]
 *   node scripts/check-pairing-staleness.mjs [仓库根] --fix
 *
 * --fix 的边界（重要）：它只重算**哈希**维度，等价于
 * `pnpm run verify-translation-pairing --write` 的记录动作。
 * 它无法校验结构签名与语言切换链接——那两维需要装好依赖后跑真正的
 * `pnpm run verify-translation-pairing`。修完务必跑一次真校验。
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const FIX = argv.includes('--fix')
const ROOT = path.resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd())

/** 与 scripts/translation-pairing.ts 的 blobHash 完全一致。 */
function blobHash(content) {
  const h = createHash('sha1')
  h.update(`blob ${content.byteLength}\0`)
  h.update(content)
  return h.digest('hex')
}

const SKIP = new Set(['node_modules', '.git', 'vendor', 'dist', 'lib', 'coverage'])

function walk(dir, out = []) {
  let es
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) {
      if (e.name !== '.agents' && e.name !== '.github') continue
    }
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.i18n.yaml')) out.push(p)
  }
  return out
}

const records = walk(ROOT)
const rows = []

for (const rec of records) {
  const text = readFileSync(rec, 'utf8')
  const hashes = new Map()
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z0-9._-]+\.md):\s*([0-9a-f]{40})\s*$/.exec(line)
    if (m) hashes.set(m[1], m[2])
  }
  const dir = path.dirname(rec)
  for (const [file, recorded] of hashes) {
    const target = path.join(dir, file)
    if (!existsSync(target)) {
      rows.push({ pair: path.relative(ROOT, rec), file, status: 'MISSING', recorded, actual: '-' })
      continue
    }
    const actual = blobHash(readFileSync(target))
    rows.push({
      pair: path.relative(ROOT, rec), file,
      status: actual === recorded ? 'ok' : 'STALE',
      recorded, actual,
    })
  }
}

const stale = rows.filter((r) => r.status === 'STALE')
const missing = rows.filter((r) => r.status === 'MISSING')
const ok = rows.filter((r) => r.status === 'ok')

console.log('')
console.log('  i18n 配对记录新鲜度检查')
console.log('  ─────────────────────────────────────────────')
console.log(`  记录文件数   ${records.length}`)
console.log(`  检查条目     ${rows.length}`)
console.log(`  一致         ${ok.length}`)
console.log(`  过期 STALE   ${stale.length}`)
console.log(`  文件缺失     ${missing.length}`)
console.log('')

if (stale.length) {
  console.log('  过期的条目（这些会让 CI 的 verify-translation-pairing 报红）：')
  console.log('')
  for (const r of stale.slice(0, 40)) {
    console.log(`    ${r.file}`)
    console.log(`      记录 ${r.recorded}`)
    console.log(`      实际 ${r.actual}`)
    console.log(`      位置 ${r.pair}`)
  }
  if (stale.length > 40) console.log(`    ...还有 ${stale.length - 40} 条`)
  console.log('')
}

if (missing.length) {
  console.log('  记录存在但文件缺失：')
  for (const r of missing) console.log(`    ${r.file}  (${r.pair})`)
  console.log('')
}

// ── --fix：只重算哈希，保留注释与文件结构 ───────────────────────────────────

if (FIX && stale.length) {
  const byPair = new Map()
  for (const r of stale) {
    if (!byPair.has(r.pair)) byPair.set(r.pair, [])
    byPair.get(r.pair).push(r)
  }
  let fixed = 0
  for (const [pair, rows] of byPair) {
    const abs = path.join(ROOT, pair)
    const lines = readFileSync(abs, 'utf8').split('\n')
    for (const r of rows) {
      const idx = lines.findIndex((l) => l.startsWith(`${r.file}: `))
      if (idx === -1) continue
      lines[idx] = `${r.file}: ${r.actual}`
    }
    writeFileSync(abs, lines.join('\n'))
    fixed += rows.length
    console.log(`  ✓ 已重新记录 ${pair}（${rows.length} 条）`)
  }
  console.log('')
  console.log(`  共更新 ${fixed} 条、${byPair.size} 个记录文件。`)
  console.log('')
  console.log('  ⚠️  只修了哈希维度。请务必再跑真正的校验确认结构签名：')
  console.log('      pnpm install && pnpm run verify-translation-pairing')
  console.log('')
  process.exit(0)
}

process.exit(stale.length || missing.length ? 1 : 0)
