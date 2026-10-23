# Agent Note: Fork sync by generated brand layer

Status: implemented

English | [中文](2026-10-22-fork-sync-by-brand-script.zh.md)

## Problem

The fork is on the `0.1.0-rc.5` end of a very active upstream: since the 0.1.0-rc.5 merge base (2026-08-13) upstream advanced 10,102 commits to `dsh-v0.2.1-rc.2`, while the fork carries 16 commits of its own. Measuring a merge to `dsh-v0.2.1-rc.2` with `git merge-tree` yields 346 conflicted files — and 114 of them are `package.json` files whose only difference from upstream is a hand-edited `description` and `repository.url`.

That is the structural cost: the rebrand was performed as ordinary commits over upstream files, so every future merge re-opens the same 114 manifests, plus 73 markdown files, for edits a machine could reproduce exactly. Nothing in the repository could answer "how much will the next merge cost" before spending the day, and a first attempt to answer it was wrong: the local clone was shallow, `git rev-list` reported three commits, and the fork looked like an unrelated import with no common ancestor. The conclusion only inverted after `git fetch --unshallow`.

## Decision

The brand layer is generated, and the merge surface is measured before it is paid for.

`scripts/brand.ts` rewrites the two fields that differ — the `description` product name and the `repository` URL — by field-level text substitution on the manifest source, never parse/stringify, so upstream's indentation and key order survive and the diff is exactly the two changed lines. It is idempotent, `--dry-run` reports without writing, and `--check` exits non-zero when anything still needs rewriting, which is what keeps the rule from drifting back into hand edits. The version is deliberately not rewritten: a manifest now reports the upstream release it tracks instead of a pinned `0.1.0-rc.5`.

`judy/upstream-base` tags the merge base, so conflict counts are computed against a fixed anchor rather than re-derived. `judy-ops/upstream/sync-report.sh` runs `git merge-tree --write-tree` — which computes the merge without touching the working tree — and reports the conflict count, its file-type and directory distribution, and how much of it is mechanical. `rerere` is enabled repository-locally, so resolving one conflict teaches the next occurrence.

`.github/workflows/upstream-sync.yml` fetches the newest upstream tag weekly, snapshots its contract surface with the existing `scripts/contracts.ts`, diffs against `contracts/baseline.json`, and opens an issue on a `breaking` grade.

## Alternatives considered

**Keep hand-editing the manifests.** That is what produced the 114 conflicts. The rewrite is mechanical, so doing it by hand per release adds no judgement and repeats the same collision every time upstream touches a manifest.

**Split the fork into a thin shell over the published npm package.** It would make sync a version bump, but this fork patches upstream UI components (sidebar brand, conversation fallback, theme accent) and ships profile-level composition; the thin shell stops being thin at the first in-tree patch.

**Drop the `@deepseek-ai/` scope so the fork reads independent.** Scope renaming is reversible and changes no behavior, while every upstream import would be rewritten on every merge. The existing manifests keep the upstream package names for that reason.

**Brand by parsing and re-serializing JSON.** Simpler to write, and it reformats untouched keys — inline dependency tables expand, key order can move — so every merge diff carries formatting noise unrelated to the decision.

## Consequences

A merge to `dsh-v0.2.1-rc.2` drops from 346 to 232 conflicted files before any judgement is applied: 114 disappear when those manifests are taken from upstream and `brand.ts` is re-run. What remains is 73 markdown files, 86 re-recorded `examples/acp-agent` snapshots that are normally resolved by taking upstream, and 58 TypeScript/Python files that need a human.

The description rule retires itself: upstream now ends that phrase on 1 of 40 sampled manifests, so the rule mostly no-ops on newer releases and never has to be maintained. The repository rule still applies broadly (29 of 40).

Two costs are accepted. `--check` makes a hand-edited manifest a CI failure rather than a silent divergence, which is deliberate friction. And the weekly workflow needs `contracts/baseline.json` captured from our own build, not the reference snapshot under `judy-upgrade/`; until that is re-captured the diff is measured against someone else's version.
