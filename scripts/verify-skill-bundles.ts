/**
 * Enforce the on-disk skill bundle contract that `dsh-skill-filesystem` actually
 * loads, so a skill that would be dropped at discovery — or never discovered at
 * all — fails here instead of vanishing at runtime.
 *
 * Three failure classes this catches that a code review does not:
 *  - a `SKILL.md` nested deeper than `<root>/<name>/SKILL.md` is never discovered;
 *  - a missing `name`/`description`, or a non-boolean invocation flag, drops the
 *    whole skill from the catalog;
 *  - a `scripts/…` resource the body promises that is absent or does not parse.
 *
 * @module scripts/verify-skill-bundles
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { load } from 'js-yaml'

const ROOT = resolve(import.meta.dirname, '..')

/** Scanned roots, in the provider's rank order (first wins on a name clash). */
const DEFAULT_ROOTS = ['.dsh/skills', '.agents/skills', 'packages/agent/preset/skills']

/** Bundle-local directories whose references the body is allowed to promise. */
const RESOURCE_DIRECTORIES = ['scripts', 'assets', 'references', 'tools']

/** Frontmatter keys that must parse as YAML booleans when present. */
const BOOLEAN_KEYS = ['disable-model-invocation', 'user-invocable']

type Severity = 'error' | 'warning'

interface Diagnostic {
  severity: Severity
  file: string
  message: string
}

interface SkillBundle {
  /** Repository-relative path of the bundle directory or flat file. */
  path: string
  /** Absolute bundle directory (the `SKILL.md` directory, or the flat file's parent). */
  directory: string
  /** Absolute instruction file. */
  file: string
  /** Identity the catalog will use: frontmatter `name`, else the file stem. */
  name: string
  body: string
  root: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Recursively list files, skipping dependency and VCS trees. */
function walk(directory: string, base = directory): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(absolute, base))
    else if (entry.isFile()) found.push(absolute)
  }
  return found
}

