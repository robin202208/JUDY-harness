# Agent Note: Upstream upgrade harness with contract snapshots

Status: implemented

English | [中文](2026-10-21-upstream-upgrade-harness.zh.md)

## Problem

This fork edits upstream UI components directly: the sidebar and conversation brand fallbacks carry JUDY's mark, so an upstream release that renames a slot, drops a package, or renames a patch row id breaks the product silently. Nothing in the repository could answer "what did upstream change that we depend on" before a build, and the cost of each past upgrade lived only in memory. Reading the upstream changelog answers the wrong question: it lists what was added, not which target a downstream override loses.

## Decision

Three scripts and one data directory make the upgrade surface measurable.

`scripts/contracts.ts` captures the contract surface a downstream fork depends on — package versions, `dsh.client` declarations and their `inject` edges, `dsh.bundle.patch` files, every Loader row id a patch layer can target, every UI slot name, and every `DSH_*` environment read — from an installed `app.asar` or from a source tree, without a build or a running server. Two snapshots diff into a Markdown report graded `breaking` (a removed slot, row id, package, or inject edge), `warning` (a removed environment variable, a changed bundle patch list), and `info` (anything added or version-bumped). `--fail-on breaking` turns it into a CI gate.

`scripts/upgrade.ts` runs the pipeline in cost order: preflight, fetch, contract diff, replay `patches/upgrade/*.patch`, scope rename, build, typecheck, skill preflight. Steps are declared once in `steps()` so `plan` and `run` cannot drift. A successful run appends one row to `contracts/upgrade-ledger.md`; the row records conflicts, severity, duration, cause, and the prevention that should make the next upgrade cheaper.

`scripts/verify-skill-bundles.ts` covers the other half of "silently gone": the on-disk skill contract `dsh-skill-filesystem` actually loads. A `SKILL.md` nested deeper than `<root>/<name>/SKILL.md` is never discovered, a missing `name` or `description` drops the whole skill from the catalog, and a `scripts/` resource the body promises that is absent or unparsable fails at the model's runtime instead of CI.

Our replayable patches take their own directory because `patches/*.patch` already holds pnpm dependency patches; a replay that applied one of those would corrupt a dependency. `contracts/baseline.json` is deliberately not committed: it must be the version actually running, captured after a build so slot and environment capture is complete.

## Alternatives considered

**Read the upstream changelog before each upgrade.** The changelog describes additions and fixes. It does not report that `sidebar.brand.mark` disappeared, and it cannot be diffed mechanically, so the judgement stays with whoever remembers the last upgrade.

**Pin the current upstream version and stop upgrading.** This removes upgrade cost and also removes upstream fixes and security work, while every later rebase grows more expensive than the one deferred.

**Drop the `@deepseek-ai/` scope so the fork looks independent.** Scope renaming is mechanical and reversible; it changes no behavior this harness measures, and it multiplies the diff of every future upstream merge without reducing conflict.

**Track upstream as a submodule.** A submodule pins a commit, but the product composes profile patch layers over an installed tree; the snapshot tools need either a source checkout or an `app.asar`, and a submodule adds a second source of truth without answering the contract question.

## Consequences

Every upgrade now starts with a seconds-long contract diff and ends with a ledger row, so the cost of the next upgrade is estimated from recorded numbers instead of memory. Two metrics come from the ledger: the median duration of recent upgrades and the size of the patch layer.

A source tree without built `lib/client.js` cannot capture slots or environment reads; the snapshot tool warns instead of presenting a complete-looking empty record, and the baseline must be re-captured after `pnpm run build`. Snapshots detect removals and additions precisely but report a rename as one removal plus one addition.

The patch layer stays small by construction: a new patch has to justify why it cannot move up into the plugin layer, and the ledger's root-cause column is where that justification is tested.
