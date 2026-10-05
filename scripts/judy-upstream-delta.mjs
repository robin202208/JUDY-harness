#!/usr/bin/env node
/**
 * scripts/judy-upstream-delta.mjs
 *
 * JUDY 与上游 DeepSeek Harness 的三方对比。
 *
 * 回答三个问题：
 *   1) 哪些顶层包组是 JUDY 新增的（上游没有）？
 *   2) 哪些上游包组 JUDY 完全没有（落后缺口）？
 *   3) 共有包组里，哪些包被改过（需要决定：背补丁，还是改回外挂插件）？
 *
 * 零依赖，只用 Node 内置模块。用法：
 *
 *   node scripts/judy-upstream-delta.mjs --upstream /path/to/deepseek-harness
 *   node scripts/judy-upstream-delta.mjs --upstream ../deepseek-harness --markdown > UPSTREAM-DELTA.md
 *
 * 退出码：0 正常；2 参数或路径错误。
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

// ── 参数 ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { upstream: null, judy: process.cwd(), markdown: false, json: false, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--upstream') out.upstream = argv[++i]
    else if (a === '--judy') out.judy = argv[++i]
    else if (a === '--markdown') out.markdown = true
    else if (a === '--json') out.json = true
    else if (a === '--verbose' || a === '-v') out.verbose = true
    else if (a === '--help' || a === '-h') {
      console.log(`用法: node scripts/judy-upstream-delta.mjs --upstream <上游检出路径> [选项]

选项:
  --upstream <path>   上游 deepseek-harness 的检出目录（必填）
  --judy <path>       JUDY 仓库根目录（默认当前目录）
  --markdown          输出 Markdown（可直接重定向为 UPSTREAM-DELTA.md）
  --json              输出 JSON（供 CI 消费）
  --verbose           打印逐包明细
`)
      process.exit(0)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!args.upstream) {
  console.error('错误: 必须用 --upstream 指定上游检出路径')
  process.exit(2)
}

const UPSTREAM = path.resolve(args.upstream)
const JUDY = path.resolve(args.judy)

for (const [label, dir] of [['上游', UPSTREAM], ['JUDY', JUDY]]) {
  if (!existsSync(dir)) {
    console.error(`错误: ${label} 路径不存在: ${dir}`)
    process.exit(2)
  }
}

// ── 工具 ────────────────────────────────────────────────────────────────────

async function listDirs(dir) {
  try {
    const es = await readdir(dir, { withFileTypes: true })
    return es.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort()
  } catch {
    return []
  }
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 对目录内容做稳定哈希，跳过构建产物与依赖。
 * CODE_ONLY=true 时同时跳过 package.json —— 因为每个 fork 都会改 version /
 * repository / description，把它们算进哈希会让"代码是否相同"这个问题失真。
 */
const CODE_ONLY = process.env.DELTA_CODE_ONLY === '1'

async function hashTree(dir, rel = '') {
  const h = createHash('sha256')
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (
      e.name === 'node_modules' || e.name === 'lib' || e.name === 'dist' ||
      e.name === '.git' || e.name === 'coverage' || e.name === 'types'
    ) continue
    if (CODE_ONLY && e.name === 'package.json') continue
    if (e.isDirectory()) {
      const sub = await hashTree(path.join(dir, e.name), relPath)
      h.update(`${relPath}:dir:${sub}\n`)
    } else {
      try {
        const buf = await readFile(path.join(dir, e.name))
        h.update(`${relPath}:${createHash('sha256').update(buf).digest('hex')}\n`)
      } catch {
        h.update(`${relPath}:unreadable\n`)
      }
    }
  }
  return h.digest('hex').slice(0, 16)
}

const GROUP_ROOT = 'packages'

