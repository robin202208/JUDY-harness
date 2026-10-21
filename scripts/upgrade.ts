/**
 * Run one upstream upgrade end to end, and record what it cost.
 *
 * The steps are ordered so every expensive stage is preceded by a cheap one that
 * can fail first: contract diff (seconds) → patch replay (seconds) → build
 * (minutes) → typecheck → preflight → ledger row.
 *
 * Commands:
 *   tsx scripts/upgrade.ts plan                      # print the steps, change nothing
 *   tsx scripts/upgrade.ts check --asar <app.asar>   # snapshot a candidate build, diff vs baseline
 *   tsx scripts/upgrade.ts run [--dry-run]           # the full pipeline
 *   tsx scripts/upgrade.ts record --minutes 95 ...   # append a ledger row by hand
 *
 * @module scripts/upgrade
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { diffSnapshots, renderReport, snapshotFromAsar, snapshotFromRepo, type Snapshot } from './contracts.ts'

const ROOT = resolve(import.meta.dirname, '..')
const LEADER_SENTINEL = '<!-- ledger:append -->'

interface Step {
  name: string
  command?: string[]
  /** Why this step exists, printed by `plan`. */
  why: string
  /** Skip when the predicate says the step does not apply to this repository. */
  when?: () => boolean
}

interface StepResult { name: string; ok: boolean; ms: number; detail: string }

function sh(command: string, args: string[], quiet = false): string {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  }).trim()
}

function capture(command: string, args: string[]): string {
  return sh(command, args, true)
}

function scriptExists(name: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    return manifest.scripts?.[name] !== undefined
  }
  catch {
    return false
  }
}

/**
 * Replayable patch files, in application order.
 *
 * pnpm patch files live in `patches/*.patch`; ours get their own directory so a
 * replay never tries to apply a dependency patch.
 * @param root - Repository root to read.
 * @returns repository-relative patch paths, sorted so replay order is stable.
 */
export function patchFiles(root: string = ROOT): string[] {
  const directory = join(root, 'patches', 'upgrade')
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter(name => name.endsWith('.patch'))
    .sort()
    .map(name => join('patches', 'upgrade', name))
}

/** The pipeline, declarative so `plan` and `run` cannot drift apart. */
export function steps(): Step[] {
  return [
    {
      name: 'preflight',
      why: '干净的工作树才可能把失败步骤回滚；脏树上任何 patch 失败都会混进你的改动。',
      command: ['git', 'status', '--porcelain'],
    },
    {
      name: 'fetch upstream',
      why: '先拿到上游标签，再决定升级到哪个而不是默认最新。',
      command: ['git', 'fetch', '--tags', 'upstream'],
    },
    {
      name: 'contract diff',
      why: '最快的一步：先看上游改了什么契约，再决定要不要继续花构建时间。',
      when: () => existsSync(join(ROOT, 'contracts', 'baseline.json')),
    },
    {
      name: 'replay patches',
      why: '补丁层逐条重放；失败即停，因为你必须当场判断能不能上移到插件层。',
      when: () => patchFiles().length > 0,
    },
    {
      name: 'rename scope',
      why: '机械改名必须在构建前完成，且必须可重放，否则每次升级都要手工改一遍。',
      when: () => scriptExists('change-scope'),
      command: ['pnpm', '--silent', 'run', 'change-scope'],
    },
    {
      name: 'build',
      why: '只有构建能发现类型之外的断裂：打包入口、资源路径、客户端模块包装。',
      when: () => scriptExists('build'),
      command: ['pnpm', 'run', 'build'],
    },
    {
      name: 'typecheck',
      why: '构建通过不代表契约没变，类型是第二个探针。',
      when: () => scriptExists('typecheck'),
      command: ['pnpm', 'run', 'typecheck'],
    },
    {
      name: 'preflight skills',
      why: '技能结构错误不会让构建失败，只会在运行时静默消失。',
      when: () => existsSync(join(ROOT, 'scripts', 'verify-skill-bundles.ts')),
    },
  ]
}

