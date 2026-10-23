/**
 * Snapshot the upstream contract surface DSH exposes to a downstream fork, and
 * diff two snapshots into an upgrade report.
 *
 * The point is to answer "what did upstream change that I depend on?" *before*
 * rebasing, from either a source checkout or an installed app — no build needed.
 *
 * Wire format (stable key order, so snapshots diff cleanly):
 *   packages       every @deepseek-ai/* name -> version
 *   clientModules  packages declaring `dsh.client`, with their inject edges
 *   bundlePatches  packages declaring `dsh.bundle.patch`
 *   rowIds         every Loader row id a profile can target from a patch layer
 *   slots          every UI slot name a client bundle registers or renders
 *   envVars        every `process.env.DSH_*` read in shipped code
 *
 * @module scripts/contracts
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

export interface Snapshot {
  schemaVersion: 1
  source: { kind: 'asar' | 'repo'; path: string; version: string; capturedAt: string }
  packages: Record<string, string>
  clientModules: Array<{ name: string; inject: string[]; platform: string }>
  bundlePatches: Record<string, string[]>
  rowIds: string[]
  slots: string[]
  envVars: string[]
}

/** Deterministic JSON: sorted keys at every level the snapshot defines. */
function stableSnapshot(snapshot: Snapshot): Snapshot {
  const sortRecord = (record: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
  return {
    schemaVersion: 1,
    source: snapshot.source,
    packages: sortRecord(snapshot.packages),
    clientModules: [...snapshot.clientModules].sort((a, b) => a.name.localeCompare(b.name)),
    bundlePatches: Object.fromEntries(
      Object.entries(snapshot.bundlePatches)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, files]) => [name, [...files].sort()]),
    ),
    rowIds: [...new Set(snapshot.rowIds)].sort(),
    slots: [...new Set(snapshot.slots)].sort(),
    envVars: [...new Set(snapshot.envVars)].sort(),
  }
}

// ---------------------------------------------------------------- asar source

interface AsarEntry { offset: string; size: number; files?: Record<string, AsarEntry> }

/** One package manifest, as much of it as the contract surface inspects. */
interface PackageManifest {
  name: string
  version: string
  private?: boolean
  dsh?: {
    client?: { inject?: string[]; platform?: string }
    bundle?: { patch?: string | string[] }
  }
}

/** First capture group of every match; a pattern without one contributes nothing. */
function captureGroups(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].flatMap(match => match[1] === undefined ? [] : [match[1]])
}

interface AsarReader {
  read(path: string): Buffer
  list(prefix: string): string[]
  isDir(path: string): boolean
}

/** Open an `app.asar` and expose `read(path)` over its virtual filesystem. */
function openAsar(path: string): AsarReader {
  const handle = readFileSync(path)
  // asar layout: 16 bytes of pickle framing, then the JSON directory whose exact
  // byte length sits at offset 12, then the file payloads on the next 4-byte
  // boundary. Sizes in the directory include per-file alignment padding.
  const jsonLength = handle.readUInt32LE(12)
  const raw = handle.subarray(16, 16 + jsonLength).toString('utf8')
  const header = JSON.parse(raw) as { files: Record<string, AsarEntry> }
  const base = 16 + Math.ceil(jsonLength / 4) * 4

  const entryOf = (virtualPath: string): AsarEntry | undefined => {
    let node: AsarEntry | undefined = { offset: '0', size: 0, files: header.files }
    for (const part of virtualPath.split('/').filter(part => part !== '' && part !== '.')) {
      if (node === undefined) return undefined
      node = node.files?.[part]
    }
    return node
  }

  return {
    read(virtualPath: string): Buffer {
      const entry = entryOf(virtualPath)
      if (entry === undefined || entry.files !== undefined) throw new Error(`asar: not a file: ${virtualPath}`)
      return handle.subarray(base + Number(entry.offset), base + Number(entry.offset) + entry.size)
    },
    list(prefix: string): string[] {
      const entry = entryOf(prefix)
      return entry?.files === undefined ? [] : Object.keys(entry.files)
    },
    isDir(virtualPath: string): boolean {
      return entryOf(virtualPath)?.files !== undefined
    },
  }
}

function listFilesRecursively(asar: AsarReader, prefix: string, filter: (path: string) => boolean): string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    for (const name of asar.list(directory)) {
      const child = `${directory}/${name}`
      if (asar.isDir(child)) walk(child)
      else if (filter(child)) found.push(child)
    }
  }
  walk(prefix)
  return found
}