/** Split a skill file into its YAML frontmatter and Markdown body. */
function readFrontmatter(source: string): { data: Record<string, unknown>; body: string } | { error: string } {
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') return { error: 'missing YAML frontmatter: the file must start with ---' }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { error: 'unclosed YAML frontmatter: no closing --- line' }
  try {
    const data = asRecord(load(lines.slice(1, end).join('\n')))
    if (data === undefined) return { error: 'frontmatter must be a YAML mapping' }
    return { data, body: lines.slice(end + 1).join('\n') }
  }
  catch (error) {
    return { error: `frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Every `scripts/…`-style path the body promises.
 *
 * Real skill prose is full of slash lists ("LLM/tools/system prompt",
 * "Packages/examples/scripts/tests") that are not paths at all. So a candidate
 * counts only when it is explicitly written as one — inside inline code, as a
 * markdown link target — or when it carries a file extension. Link labels are
 * replaced by their targets, and shell variable prefixes (`"$SKILL_DIR/scripts/x.py"`)
 * are dropped, so a path is read once and still recognized.
 */
function promisedResources(body: string): string[] {
  const pattern = new RegExp(`(?:${RESOURCE_DIRECTORIES.join('|')})/[\\w./-]+`, 'g')
  const explicitSources = [
    ...[...body.matchAll(/\[[^\]]*\]\(([^)\s]+)/g)].map(match => match[1]),
    ...[...body.matchAll(/`([^`\n]+)`/g)].map(match => match[1]),
    ...[...body.matchAll(/```[\s\S]*?```/g)].map(match => match[0]),
  ]
  const prose = body
    .replace(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, '$1')
    .replace(/\$\{?\w+\}?\//g, '')

  const found = new Set<string>()
  const collect = (text: string, requireExtension: boolean): void => {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[0].replace(/[.,;:)\]]+$/, '').replace(/\/$/, '')
      if (candidate.includes('<') || candidate.includes('*')) continue
      if (requireExtension && !/\.[a-z0-9]+$/i.test(candidate)) continue
      found.add(candidate)
    }
  }

  for (const source of explicitSources) collect(source.replace(/\$\{?\w+\}?\//g, ''), false)
  collect(prose, true)
  return [...found].sort()
}

/** True when the body names a shipped file, by relative path or by basename. */
function mentionsFile(body: string, promised: string[], relativePath: string): boolean {
  if (promised.includes(relativePath)) return true
  const basename = relativePath.split('/').pop() ?? relativePath
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\w.-])${escaped}(?:$|[^\\w.-])`).test(body)
}

/** Report the scripts a bundle ships but its body never names. */
function orphanScripts(bundle: SkillBundle, promised: string[]): string[] {
  const scriptsDirectory = join(bundle.directory, 'scripts')
  if (!existsSync(scriptsDirectory)) return []
  return walk(scriptsDirectory)
    .map(file => relative(bundle.directory, file).split('\\').join('/'))
    .filter(path => !mentionsFile(bundle.body, promised, path))
}

/** True when `python3` can parse the file; throws with the interpreter's own text. */
function checkPython(file: string): void {
  execFileSync(
    'python3',
    ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', file],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
}

/** True when `node --check` accepts the file. */
function checkJavaScript(file: string): void {
  execFileSync('node', ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] })
}

function pythonAvailable(): boolean {
  try {
    execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

/**
 * Collect contract violations across the given skill roots.
 * @param root - Repository root.
 * @param roots - Repository-relative roots to scan, in rank order.
 * @returns diagnostics, each carrying its own severity and the offending path.
 */
export function collectSkillBundleViolations(
  root: string,
  roots: string[] = DEFAULT_ROOTS,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const bundles: SkillBundle[] = []
  const hasPython = pythonAvailable()

  for (const scanRoot of roots) {
    const absoluteRoot = resolve(root, scanRoot)
    if (!existsSync(absoluteRoot)) continue

    for (const file of walk(absoluteRoot)) {
      if (!file.endsWith('/SKILL.md') && !file.endsWith('.md')) continue

      const relativeToRoot = relative(absoluteRoot, file).split('\\').join('/')
      const depth = relativeToRoot.split('/').length - 1
      const repositoryPath = relative(root, file).split('\\').join('/')

      if (relativeToRoot.endsWith('SKILL.md') && depth > 1) {
        diagnostics.push({
          severity: 'error',
          file: repositoryPath,
          message: `never discovered: ${scanRoot} only loads <name>/SKILL.md and <name>.md at the root,`
            + ` so this ${String(depth)}-level nesting is dead weight — flatten it to <name>/SKILL.md`,
        })
        continue
      }
      // Flat `<name>.md` files only count at the top level; anything deeper is an asset.
      if (!relativeToRoot.endsWith('SKILL.md') && depth > 0) continue

      const parsed = readFrontmatter(readFileSync(file, 'utf8'))
      const directory = relativeToRoot.endsWith('SKILL.md')
        ? join(absoluteRoot, relativeToRoot.slice(0, -'/SKILL.md'.length))
        : absoluteRoot
      const stem = relativeToRoot.endsWith('SKILL.md')
        ? relativeToRoot.split('/').slice(-2)[0] ?? ''
        : relativeToRoot.replace(/\.md$/, '').split('/').pop() ?? ''

      if ('error' in parsed) {
        diagnostics.push({ severity: 'error', file: repositoryPath, message: parsed.error })
        bundles.push({ path: repositoryPath, directory, file, name: stem, body: '', root: scanRoot })
        continue
      }

      const name = parsed.data.name
      const description = parsed.data.description
      if (typeof name !== 'string' || name.length === 0) {
        diagnostics.push({ severity: 'error', file: repositoryPath, message: 'frontmatter needs a non-empty `name`' })
      }
      if (typeof description !== 'string' || description.length === 0) {
        diagnostics.push({
          severity: 'error',
          file: repositoryPath,
          message: 'frontmatter needs a non-empty `description` — without it the skill is dropped from the catalog',
        })
      }

      for (const key of BOOLEAN_KEYS) {
        const value = parsed.data[key]
        if (value !== undefined && typeof value !== 'boolean') {
          diagnostics.push({
            severity: 'error',
            file: repositoryPath,
            message: `\`${key}\` must be a YAML boolean (got ${JSON.stringify(value)}); any other spelling drops the skill`,
          })
        }
      }

      if (typeof name === 'string' && name.length > 0 && name !== stem) {
        diagnostics.push({
          severity: 'warning',
          file: repositoryPath,
          message: `frontmatter name \`${name}\` differs from the bundle name \`${stem}\`; the catalog uses \`${name}\`,`
            + ' so the two drift apart in logs and duplicate detection',
        })
      }

      bundles.push({
        path: repositoryPath,
        directory,
        file,
        name: typeof name === 'string' && name.length > 0 ? name : stem,
        body: parsed.body,
        root: scanRoot,
      })
    }
  }

  for (const bundle of bundles) {
    const promised = promisedResources(bundle.body)
    for (const resource of promised) {
      // A skill may point at its own resources or at repository-level scripts;
      // only a path that resolves in neither place is broken.
      if (!existsSync(join(bundle.directory, resource)) && !existsSync(join(root, resource))) {
        diagnostics.push({
          severity: 'error',
          file: bundle.path,
          message: `body promises \`${resource}\`, but neither the bundle nor the repository contains it`,
        })
      }
    }

    const scriptsDirectory = join(bundle.directory, 'scripts')
    if (existsSync(scriptsDirectory)) {
      for (const file of walk(scriptsDirectory)) {
        const relativePath = relative(bundle.directory, file).split('\\').join('/')
        if (file.endsWith('.py') && hasPython) {
          try {
            checkPython(file)
          }
          catch (error) {
            const detail = (error as { stderr?: Buffer }).stderr?.toString().trim() ?? ''
            diagnostics.push({
              severity: 'error',
              file: bundle.path,
              message: `\`${relativePath}\` does not parse as Python: ${detail.split('\n').pop() ?? 'syntax error'}`,
            })
          }
        }
        else if (/\.(?:js|mjs|cjs)$/.test(file)) {
          try {
            checkJavaScript(file)
          }
          catch (error) {
            const detail = (error as { stderr?: Buffer }).stderr?.toString().trim() ?? ''
            diagnostics.push({
              severity: 'error',
              file: bundle.path,
              message: `\`${relativePath}\` fails \`node --check\`: ${detail.split('\n').pop() ?? 'syntax error'}`,
            })
          }
        }
      }

      for (const orphan of orphanScripts(bundle, promised)) {
        diagnostics.push({
          severity: 'warning',
          file: bundle.path,
          message: `\`${orphan}\` is shipped but never named in the body — the agent has no reason to run it`,
        })
      }
    }
  }

  const byName = new Map<string, SkillBundle>()
  for (const bundle of bundles) {
    const earlier = byName.get(bundle.name)
    if (earlier !== undefined) {
      diagnostics.push({
        severity: 'error',
        file: bundle.path,
        message: `skill name \`${bundle.name}\` is already provided by ${earlier.path};`
          + ' the higher-ranked root wins and the other definition never loads',
      })
      continue
    }
    byName.set(bundle.name, bundle)
  }

  return diagnostics
}

