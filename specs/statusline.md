---
id: SHIP-STATUSLINE-DOC
title: SpecShip status-line segment
owner: core
priority: medium
version: 1
---

<!-- id: SHIP-STATUSLINE-DOC -->
# SpecShip status-line segment

A composable Claude Code status-line segment. SpecShip exposes a `specship
statusline` subcommand that reads Claude Code's status-line JSON on stdin and
prints a single styled line to stdout, which the user appends to their own
status-line script (the same way other status-line producers compose in). The
segment surfaces, at a glance: index sync state, SQLite backend health, the
number of specship lookups made this session, and the active workflow run.

Two hard design constraints shape every requirement below:

- **Performance.** A Claude Code status line re-renders sub-second. The
  subcommand MUST resolve its output from small cached files and MUST NOT open
  the SQLite database, spawn the indexer, or do network I/O — otherwise it lags
  the prompt. A producer side (watcher / index ops / the MCP server) keeps the
  caches warm; the reader side only reads.
- **Honesty.** The segment MUST NOT show a "tokens saved" figure. SpecShip's
  token/cost savings are an A/B benchmark result that requires a
  without-SpecShip counterfactual, which does not exist at runtime; a live
  "saved N tokens" number would be fabricated. The honest, true stand-in is the
  count of specship tool calls made this session.

SpecShip is Claude Code only; this feature targets Claude Code's `statusLine`
config and no other agent.

<!-- id: REQ-STATUSLINE-001 -->
## The `specship statusline` command MUST read status-line JSON from stdin and print exactly one line to stdout

The subcommand consumes Claude Code's status-line JSON object on stdin and
emits a single line (one segment) on stdout. It is a pure composition unit: it
prints only its own segment, never a full multi-line status line, so the user
can append it to an existing script. Any failure to parse or resolve data
degrades to a minimal valid line rather than an error (see REQ-STATUSLINE-007's
sibling perf rule in REQ-STATUSLINE-002).

implementations:
  - src/statusline/index.ts:buildSegment
  - src/statusline/render.ts:renderSegment

## Acceptance
<!-- id: REQ-STATUSLINE-001.A1 -->
- Given a well-formed status-line JSON object on stdin, the command writes exactly one line to stdout and exits 0.
<!-- id: REQ-STATUSLINE-001.A2 -->
- Given empty stdin or stdin that is not valid JSON, the command writes a single degraded line to stdout and still exits 0 (it MUST NOT throw, hang, or exit non-zero).
<!-- id: REQ-STATUSLINE-001.A3 -->
- The command writes nothing to stderr on the success path, and its stdout contains no embedded newline other than the single trailing one expected by a status-line producer.
<!-- id: REQ-STATUSLINE-001.A4 -->
- When the `NO_COLOR` environment variable is set, the emitted line contains no ANSI escape sequences.

<!-- id: REQ-STATUSLINE-002 -->
## The command MUST resolve its output from cached files only and MUST NOT open the database

To stay within the sub-second status-line render budget, the reader path does
only bounded file reads: it reads `.specship/statusline.json` (Tier-A index
state) and the session marker under `.specship/session/` (Tier-B call data). It
MUST NOT open the SQLite database, acquire the index lock, spawn a subprocess,
or perform network I/O. A missing, stale, locked, or corrupt database has no
effect on the command.

implementations:
  - src/statusline/cache.ts:readStatuslineCache
  - src/statusline/session-marker.ts:readSessionMarker

## Acceptance
<!-- id: REQ-STATUSLINE-002.A1 -->
- During a run of `specship statusline`, no SQLite connection is opened and the index lock file is never created or held.
<!-- id: REQ-STATUSLINE-002.A2 -->
- The command produces a valid line when the `.specship/` database file is absent or when it is exclusively locked by another process.
<!-- id: REQ-STATUSLINE-002.A3 -->
- The command spawns no child process and opens no socket during its run.
<!-- id: REQ-STATUSLINE-002.A4 -->
- The command reads at most the two cache files named above; it does not walk the project tree or stat source files.