async function collect(root) {
  const groupDir = path.join(root, GROUP_ROOT)
  const groups = await listDirs(groupDir)
  const map = new Map() // group -> package -> signature
  for (const g of groups) {
    const pkgs = await listDirs(path.join(groupDir, g))
    const inner = new Map()
    for (const p of pkgs) {
      const dir = path.join(groupDir, g, p)
      const pj = await readJsonIfExists(path.join(dir, 'package.json'))
      const srcHash = await hashTree(path.join(dir, 'src'))
      const wholeHash = srcHash ? null : await hashTree(dir)
      inner.set(p, {
        name: pj?.name ?? null,
        version: pj?.version ?? null,
        license: pj?.license ?? null,
        hash: srcHash ?? wholeHash,
        hasSrc: Boolean(srcHash),
      })
    }
    map.set(g, inner)
  }
  return map
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const judy = await collect(JUDY)
const up = await collect(UPSTREAM)

const judyPkg = await readJsonIfExists(path.join(JUDY, 'package.json'))
const upPkg = await readJsonIfExists(path.join(UPSTREAM, 'package.json'))

const allGroups = [...new Set([...judy.keys(), ...up.keys()])].sort()

const judyOnly = []
const upstreamOnly = []
const shared = []
const changed = []
const identical = []

for (const g of allGroups) {
  const j = judy.get(g)
  const u = up.get(g)
  if (j && !u) { judyOnly.push({ group: g, packages: [...j.keys()] }); continue }
  if (!j && u) { upstreamOnly.push({ group: g, packages: [...u.keys()] }); continue }

  // 共有包组：逐包比
  const jNames = [...j.keys()].sort()
  const uNames = [...u.keys()].sort()
  const addedHere = jNames.filter((n) => !u.has(n))
  const missingHere = uNames.filter((n) => !j.has(n))
  const common = jNames.filter((n) => u.has(n))

  const changedPkgs = []
  for (const p of common) {
    const a = j.get(p)
    const b = u.get(p)
    const same = a.hash && b.hash && a.hash === b.hash
    const sameMeta = a.name === b.name && a.license === b.license
    // CODE_ONLY 模式下只看源码哈希；否则包元数据不一致也算改动。
    if (same && (CODE_ONLY || sameMeta)) identical.push(`${g}/${p}`)
    else changedPkgs.push({ pkg: p, judyHash: a.hash, upHash: b.hash, hasSrc: a.hasSrc, version: `${a.version} → ${b.version}` })
  }

  shared.push({ group: g, added: addedHere, missing: missingHere, common: common.length })
  if (changedPkgs.length || addedHere.length || missingHere.length) {
    changed.push({ group: g, changed: changedPkgs, added: addedHere, missing: missingHere })
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  judyVersion: judyPkg?.version ?? null,
  upstreamVersion: upPkg?.version ?? null,
  upstreamHash: process.env.UPSTREAM_HASH ?? null,
  groups: { judyOnly: judyOnly.length, upstreamOnly: upstreamOnly.length, shared: shared.length },
  counts: {
    judyOnlyPackages: judyOnly.reduce((n, g) => n + g.packages.length, 0),
    upstreamOnlyPackages: upstreamOnly.reduce((n, g) => n + g.packages.length, 0),
    changedPackages: changed.reduce((n, g) => n + g.changed.length, 0),
    identicalPackages: identical.length,
    addedInShared: changed.reduce((n, g) => n + g.added.length, 0),
    missingInShared: changed.reduce((n, g) => n + g.missing.length, 0),
  },
  judyOnly,
  upstreamOnly,
  changed,
}

// ── 输出 ────────────────────────────────────────────────────────────────────

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}

if (args.markdown) {
  const L = []
  L.push('# JUDY ↔ 上游 DeepSeek Harness 差异清单')
  L.push('')
  L.push(`> 本文件由 \`scripts/judy-upstream-delta.mjs\` 生成，请勿手工编辑。`)
  L.push('')
  L.push(`- 生成时间：${summary.generatedAt}`)
  L.push(`- JUDY 版本：\`${summary.judyVersion}\``)
  L.push(`- 上游版本：\`${summary.upstreamVersion}\``)
  L.push(`- 上游提交：\`${summary.upstreamHash ?? '(未注入 UPSTREAM_HASH)'}\``)
  L.push('')
  L.push('## 总览')
  L.push('')
  L.push('| 指标 | 数量 |')
  L.push('| --- | --- |')
  L.push(`| JUDY 独有包组 | ${summary.groups.judyOnly} |`)
  L.push(`| 上游独有包组（你的缺口） | ${summary.groups.upstreamOnly} |`)
  L.push(`| 共有包组 | ${summary.groups.shared} |`)
  L.push(`| 被改过的包 | ${summary.counts.changedPackages} |`)
  L.push(`| 与上游逐字节相同的包 | ${summary.counts.identicalPackages} |`)
  L.push('')

  L.push('## 1. JUDY 独有包组（你的资产，永远不跟上游合）')
  L.push('')
  if (!judyOnly.length) L.push('_无_')
  for (const g of judyOnly) L.push(`- \`${g.group}/\` — ${g.packages.length} 个包：${g.packages.map((p) => `\`${p}\``).join(', ')}`)
  L.push('')

  L.push('## 2. 上游独有包组（你的缺口，需评估是否要）')
  L.push('')
  if (!upstreamOnly.length) L.push('_无_')
  for (const g of upstreamOnly) L.push(`- \`${g.group}/\` — ${g.packages.length} 个包`)
  L.push('')

  L.push('## 3. 被改过的包（必须逐个人工决策）')
  L.push('')
  L.push('> 这些是"背补丁"成本的来源。每一项都要决定：')
  L.push('> **A** 改成外挂插件（归入第 1 类，成本永久消失）／')
  L.push('> **B** 保留为 pin 补丁（承认长期成本）／')
  L.push('> **C** 放弃改动，回到上游行为。')
  L.push('')
  if (!changed.length) L.push('_无_')
  for (const g of changed) {
    L.push(`### \`${g.group}/\``)
    L.push('')
    if (g.added.length) L.push(`- **新增于本仓**：${g.added.map((p) => `\`${p}\``).join(', ')}`)
    if (g.missing.length) L.push(`- **本仓缺失**：${g.missing.map((p) => `\`${p}\``).join(', ')}`)
    if (g.changed.length) {
      L.push('')
      L.push('| 包 | 版本 | 决策 |')
      L.push('| --- | --- | --- |')
      for (const c of g.changed) L.push(`| \`${c.pkg}\` | ${c.version} | ⬜ A / ⬜ B / ⬜ C |`)
    }
    L.push('')
  }

  L.push('## 附：与上游完全一致、可直接取上游的包')
  L.push('')
  L.push(`共 ${identical.length} 个。这些包升级时无需任何处理。`)
  // 恰好一个结尾换行：git diff --check 不接受 EOF 空行。
  process.stdout.write(`${L.join('\n').replace(/\n+$/, '')}\n`)
  process.exit(0)
}