function snapshotBaseline(): Snapshot {
  const path = join(ROOT, 'contracts', 'baseline.json')
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

function runContractCheck(candidate: Snapshot): StepResult {
  const baseline = snapshotBaseline()
  const changes = diffSnapshots(baseline, candidate)
  const report = renderReport(baseline, candidate, changes)
  mkdirSync(join(ROOT, 'contracts', 'reports'), { recursive: true })
  const reportPath = join('contracts', 'reports', `${candidate.source.version}.md`)
  writeFileSync(join(ROOT, reportPath), report)
  const breaking = changes.filter(change => change.severity === 'breaking').length
  process.stdout.write(`contracts: ${reportPath} (${String(breaking)} breaking, ${String(changes.length)} total)\n`)
  return { name: 'contract diff', ok: breaking === 0, ms: 0, detail: `${String(breaking)} breaking` }
}

/**
 * Insert one row above the ledger sentinel.
 * @param path - Ledger file to edit.
 * @param row - Column values; missing columns render as an em dash.
 * @returns the appended line, or undefined when the file or sentinel is missing.
 */
export function appendLedgerRow(path: string, row: Record<string, string>): string | undefined {
  const columns = ['date', 'from', 'to', 'conflicts', 'levels', 'minutes', 'cause', 'prevention']
  const line = `| ${columns.map(column => row[column] ?? '—').join(' | ')} |`
  if (!existsSync(path)) return undefined
  const source = readFileSync(path, 'utf8')
  if (!source.includes(LEADER_SENTINEL)) return undefined
  writeFileSync(path, source.replace(LEADER_SENTINEL, `${line}\n${LEADER_SENTINEL}`))
  return line
}

function appendLedger(row: Record<string, string>): void {
  const line = appendLedgerRow(join(ROOT, 'contracts', 'upgrade-ledger.md'), row)
  if (line === undefined) {
    process.stdout.write('ledger: contracts/upgrade-ledger.md or its sentinel is missing; skipped the row\n')
    return
  }
  process.stdout.write(`ledger: appended ${line}\n`)
}

function printPlan(): void {
  process.stdout.write('upgrade plan\n\n')
  for (const [index, step] of steps().entries()) {
    const applies = step.when?.() ?? true
    process.stdout.write(`${String(index + 1).padStart(2)}. ${step.name}${applies ? '' : '  (skipped in this repo)'}\n`)
    process.stdout.write(`    ${step.why}\n`)
    if (step.command !== undefined) process.stdout.write(`    $ ${step.command.join(' ')}\n`)
  }
  const patches = patchFiles()
  process.stdout.write(`\npatches: ${patches.length === 0 ? 'none' : patches.join(', ')}\n`)
}

// ------------------------------------------------------------------- cli

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const command = args[0]
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const many = (name: string): string[] => {
    const values: string[] = []
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === name && args[index + 1] !== undefined) values.push(args[index + 1]!)
    }
    return values
  }

  if (command === 'plan') {
    printPlan()
    process.exit(0)
  }

  if (command === 'check') {
    const asar = flag('--asar')
    const repo = flag('--repo')
    if (!existsSync(join(ROOT, 'contracts', 'baseline.json'))) {
      process.stderr.write('check: contracts/baseline.json missing — run `contracts.ts snapshot` once and commit it\n')
      process.exit(2)
    }
    const candidate = asar !== undefined
      ? snapshotFromAsar(resolve(ROOT, asar))
      : snapshotFromRepo(resolve(ROOT, repo ?? '.'))
    const result = runContractCheck(candidate)
    process.exit(result.ok ? 0 : 1)
  }

  if (command === 'record') {
    appendLedger({
      date: flag('--date') ?? new Date().toISOString().slice(0, 10),
      from: flag('--from') ?? '—',
      to: flag('--to') ?? '—',
      conflicts: flag('--conflicts') ?? '0',
      levels: flag('--levels') ?? '—',
      minutes: flag('--minutes') ?? '—',
      cause: flag('--cause') ?? '—',
      prevention: flag('--prevention') ?? '—',
    })
    process.exit(0)
  }

  if (command === 'run') {
    const dryRun = args.includes('--dry-run')
    const started = Date.now()
    const results: StepResult[] = []
    printPlan()
    process.stdout.write('\n--- run ---\n')

    for (const step of steps()) {
      if (!(step.when?.() ?? true)) {
        process.stdout.write(`skip ${step.name}\n`)
        continue
      }

      if (step.name === 'contract diff') {
        const candidate = snapshotFromRepo(ROOT)
        const result = runContractCheck(candidate)
        results.push({ ...result, ms: Date.now() - started })
        if (!result.ok) break
        continue
      }

      if (step.name === 'preflight') {
        const status = capture('git', ['status', '--porcelain'])
        const clean = status.length === 0
        results.push({ name: step.name, ok: clean, ms: 0, detail: clean ? 'clean' : 'working tree is dirty' })
        if (!clean) {
          process.stderr.write('preflight: working tree is dirty; commit or stash first\n')
          break
        }
        continue
      }

      if (step.name === 'preflight skills') {
        const script = join(ROOT, 'scripts', 'verify-skill-bundles.ts')
        if (dryRun) {
          process.stdout.write(`$ npx tsx ${relative(ROOT, script)}\n`)
          continue
        }
        const begin = Date.now()
        try {
          sh('npx', ['tsx', script], false)
          results.push({ name: step.name, ok: true, ms: Date.now() - begin, detail: 'ok' })
        }
        catch {
          results.push({ name: step.name, ok: false, ms: Date.now() - begin, detail: 'violations found' })
          break
        }
        continue
      }

      if (step.command === undefined) continue
      const [bin, ...rest] = step.command
      if (dryRun) {
        process.stdout.write(`$ ${step.command.join(' ')}\n`)
        continue
      }
      const begin = Date.now()
      try {
        sh(bin!, rest)
        results.push({ name: step.name, ok: true, ms: Date.now() - begin, detail: 'ok' })
      }
      catch {
        results.push({ name: step.name, ok: false, ms: Date.now() - begin, detail: 'command failed' })
        break
      }
    }

    const failed = results.find(result => !result.ok)
    const total = Math.round((Date.now() - started) / 60000)
    process.stdout.write('\n--- summary ---\n')
    for (const result of results) {
      process.stdout.write(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name} (${String(Math.round(result.ms / 1000))}s) ${result.detail}\n`)
    }
    process.stdout.write(`elapsed: ${String(total)} min\n`)

    if (failed === undefined && !dryRun) {
      appendLedger({
        date: new Date().toISOString().slice(0, 10),
        from: flag('--from') ?? 'see git log',
        to: flag('--to') ?? 'see git log',
        conflicts: String(many('--conflict').length),
        levels: flag('--levels') ?? 'ok',
        minutes: String(total),
        cause: flag('--cause') ?? '—',
        prevention: flag('--prevention') ?? '—',
      })
    }
    process.exit(failed === undefined ? 0 : 1)
  }

  process.stderr.write('usage: upgrade.ts <plan|check|run|record> [options]\n')
  process.exit(2)
}