<!-- id: REQ-STATUSLINE-003 -->
## SpecShip MUST refresh the status-line cache on index, sync, and watcher events

The producer side writes `.specship/statusline.json` whenever index state
changes, so the reader always has current Tier-A data without touching the
database. The cache holds: initialized flag, pending-change counts (added /
modified / removed), the active SQLite backend plus whether it is on a
degraded non-WAL path (where reads can block — network mounts, WSL2 `/mnt`, or
the wasm fallback), file and node
counts, drift-queue count, and the last-indexed timestamp. Writes are atomic
(write-temp-then-rename) so a concurrent reader never observes a partial file.

implementations:
  - src/statusline/cache.ts:writeStatuslineCache
  - src/index.ts:SpecShip.indexAll
  - src/sync/file-watcher.ts:FileWatcher

## Acceptance
<!-- id: REQ-STATUSLINE-003.A1 -->
- After `specship index` completes, `.specship/statusline.json` reports file, node, and drift counts matching `specship status --json` for the same project.
<!-- id: REQ-STATUSLINE-003.A2 -->
- After a watched source edit settles through the file watcher, the cache's pending-change counts reflect the edit without any explicit `specship` command being run.
<!-- id: REQ-STATUSLINE-003.A3 -->
- The cache write is atomic: a reader concurrent with a refresh reads either the complete previous version or the complete new version, never a truncated file.
<!-- id: REQ-STATUSLINE-003.A4 -->
- The cache records the active SQLite backend and whether it is on a degraded non-WAL path, so the segment can flag a slow database.

<!-- id: REQ-STATUSLINE-004 -->
## The MCP server MUST record a per-session call count and the last tool name to a session marker

The MCP server maintains a session marker under `.specship/session/` scoped to
its own process lifetime — Claude Code spawns one MCP server per session, so
"calls since this server started" is the session's call count. At the single
tool-dispatch chokepoint, each successfully handled `specship_*` tool call
increments the count and records the tool name plus a timestamp. The marker is
created on the first call. Updating it MUST be atomic and MUST NOT block or fail
the underlying tool call if the write errors.

implementations:
  - src/mcp/tools.ts:MCPTools.execute
  - src/statusline/session-marker.ts:recordCall

## Acceptance
<!-- id: REQ-STATUSLINE-004.A1 -->
- Each successfully handled `specship_*` tool call increments the session marker's count by exactly one.
<!-- id: REQ-STATUSLINE-004.A2 -->
- The marker records the name of the most recently invoked tool and the time of that call.
<!-- id: REQ-STATUSLINE-004.A3 -->
- If writing the marker fails (e.g. read-only filesystem), the tool call still returns its normal result and the failure is swallowed, not surfaced to the agent.
<!-- id: REQ-STATUSLINE-004.A4 -->
- Two concurrent MCP servers on the same project are a documented edge case: they share one marker and their counts may interleave; this MUST NOT crash either server.

<!-- id: REQ-STATUSLINE-005 -->
## The segment MUST show sync state, backend health, session call count, and the active run, and MUST NOT show a fabricated tokens-saved figure

The rendered line surfaces four things from the caches: (1) sync state —
"synced" when there are no pending changes, otherwise the pending count, plus
the drift-queue count when non-zero; (2) backend health — a warning marker when
the database is on a degraded non-WAL path (reads can block); (3) the session call count as "N
calls" (or equivalent), which is the honest stand-in for savings; (4) the
active workflow run's SPEC_ID and status when a run exists, omitted entirely
when none does. The default rendering uses the project's art-deco status-line
style (gold ANSI, `◈`/`◆` separators, `❮▰▱❯` bars), degrading to plain text
under `NO_COLOR` per REQ-STATUSLINE-001.A4. The output MUST NOT contain a
"tokens saved", "saved N tokens", or equivalent fabricated-savings figure.