/** Expand a repository root into its scanned skill roots; a skill root stays as-is. */
function expandRoot(repositoryRoot: string, given: string): string[] {
  const absolute = resolve(repositoryRoot, given)
  if (!existsSync(absolute)) return []
  const nested = DEFAULT_ROOTS
    .map(candidate => join(absolute, candidate))
    .filter(candidate => existsSync(candidate))
  if (nested.length === 0) return [given]
  return nested.map(candidate => relative(repositoryRoot, candidate).split('\\').join('/'))
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const requested: string[] = []
  let strict = false
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    if (argument === '--strict') strict = true
    else if (argument === '--root') {
      index += 1
      const value = process.argv[index]
      if (value === undefined) {
        process.stderr.write('verify-skill-bundles: --root needs a value\n')
        process.exit(2)
      }
      requested.push(value)
    }
    else {
      process.stderr.write(`verify-skill-bundles: unknown argument ${argument}\n`)
      process.exit(2)
    }
  }

  const scanned = [...new Set(
    (requested.length > 0 ? requested : ['.'])
      .flatMap(given => expandRoot(ROOT, given))
      .filter(root => existsSync(resolve(ROOT, root))),
  )]
  if (scanned.length === 0) {
    process.stdout.write('verify-skill-bundles: no skill roots found; nothing to check.\n')
    process.exit(0)
  }

  const diagnostics = collectSkillBundleViolations(ROOT, scanned)
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 'warning')

  for (const diagnostic of diagnostics) {
    const label = diagnostic.severity === 'error' ? 'error' : 'warning'
    process.stderr.write(`${diagnostic.file}: ${label}: ${diagnostic.message}\n`)
  }

  const failed = errors.length > 0 || (strict && warnings.length > 0)
  process.stdout.write(
    `verify-skill-bundles: ${String(scanned.length)} root(s) [${scanned.join(', ')}], `
    + `${String(errors.length)} error(s), ${String(warnings.length)} warning(s).\n`,
  )
  process.exit(failed ? 1 : 0)
}