function snapshotFromAsar(asarPath: string): Snapshot {
  const asar = openAsar(asarPath)
  const runtime = JSON.parse(asar.read('/dsh/package.json').toString('utf8')) as {
    version: string
    dependencies: Record<string, string>
  }

  const packages: Record<string, string> = {}
  const clientModules: Snapshot['clientModules'] = []
  const bundlePatches: Record<string, string[]> = {}
  const patchFiles: string[] = []

  for (const name of asar.list('/dsh/node_modules/@deepseek-ai')) {
    let manifest: PackageManifest
    try {
      manifest = JSON.parse(asar.read(`/dsh/node_modules/@deepseek-ai/${name}/package.json`).toString('utf8')) as PackageManifest
    }
    catch {
      continue
    }
    packages[manifest.name] = manifest.version
    const client = manifest.dsh?.client
    if (client !== undefined) {
      clientModules.push({
        name: manifest.name,
        inject: [...(client.inject ?? [])].sort(),
        platform: client.platform ?? 'unknown',
      })
    }
    const patch = manifest.dsh?.bundle?.patch
    if (patch !== undefined) {
      const files = Array.isArray(patch) ? patch : [patch]
      bundlePatches[manifest.name] = files
      for (const file of files) patchFiles.push(`/dsh/node_modules/@deepseek-ai/${name}/${file}`)
    }
  }

  // Row ids come from the bundle patch layers; they are the only stable handle a
  // downstream profile has for overriding upstream configuration.
  const rowIds: string[] = []
  for (const patchFile of patchFiles) {
    const source = asar.read(patchFile).toString('utf8')
    for (const id of captureGroups(source, /^\s*-\s+id:\s*['"]?([\w.-]+)['"]?/gm)) rowIds.push(id)
  }

  // Slots: declared in a children map, or rendered through renderSlot().
  const slots: string[] = []
  const envVars: string[] = []
  const shellFiles = ['/lib/main.js', '/lib/preload-app.cjs', '/lib/preload-welcome.cjs']
    .concat(listFilesRecursively(asar, '/lib', path => /\.(?:js|cjs)$/.test(path)))
  const clientFiles = listFilesRecursively(asar, '/dsh/node_modules/@deepseek-ai', path => /\/lib\/.*\.js$/.test(path))
    .concat(shellFiles)
  for (const file of clientFiles) {
    const source = asar.read(file).toString('utf8')
    for (const slot of captureGroups(source, /renderSlot\(\s*"([^"]+)"/g)) slots.push(slot)
    for (const slot of captureGroups(source, /"([a-z][\w-]*(?:\.[\w-]+)+)"\s*:\s*\{\s*kind:/g)) slots.push(slot)
    for (const name of captureGroups(source, /process\.env(?:\.|\[\s*['"])(DSH_[A-Z0-9_]+)/g)) envVars.push(name)
  }

  return stableSnapshot({
    schemaVersion: 1,
    source: { kind: 'asar', path: asarPath, version: runtime.version, capturedAt: new Date().toISOString() },
    packages,
    clientModules,
    bundlePatches,
    rowIds,
    slots,
    envVars,
  })
}

// ---------------------------------------------------------------- repo source

function walkRepo(directory: string, filter: (path: string) => boolean): string[] {
  const found: string[] = []
  const walk = (current: string): void => {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (filter(absolute)) found.push(absolute)
    }
  }
  walk(directory)
  return found
}

function snapshotFromRepo(repo: string): Snapshot {
  const manifests = walkRepo(repo, path => /(?:^|\/)(?:package)\.json$/.test(path) && !path.includes('/vendor/'))
  const packages: Record<string, string> = {}
  const clientModules: Snapshot['clientModules'] = []
  const bundlePatches: Record<string, string[]> = {}
  const patchFiles: string[] = []
  let version = '0.0.0'

  for (const manifestPath of manifests) {
    let manifest: Partial<PackageManifest>
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<PackageManifest>
    }
    catch {
      continue
    }
    if (manifest.name === undefined || manifest.version === undefined) continue
    if (!manifest.name.startsWith('@deepseek-ai/') && !manifest.name.startsWith('@judy/')) continue
    packages[manifest.name] = manifest.version
    if (relative(repo, manifestPath) === 'package.json') version = manifest.version

    const client = manifest.dsh?.client
    if (client !== undefined) {
      clientModules.push({ name: manifest.name, inject: [...(client.inject ?? [])].sort(), platform: client.platform ?? 'unknown' })
    }
    const patch = manifest.dsh?.bundle?.patch
    if (patch !== undefined) {
      const files = Array.isArray(patch) ? patch : [patch]
      bundlePatches[manifest.name] = files
      for (const file of files) patchFiles.push(join(dirname(manifestPath), file))
    }
  }

  const rowIds: string[] = []
  for (const patchFile of patchFiles) {
    if (!existsSync(patchFile)) continue
    for (const id of captureGroups(readFileSync(patchFile, 'utf8'), /^\s*-\s+id:\s*['"]?([\w.-]+)['"]?/gm)) rowIds.push(id)
  }

  const slots: string[] = []
  const envVars: string[] = []
  for (const file of walkRepo(repo, path => /\/lib\/client\.js$/.test(path) || /\/lib\/index\.js$/.test(path))) {
    const source = readFileSync(file, 'utf8')
    for (const slot of captureGroups(source, /renderSlot\(\s*"([^"]+)"/g)) slots.push(slot)
    for (const slot of captureGroups(source, /"([a-z][\w-]*(?:\.[\w-]+)+)"\s*:\s*\{\s*kind:/g)) slots.push(slot)
    for (const name of captureGroups(source, /process\.env(?:\.|\[\s*['"])(DSH_[A-Z0-9_]+)/g)) envVars.push(name)
  }

  return stableSnapshot({
    schemaVersion: 1,
    source: { kind: 'repo', path: repo, version, capturedAt: new Date().toISOString() },
    packages,
    clientModules,
    bundlePatches,
    rowIds,
    slots,
    envVars,
  })
}

// ---------------------------------------------------------------- diff

type Severity = 'breaking' | 'warning' | 'info'

export interface Change { severity: Severity; area: string; detail: string }

/** Compare two snapshots and classify each difference by upgrade risk. */
export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = []

  const compareList = (area: string, left: string[], right: string[], severity: Severity): void => {
    for (const item of left) if (!right.includes(item)) changes.push({ severity, area, detail: `removed ${item}` })
    for (const item of right) if (!left.includes(item)) changes.push({ severity: 'info', area, detail: `added ${item}` })
  }

  // A removed slot or row id silently breaks a downstream override; a removed
  // package breaks resolution. Additions are only opportunities.
  compareList('slot', before.slots, after.slots, 'breaking')
  compareList('row id', before.rowIds, after.rowIds, 'breaking')
  compareList('env var', before.envVars, after.envVars, 'warning')
  compareList(
    'client module',
    before.clientModules.map(module => module.name),
    after.clientModules.map(module => module.name),
    'breaking',
  )

  for (const [name, version] of Object.entries(before.packages)) {
    const next = after.packages[name]
    if (next === undefined) changes.push({ severity: 'breaking', area: 'package', detail: `removed ${name}@${version}` })
    else if (next !== version) changes.push({ severity: 'info', area: 'package', detail: `${name} ${version} -> ${next}` })
  }
  for (const name of Object.keys(after.packages)) {
    if (before.packages[name] === undefined) changes.push({ severity: 'info', area: 'package', detail: `added ${name}@${after.packages[name]}` })
  }

  const modulesBefore = new Map(before.clientModules.map(module => [module.name, module.inject]))
  for (const module of after.clientModules) {
    const previous = modulesBefore.get(module.name)
    if (previous === undefined) continue
    const gained = module.inject.filter(item => !previous.includes(item))
    const lost = previous.filter(item => !module.inject.includes(item))
    if (gained.length > 0) changes.push({ severity: 'info', area: 'inject', detail: `${module.name} +${gained.join(', ')}` })
    if (lost.length > 0) changes.push({ severity: 'breaking', area: 'inject', detail: `${module.name} -${lost.join(', ')}` })
  }

  for (const [name, files] of Object.entries(before.bundlePatches)) {
    const next = after.bundlePatches[name]
    if (next === undefined) changes.push({ severity: 'breaking', area: 'bundle patch', detail: `removed ${name}` })
    else if (next.join(',') !== files.join(',')) changes.push({ severity: 'warning', area: 'bundle patch', detail: `${name}: ${files.join(',')} -> ${next.join(',')}` })
  }

  return changes
}

/** Render a diff as the markdown report an upgrade PR attaches. */
export function renderReport(before: Snapshot, after: Snapshot, changes: Change[]): string {
  const order: Severity[] = ['breaking', 'warning', 'info']
  const label: Record<Severity, string> = { breaking: '必须处理', warning: '需要确认', info: '了解即可' }
  const counts = order.map(severity => `${label[severity]} ${String(changes.filter(change => change.severity === severity).length)}`)
  const lines = [
    `# 契约体检：${before.source.version} → ${after.source.version}`,
    '',
    `- 基线：${before.source.kind} \`${before.source.path}\`（${before.source.capturedAt}）`,
    `- 目标：${after.source.kind} \`${after.source.path}\`（${after.source.capturedAt}）`,
    `- 结论：${changes.length === 0 ? '契约无变化' : counts.join(' · ')}`,
    '',
  ]

  for (const severity of order) {
    const rows = changes.filter(change => change.severity === severity)
    if (rows.length === 0) continue
    lines.push(`## ${label[severity]}（${String(rows.length)}）`, '')
    const areas = [...new Set(rows.map(row => row.area))]
    for (const area of areas) {
      lines.push(`**${area}**`, '')
      for (const row of rows.filter(change => change.area === area)) lines.push(`- ${row.detail}`)
      lines.push('')
    }
  }

  if (changes.length === 0) lines.push('没有发现契约变化。仍然要跑一次构建与 smoke —— 契约没变不代表行为没变。')
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------- cli

function parseSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

function usage(): never {
  process.stderr.write(`contracts — snapshot and diff the upstream contract surface

  node scripts/contracts.ts snapshot --asar <app.asar> --out contracts/<name>.json
  node scripts/contracts.ts snapshot --repo . --out contracts/<name>.json
  node scripts/contracts.ts diff <before.json> <after.json> [--fail-on breaking|warning|none]

Exit codes: 0 no change at the chosen level, 1 changes at that level, 2 usage error.
`)
  process.exit(2)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const [command, ...rest] = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(name)
    return index < 0 ? undefined : rest[index + 1]
  }

  if (command === 'snapshot') {
    const asar = flag('--asar')
    const repo = flag('--repo')
    const out = flag('--out') ?? join(ROOT, 'contracts', 'snapshot.json')
    if (asar === undefined && repo === undefined) usage()
    let snapshot: Snapshot
    if (asar !== undefined) snapshot = snapshotFromAsar(resolve(ROOT, asar))
    else if (repo !== undefined) snapshot = snapshotFromRepo(resolve(ROOT, repo))
    else usage()
    if (snapshot.source.kind === 'repo' && snapshot.slots.length === 0) {
      process.stderr.write(
        'contracts: no built lib/client.js in this tree, so slots and env vars were not captured.\n'
        + '  Run `pnpm run build` first, or snapshot an installed app.asar with --asar.\n',
      )
    }
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`)
    process.stdout.write(
      `contracts: ${snapshot.source.version} -> ${out}\n`
      + `  ${String(Object.keys(snapshot.packages).length)} packages, ${String(snapshot.clientModules.length)} client modules, `
      + `${String(snapshot.rowIds.length)} row ids, ${String(snapshot.slots.length)} slots, ${String(snapshot.envVars.length)} env vars\n`,
    )
    process.exit(0)
  }

  if (command === 'diff') {
    const positional = rest.filter(argument => !argument.startsWith('--') && argument !== flag('--fail-on'))
    const beforePath = positional[0]
    const afterPath = positional[1]
    if (beforePath === undefined || afterPath === undefined) usage()
    const before = parseSnapshot(resolve(ROOT, beforePath))
    const after = parseSnapshot(resolve(ROOT, afterPath))
    const changes = diffSnapshots(before, after)
    const report = renderReport(before, after, changes)
    const outIndex = rest.indexOf('--out')
    const outPath = rest[outIndex + 1]
    if (outIndex >= 0 && outPath !== undefined) writeFileSync(resolve(ROOT, outPath), report)
    process.stdout.write(report)

    const failOn = flag('--fail-on') ?? 'breaking'
    const breaking = changes.filter(change => change.severity === 'breaking').length
    const warning = changes.filter(change => change.severity === 'warning').length
    const fail = failOn === 'breaking' ? breaking > 0 : failOn === 'warning' ? breaking + warning > 0 : false
    process.exit(fail ? 1 : 0)
  }

  usage()
}

/** Exposed for the upgrade orchestrator and tests. */
export { snapshotFromAsar, snapshotFromRepo, stableSnapshot }
export function captureSnapshot(options: { asar?: string; repo?: string; root?: string }): Snapshot {
  const root = options.root ?? ROOT
  if (options.asar !== undefined) return snapshotFromAsar(resolve(root, options.asar))
  if (options.repo !== undefined) return snapshotFromRepo(resolve(root, options.repo))
  throw new Error('captureSnapshot needs --asar or --repo')
}

/** Read a snapshot from disk, for callers that already know it is one. */
export function readSnapshot(path: string): Snapshot {
  return parseSnapshot(resolve(ROOT, path))
}