implementations:
  - src/statusline/render.ts:renderSegment
  - src/statusline/cache.ts:readStatuslineCache
  - src/workflows/executor.ts:WorkflowExecutor.syncActiveRunMarker
  - src/statusline/active-run.ts:writeActiveRun

## Acceptance
<!-- id: REQ-STATUSLINE-005.A1 -->
- When the cache reports zero pending changes, the segment shows a synced indicator; when it reports N pending changes, the segment shows that count.
<!-- id: REQ-STATUSLINE-005.A2 -->
- When the database is on a degraded non-WAL path, the segment includes a distinct warning marker naming the backend; when the journal is WAL, no warning is shown.
<!-- id: REQ-STATUSLINE-005.A3 -->
- The segment displays the session call count sourced from the session marker, and shows zero (or a neutral placeholder) when no marker exists yet.
<!-- id: REQ-STATUSLINE-005.A4 -->
- When an active workflow run exists for the project, the segment shows its SPEC_ID and run status; when no run exists, the run portion is omitted, not shown empty.
<!-- id: REQ-STATUSLINE-005.A5 -->
- The segment's output never contains the substring "saved" in reference to tokens or cost, nor any numeric savings figure.

<!-- id: REQ-STATUSLINE-006 -->
## `specship install` MUST offer the segment opt-in and MUST NOT overwrite an existing status line

During `specship install`, when the target `settings.json` has no
`statusLine.command`, the installer offers (a confirm prompt, defaulting to no)
to wire the segment. On acceptance it writes a `statusLine` entry invoking
`specship statusline`, enclosed in a SpecShip-marked block so it can be removed
later. When the target `settings.json` already has a `statusLine.command`, the
installer MUST NOT modify it; instead it prints the composable one-line snippet
for the user to append themselves. The choice of global vs local `settings.json`
follows the same target the rest of `install` uses.

implementations:
  - src/installer/targets/claude.ts:writeStatusLineEntry
  - src/installer/index.ts:runInstallerWithOptions

## Acceptance
<!-- id: REQ-STATUSLINE-006.A1 -->
- Installing against a `settings.json` with no `statusLine`, with the user accepting the prompt, results in a `statusLine` whose command invokes `specship statusline`, wrapped in a SpecShip-marked block.
<!-- id: REQ-STATUSLINE-006.A2 -->
- Installing against a `settings.json` that already defines `statusLine.command` leaves that value byte-for-byte unchanged and prints the composable snippet instead.
<!-- id: REQ-STATUSLINE-006.A3 -->
- Declining the prompt (or running install non-interactively without the opt-in) writes no `statusLine` entry.
<!-- id: REQ-STATUSLINE-006.A4 -->
- Re-running `install` after the segment is already wired produces a byte-equal `settings.json` and reports `unchanged`.

<!-- id: REQ-STATUSLINE-007 -->
## `specship uninstall` MUST remove only the status-line wiring it added

Uninstall reverses exactly what install wrote: it removes the SpecShip-marked
`statusLine` block and nothing else. A user-authored `statusLine` that install
never touched MUST survive uninstall untouched. Uninstall on a config where
install never wrote a `statusLine` is a no-op for that key.

implementations:
  - src/installer/targets/claude.ts:removeStatusLineEntry

## Acceptance
<!-- id: REQ-STATUSLINE-007.A1 -->
- Uninstall removes the SpecShip-marked `statusLine` block that install added, restoring the key to its pre-install state.
<!-- id: REQ-STATUSLINE-007.A2 -->
- A user-authored `statusLine.command` that install left in place is unchanged after uninstall.
<!-- id: REQ-STATUSLINE-007.A3 -->
- Uninstall on a `settings.json` that has no SpecShip-marked `statusLine` block makes no change to the `statusLine` key.
