# Agent Note: Turn deliverables from filesystem versions

Status: proposed

English | [中文](2026-10-22-turn-deliverables-from-fs-versions.zh.md)

## Problem

The turn-tail file row only knows about files whose *tool* said it wrote them: [`producedPaths`](../../../packages/client/ui-deliverables/src/client/turn-deliverables.ts) accepts a `diff` card or a `generic` card with `kind === 'edit'`. A shell command, a Python script, or any tool that writes through the shell presents a `terminal` card, and `TerminalResultView` has no `locations` field at all. So the most common way a deliverable is actually produced in this deployment — a script run — leaves the row empty, and the closing message's file mentions have no vocabulary to resolve against.

The system prompt already asks the model to format outputs as inline code using the exact path or a unique basename, and the model does not reliably comply. Guidance cannot substitute for a source of truth.

## Proposal

Take the turn's output set from the filesystem, not from the tools.

**Snapshot.** `dsh-fs-local` gains `collectVersions(root, options)`: a `stat`-only walk (no file reads) recording one `FsVersion` per regular file, keyed by workspace-relative POSIX path. `FsVersion` is the existing `dev:ino:size:mtimeNs:ctimeNs` tuple, so a same-size rewrite is still a change. Bounds: `maxDepth` (default 8), `maxEntries` (default 20000), an ignore set (`.git`, `node_modules`, build outputs), and cancellation. Failures degrade — an unreadable directory is counted, never thrown, because a turn-end snapshot must not be able to fail a reply.

**Diff.** `changedVersions(before, after)` returns sorted `created` / `modified` / `removed` plus `truncated`. Truncation means the result is a lower bound, and the UI says so rather than implying nothing else changed.

**Wire contract.** One new unary RPC, `fs.listVersions`, addressed by session rather than by path:

```
request  { sessionId: string, maxDepth?: number, maxEntries?: number }
response { root: string, truncated: boolean, unreadable: number,
           entries: Array<{ path: string, version: string, size: number }> }
errors   session-not-found, fs-unavailable, cancelled
```

The request carries no filesystem path at all: the host resolves the session header's `cwd` — which every served session records at create time — so the fence is "the caller named a session it is already attached to", not "the caller named a path we hope is inside one". An unknown session fails with the existing `session-not-found`, and a session without a `cwd` with `fs-unavailable`, both before any walk.

**Ownership.** `collectVersions` lives in `dsh-fs-local` because it is filesystem work, but `dsh-host-apiproxy` does not depend on that provider and must not start: the BFF would learn which filesystem implementation is installed. The snapshot therefore becomes a method on the workspace service (`dsh-workspace`, already an apiproxy dependency and already the owner of workspace paths), which composes `collectVersions`; `fs.listVersions` is a thin adapter over it. That keeps the provider behind the seam that already exists.

**Payload units.** The event carries `root` plus absolute paths, not workspace-relative ones. Every other producer of a file path here — tool `locations`, the files service, the download endpoint — speaks absolute, and a second unit in the same list would make the union undecidable without a root lookup the client does not have. The invariant therefore checks that each path is `root` itself or sits below it, which proves the property directly instead of only proving a path is not absolute.

**Where the event is declared.** `turn/deliverables` is a member of the core `SessionEventMap`, not a package-local declaration merge. The consumer is a browser bundle, which cannot import a host package that walks the filesystem; a core declaration is the only place both sides can read without dragging `node:fs` into the client graph.

**Turn binding.** The conversation engine's Definition contract is synchronous — `match`/`start`/`update`/`buildLocationData` take an event and return state — so a turn boundary cannot await two snapshots. The host therefore owns the pairing: it runs the agent loop, observes `turn/start` and settle, snapshots both sides, and publishes the result as a new `turn/deliverables` Session event carrying `created ∪ modified` (minus the ignore set). The client Definition keeps its synchronous shape and reads that event like any other. `removed` is retained in the event for the diff report but never becomes a download chip. Tool-reported `locations` stay in the union: a file the tool named and the filesystem also saw is one entry.

`fs.listVersions` still earns its place: it is how a client re-derives the same set for a turn whose event predates this change, and it keeps the walk testable without an agent run. It is not on the turn-boundary path.

## Acceptance criteria

- A turn that writes files **only** through a shell command shows a populated turn-tail row; the same turn with no writes shows none.
- A file rewritten at the same size and same name appears as `modified`.
- Exceeding `maxDepth` or `maxEntries` sets `truncated: true`, and the row renders a "may be incomplete" affordance instead of silently claiming completeness.
- An unreadable directory leaves the rest of the snapshot intact and does not fail the turn.
- `fs.listVersions` with a `root` outside the session workspace fails with a structured error; no host path outside the workspace is ever enumerated.
- Two snapshots per turn stay within the turn's latency budget on a workspace at the `maxEntries` bound (measured, not assumed).

## Risks

Snapshotting every turn doubles a directory walk per turn on large workspaces; the caps bound it but also make completeness a best-effort claim, which is why truncation must be visible rather than swallowed. Racy writes still in flight at settle time can land in the next turn's snapshot instead of this one.

Unioning with tool `locations` may surface a file the tool wrote outside the workspace root; the union must filter to the snapshot root, or the chip would advertise a download the files service refuses.

An `fs.listVersions` that accepts an arbitrary root is a host enumeration primitive if the fence is wrong. The fence — session workspace only — is the load-bearing part of this proposal, not the traversal.