// 终端人类可读输出
const pad = (s, n) => String(s).padEnd(n)
console.log('')
console.log('  JUDY ↔ 上游 DeepSeek Harness 差异')
console.log('  ─────────────────────────────────────────────')
console.log(`  JUDY       ${summary.judyVersion}`)
console.log(`  上游       ${summary.upstreamVersion}${summary.upstreamHash ? `  (${summary.upstreamHash.slice(0, 12)})` : ''}`)
console.log('')
console.log(`  JUDY 独有包组        ${summary.groups.judyOnly}`)
console.log(`  上游独有包组        ${summary.groups.upstreamOnly}   ← 你的缺口`)
console.log(`  共有包组            ${summary.groups.shared}`)
console.log(`  被改过的包          ${summary.counts.changedPackages}   ← 补丁成本`)
console.log(`  与上游完全一致       ${summary.counts.identicalPackages}   ← 可白拿上游`)
console.log('')

if (judyOnly.length) {
  console.log('  你的独有包组：')
  for (const g of judyOnly) console.log(`    + ${pad(g.group, 24)} ${g.packages.length} 个包`)
  console.log('')
}

if (changed.length) {
  console.log('  改动最集中的包组（按改动包数）：')
  const rank = [...changed].sort((a, b) => (b.changed.length + b.added.length + b.missing.length) - (a.changed.length + a.added.length + a.missing.length))
  for (const g of rank.slice(0, args.verbose ? rank.length : 12)) {
    const n = g.changed.length + g.added.length + g.missing.length
    console.log(`    ! ${pad(g.group, 24)} ${n} 处`)
    if (args.verbose) {
      for (const c of g.changed) console.log(`        · ${c.pkg}  ${c.version}`)
      for (const p of g.added) console.log(`        + ${p}（本仓新增）`)
      for (const p of g.missing) console.log(`        - ${p}（本仓缺失）`)
    }
  }
  console.log('')
}

console.log('  用 --markdown 生成 UPSTREAM-DELTA.md（带人工决策勾选框）')
console.log('  用 --verbose 打印逐包明细')
console.log('')
