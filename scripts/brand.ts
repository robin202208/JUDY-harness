#!/usr/bin/env node
/**
 * Mechanical brand rewrite for the fork's package manifests, kept idempotent so an
 * upstream merge never has to re-apply it by hand.
 *
 * The fork's 234 manifests differ from upstream in two or three fields only
 * (`description`, `repository.url`, optionally `version`). Editing them by hand means
 * re-editing them after every upstream release and colliding in every merge; rewriting
 * them from a script means a sync is "merge upstream, then run this".
 *
 * Field-level text substitution, never parse/stringify: the upstream indentation and key
 * order survive, so the diff is exactly the lines that changed.
 *
 * Usage:
 *   pnpm exec tsx scripts/brand.ts             # rewrite in place
 *   pnpm exec tsx scripts/brand.ts --dry-run   # report only
 *   pnpm exec tsx scripts/brand.ts --check     # exit 1 when anything needs rewriting (CI)
 *   pnpm exec tsx scripts/brand.ts --text      # also sweep product names in prose (off by default)
 *
 * Environment:
 *   JUDY_VERSION   force one version everywhere; unset keeps the upstream version, which is
 *                  what you want: the manifest then says which upstream release we track.
 *
 * @module scripts/brand
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Repository URL every fork manifest points at. */
export const JUDY_REPO = 'git+https://github.com/robin202208/JUDY-harness.git'

const UPSTREAM_REPOSITORY = /("(?:url|repository)"\s*:\s*")git\+https:\/\/github\.com\/deepseek-ai\/deepseek-harness(?:\.git)?(")/
const UPSTREAM_DESCRIPTION = /("description"\s*:\s*")([^"]*?)(\s+for the DeepSeek Harness)([^"]*)(")/
const VERSION_FIELD = /(^\s*"version"\s*:\s*")([^"]+)(")/m

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'build', '.pnpm', 'coverage', '.turbo'])

/** How many times each rule fired while rewriting one text. */
export interface BrandChanges {
  description: number
  repository: number
  version: number
}

/** Options for {@link brandManifestText}. */
export interface BrandManifestOptions {
  /** Force this version into the manifest; empty keeps the upstream version. */
  version?: string
}

/** Rules that fired, aggregated over the whole tree. */
export interface BrandStats extends BrandChanges {
  files: number
  prose: number
}

/** Options for {@link brandTree}. */
export interface BrandTreeOptions {
  /** Report without writing. */
  dryRun?: boolean
  /** Also rewrite product names in prose files. */
  prose?: boolean
  /** Force this version into every manifest. */
  version?: string
}

/**
 * Rewrite one manifest's source text.
 * @param raw - `package.json` source text.
 * @param options - version override, if any.
 * @returns the rewritten text and the per-rule hit counts; identical text when nothing matched.
 */
export function brandManifestText(raw: string, options: BrandManifestOptions = {}): { text: string; changes: BrandChanges } {
  const version = options.version ?? ''
  const changes: BrandChanges = { description: 0, repository: 0, version: 0 }
  let text = raw

  text = text.replace(UPSTREAM_DESCRIPTION, (_match: string, open: string, head: string, _phrase: string, tail: string, close: string) => {
    changes.description++
    return `${open}${head} for the JUDY${tail}${close}`
  })

  text = text.replace(UPSTREAM_REPOSITORY, (_match: string, open: string, close: string) => {
    changes.repository++
    return `${open}${JUDY_REPO}${close}`
  })

  if (version !== '') {
    text = text.replace(VERSION_FIELD, (match: string, open: string, current: string, close: string) => {
      if (current === version) return match
      changes.version++
      return `${open}${version}${close}`
    })
  }

  return { text, changes }
}

/**
 * Replace product names in prose. Separate from manifests because technical documents
 * legitimately name the upstream project.
 * @param raw - source text.
 * @returns text with upstream product names replaced.
 */
export function brandProseText(raw: string): string {
  return raw
    .replace(/\bDeepSeek Harness\b/g, 'JUDY')
    .replace(/\bdeepseek-harness\b/g, 'JUDY-harness')
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

/**
 * Rewrite every manifest (and optionally prose file) under a root.
 * @param root - repository root.
 * @param options - dry-run, prose sweep, and version override.
 * @returns aggregated stats and the changed paths relative to `root`.
 */
export function brandTree(root: string, options: BrandTreeOptions = {}): { stats: BrandStats; changed: string[] } {
  const { dryRun = false, prose = false, version = '' } = options
  const stats: BrandStats = { files: 0, description: 0, repository: 0, version: 0, prose: 0 }
  const changed: string[] = []

  for (const path of walk(root)) {
    const isManifest = path.endsWith('package.json')
    const isProse = prose && /\.(md|i18n\.yaml|ts|tsx)$/.test(path) && !/CHANGELOG/.test(path)
    if (!isManifest && !isProse) continue

    const raw = readFileSync(path, 'utf8')
    let text = raw
    if (isManifest) {
      const result = brandManifestText(raw, { version })
      text = result.text
      stats.description += result.changes.description
      stats.repository += result.changes.repository
      stats.version += result.changes.version
    }
    if (isProse) {
      const next = brandProseText(text)
      if (next !== text) stats.prose++
      text = next
    }
    if (text === raw) continue

    stats.files++
    changed.push(relative(root, path))
    if (!dryRun) writeFileSync(path, text)
  }

  return { stats, changed }
}

function main(): void {
  const argv = new Set(process.argv.slice(2))
  const check = argv.has('--check')
  const dryRun = check || argv.has('--dry-run')
  const prose = argv.has('--text')
  const version = process.env.JUDY_VERSION ?? ''
  const root = join(import.meta.dirname, '..')

  const { stats, changed } = brandTree(root, { dryRun, prose, version })
  const mode = check ? 'check' : dryRun ? 'dry-run' : 'write'

  console.log(`brand [${mode}] files=${stats.files}`)
  console.log(`  description rewritten: ${stats.description}`)
  console.log(`  repository  rewritten: ${stats.repository}`)
  if (version !== '') console.log(`  version → ${version}: ${stats.version}`)
  if (prose) console.log(`  prose names rewritten: ${stats.prose}`)
  if (dryRun && changed.length > 0) {
    console.log('  files needing a rewrite (first 10):')
    for (const file of changed.slice(0, 10)) console.log(`    ${file}`)
  }
  if (check && stats.files > 0) {
    console.error(`\n[x] ${stats.files} file(s) need branding: run pnpm exec tsx scripts/brand.ts`)
    process.exit(1)
  }
}

// 与 scripts/contracts.ts 同款入口判断：只有当本文件就是被 node/tsx 直接执行的那个时才跑 CLI，
// 被 spec import 时不执行（否则 vitest 里会顺带跑一遍全仓改写）。
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
