---
id: SHIP-STATUSLINE-DOC
title: SpecShip status-line segment
owner: core
priority: medium
version: 4
---

<!-- id: SHIP-STATUSLINE-DOC -->
# SpecShip status-line segment

A composable Claude Code status-line segment. SpecShip exposes a `specship
statusline` subcommand that reads Claude Code's status-line JSON on stdin and
prints a single styled line to stdout, which the user appends to their own
status-line script (the same way other status-line producers compose in). The
segment surfaces, at a glance: index sync state, SQLite backend health, the
number of specship lookups made this session, and the active workflow run. It
can ALSO surface an optional Claude Code usage-limit sub-segment (5h session and
weekly capacity used, with reset times) — sourced from Claude Code's own
status-line `rate_limits` (or an optional override file), never computed or
estimated by SpecShip itself (REQ-STATUSLINE-008).

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
- The command writes nothing to stderr on the success path, and its stdout contains only the newline(s) that separate its stacked lines (header / identity / telemetry, REQ-STATUSLINE-010) — no leading, trailing, or interior blank line.
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
- The command reads at most the two cache files named above plus `.git/HEAD` (and a linked-worktree `.git` pointer) for the header's branch element (REQ-STATUSLINE-012); it walks upward for those roots exactly as it does for `.specship/`, but it does not walk the project tree downward or stat source files.

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

<!-- id: REQ-STATUSLINE-008 -->
## The segment MUST render a usage-limit sub-segment from Claude's stdin rate_limits (or an optional override file), and MUST omit any window whose data is absent or not real

Claude Code itself supplies the real usage data on the status-line stdin JSON:
a `rate_limits` object with a `five_hour` and a `seven_day` window, each carrying
`used_percentage` (0–100) and `resets_at` (Unix epoch seconds). It is present
only for Pro/Max subscribers, only after the first API response of the session,
and each window may be **independently absent**. This stdin `rate_limits` object
is the PRIMARY source; SpecShip MUST NOT estimate or fabricate any of it (the
honesty constraint, REQ-STATUSLINE-005) — it only reflects what Claude provides.

As an OPTIONAL override for setups where the stdin `rate_limits` are not present,
the reader MAY also read an account-wide file (default
`~/.specship/usage-limits.json`, overridable via `SPECSHIP_USAGE_FILE`) that an
external tool writes, with this schema (a window with `pctRemaining` 0–100 and an
ISO-8601 `resetAt`, plus an ISO-8601 `updatedAt` used for a freshness window —
default 15 minutes `[needs review]`):

```
{
  "updatedAt": "<ISO-8601>",
  "session":   { "pctUsed": <0-100>, "resetAt": "<ISO-8601>" },
  "weekly":    { "pctUsed": <0-100>, "resetAt": "<ISO-8601>" }
}
```

For each window that has real data, the segment appends a bar in the project's
art-deco style (`❮▰▱❯`): a `5h` bar for the 5-hour window and a `7d` bar for the
weekly window. Each shows the percentage **used** (for the stdin source, the
`used_percentage` value directly) and the reset time rendered in the **machine's
local timezone** — time-only when the reset is later the same local day (e.g.
`5h ❮▰▰▱❯ 42% (4pm)`), and date + time when it falls on another day (e.g.
`7d ❮▰▱▱❯ 73% (6/29, 2pm)`). The bar depicts capacity *used* (fuller = closer to
the limit). The
sub-segment reflects the source values exactly and never shows a savings figure
(it is a limit indicator, not REQ-STATUSLINE-005's call-count savings stand-in).

The reader path obeys REQ-STATUSLINE-002's performance rule: parsing stdin and at
most one bounded file read, with no database, subprocess, or network I/O.
Whenever a window's data is not real — `rate_limits` (or that window) is absent
on stdin and no valid override file applies, the file is unreadable / not valid
JSON / missing the field / stale beyond the freshness window — that window's bar
is omitted **entirely**: no bar, no placeholder, no estimated number. When
neither window has data, the whole sub-segment is omitted and the rest of the
segment (sync state, calls, run) renders unchanged.

implementations:
  - src/statusline/usage-limits.ts:usageFromStatuslineInput
  - src/statusline/usage-limits.ts:readUsageLimits
  - src/statusline/render.ts:renderSegment
  - src/statusline/index.ts:buildSegment

## Acceptance
<!-- id: REQ-STATUSLINE-008.A1 -->
- Given a stdin `rate_limits` with both windows, the segment includes a `5h` bar showing `five_hour.used_percentage` and a `7d` bar showing `seven_day.used_percentage`, each followed by its reset time derived from `resets_at`.
<!-- id: REQ-STATUSLINE-008.A2 -->
- Reset times are formatted in the machine's local timezone: a reset later the same local day shows time only (e.g. `(4pm)`); a reset on a different day shows date and time (e.g. `(6/29, 2pm)`).
<!-- id: REQ-STATUSLINE-008.A3 -->
- The displayed values are derived only from the source (stdin `rate_limits` or the override file); the command fabricates no usage figure of its own, and `resets_at` (epoch seconds) is converted faithfully to the local reset time.
<!-- id: REQ-STATUSLINE-008.A4 -->
- When stdin carries no `rate_limits` and no valid override file applies, the usage-limit sub-segment is omitted entirely and the rest of the segment renders unchanged.
<!-- id: REQ-STATUSLINE-008.A5 -->
- A window present on stdin while the other is absent renders only the present window; an override file that is unparseable, missing a field, or stale beyond the freshness window contributes nothing — no estimated or placeholder numbers are shown.
<!-- id: REQ-STATUSLINE-008.A6 -->
- Rendering the usage-limit sub-segment opens no SQLite connection, spawns no child process, and performs no network I/O (same bounded-read budget as REQ-STATUSLINE-002).
<!-- id: REQ-STATUSLINE-008.A7 -->
- Under `NO_COLOR`, the usage-limit sub-segment contains no ANSI escape sequences (bars and percentages render as plain text).

<!-- id: REQ-STATUSLINE-009 -->
## The segment MUST show a context-usage bar that escalates to a compaction warning past a configurable threshold

SpecShip cannot compact the conversation — the host (Claude Code) owns the
context window and its automatic compaction, and no MCP server, hook, or command
can trigger a compaction. What SpecShip CAN do is make context pressure
**visible** so the user compacts (or lets the host auto-compact) before the
conversation gets inefficient. The status-line stdin is the only channel that
carries context usage, so this lives in the segment.

When Claude Code's status-line stdin carries `context_window.used_percentage`
(0–100; it may be null early in a session), the segment renders a `CTX` bar in
the project's art-deco style (`❮▰▱❯`) showing the percentage of the context
window used. When that percentage is at or above a **configurable inefficiency
threshold** — default 80% `[needs review]`, overridable via the
`SPECSHIP_CTX_WARN_PCT` environment variable — the `CTX` element renders in a
distinct warning style and appends a short compaction hint (e.g. `⚠ compact`);
below the threshold it renders neutral with no hint. An unset or invalid
`SPECSHIP_CTX_WARN_PCT` falls back to the default.

The value is Claude's own real `used_percentage` (never fabricated or
estimated — the honesty constraint, REQ-STATUSLINE-005), and the hint is
advisory: SpecShip cannot and does not perform the compaction itself. The reader
obeys REQ-STATUSLINE-002's budget — it only parses the stdin it already
receives, with no database, subprocess, or network I/O. When
`context_window.used_percentage` is absent or null, the `CTX` element is omitted
entirely.

implementations:
  - src/statusline/usage-limits.ts:contextFromStatuslineInput
  - src/statusline/render.ts:renderSegment
  - src/statusline/index.ts:buildSegment

## Acceptance
<!-- id: REQ-STATUSLINE-009.A1 -->
- Given a stdin `context_window.used_percentage`, the segment includes a `CTX` bar showing that percentage.
<!-- id: REQ-STATUSLINE-009.A2 -->
- When `used_percentage` is at or above the threshold, the `CTX` element renders in a distinct warning style and appends a compaction hint; below the threshold it renders neutral with no hint.
<!-- id: REQ-STATUSLINE-009.A3 -->
- The threshold defaults to 80% and is overridden by a valid `SPECSHIP_CTX_WARN_PCT`; an unset or non-numeric / out-of-range value uses the default.
<!-- id: REQ-STATUSLINE-009.A4 -->
- When `context_window.used_percentage` is absent or null, the `CTX` element is omitted entirely (no bar, no warning) and the rest of the segment renders unchanged.
<!-- id: REQ-STATUSLINE-009.A5 -->
- Under `NO_COLOR`, the `CTX` element (bar, percentage, and any warning hint) contains no ANSI escape sequences.
<!-- id: REQ-STATUSLINE-009.A6 -->
- Rendering the `CTX` element opens no SQLite connection, spawns no child process, and performs no network I/O (same bounded-read budget as REQ-STATUSLINE-002).

<!-- id: REQ-STATUSLINE-010 -->
## The segment MUST stack its lines in a fixed order: header, then identity, then telemetry

The output is composed of up to three stacked lines, always in this order: the
optional context header (model / directory / branch / version,
REQ-STATUSLINE-012); the SpecShip identity line (brand ornament, sync state,
drift, call count, active run); and the optional capacity telemetry line (the
`CTX` context bar and the `5h`/`7d` usage-limit bars). The identity line is
always present. Each optional line renders only when it has content, and absent
lines collapse so there is never a leading, trailing, or interior blank line.
The glyph vocabulary (`◈`, `◆`, `❮▰▱❯`) is unchanged.

## Acceptance
<!-- id: REQ-STATUSLINE-010.A1 -->
- The identity line is always present; the header stacks directly above it and the telemetry line directly below it, each only when it has content.
<!-- id: REQ-STATUSLINE-010.A2 -->
- With neither a header nor telemetry, the output is a single line with no newline.
<!-- id: REQ-STATUSLINE-010.A3 -->
- Present lines are separated by exactly one newline with no blank line between or around them (header + identity + telemetry ⇒ exactly two newlines; identity + telemetry, or header + identity ⇒ exactly one).

implementations:
  - src/statusline/render.ts:renderSegment

<!-- id: REQ-STATUSLINE-011 -->
## The active-run element MUST carry the run's remaining-time estimate

When the active workflow run has a time-to-completion estimate
(WORKFLOW-ETA-DOC), the first line's run element appends it — a compact
range for a running run (e.g. `≈4–11m left`), or a waiting-on-you signal for
a run paused at an approval gate. The estimate is computed and embedded when
the run marker is written (at run/step transitions), NEVER on the render
path — rendering still opens no SQLite connection (REQ-STATUSLINE-002's
budget). No estimate in the marker → the run element renders exactly as
before.

## Acceptance
<!-- id: REQ-STATUSLINE-011.A1 -->
- A marker carrying a range estimate renders the run element with a `≈low–high` suffix; equal bounds collapse to one value.
<!-- id: REQ-STATUSLINE-011.A2 -->
- A marker for a paused run carrying the waiting signal renders `waiting on you` in place of a range.
<!-- id: REQ-STATUSLINE-011.A3 -->
- A marker without an estimate field (older writer) renders the run element unchanged — no placeholder.

implementations:
  - src/statusline/render.ts:renderSegment
  - src/statusline/active-run.ts:writeActiveRun
  - src/workflows/executor.ts:WorkflowExecutor.syncActiveRunMarker

<!-- id: REQ-STATUSLINE-012 -->
## The segment MUST prepend a context header line: model, working directory, git branch, and Claude Code version

Above the SpecShip identity line, the segment renders a context header that
orients the user to the current session at a glance. It carries, in order and
each omitted individually when its source is absent: the active model's name
(Claude Code's stdin `model.display_name`, falling back to `model.id`); the
current working directory (from `workspace.current_dir` / `cwd`, with the user's
home directory abbreviated to `~`); the current git branch; and the Claude Code
version (stdin `version`, shown as `v<version>`). The header uses the same
art-deco vocabulary (`◈`/`◆`) as the rest of the segment and strips all ANSI
under `NO_COLOR` (REQ-STATUSLINE-001.A4).

The git branch is derived WITHOUT spawning a process (the REQ-STATUSLINE-002
performance contract): the reader walks up from the working directory to the
nearest `.git`, follows a linked-worktree `.git` file's `gitdir:` pointer, and
reads `HEAD` — reporting the branch name for a `ref: refs/heads/…` HEAD, a short
commit SHA for a detached HEAD, and omitting the branch entirely when the
directory is not inside a git repository. This `.git/HEAD` read is the only
source consulted for the branch; Claude Code's stdin does not carry it.

The header is a real-session affordance: it renders only when stdin actually
identifies the session (a `model` or `version` is present). Empty or unparseable
stdin therefore renders NO header, preserving the single degraded line of
REQ-STATUSLINE-001.A2. When the header renders it stacks ABOVE the identity line
(REQ-STATUSLINE-010), so the SpecShip identity and telemetry lines keep their
existing content unchanged, now on the second and third lines.

implementations:
  - src/statusline/render.ts:renderSegment
  - src/statusline/index.ts:buildSegment
  - src/statusline/index.ts:identityFromInput
  - src/statusline/index.ts:readGitBranch

## Acceptance
<!-- id: REQ-STATUSLINE-012.A1 -->
- Given stdin carrying `model`, `workspace.current_dir`, and `version`, the first output line shows the model name, the working directory (home abbreviated to `~`), and the version (`v<version>`), stacked directly above the SpecShip identity line.
<!-- id: REQ-STATUSLINE-012.A2 -->
- When the working directory is inside a git repository checked out on a branch, the header includes that branch name; a detached HEAD shows a short commit SHA instead; a non-git directory omits the branch element with no placeholder.
<!-- id: REQ-STATUSLINE-012.A3 -->
- Deriving the branch opens no SQLite connection, spawns no child process, and performs no network I/O — it reads only `.git/HEAD` (and, for a linked worktree, the `.git` pointer file) via bounded file reads.
<!-- id: REQ-STATUSLINE-012.A4 -->
- Each header element is omitted individually when its source is absent (e.g. a missing `model` drops only the model element); the header never renders a dangling separator or empty ornament.
<!-- id: REQ-STATUSLINE-012.A5 -->
- Empty or unparseable stdin renders no header line at all — the degraded output stays a single line (REQ-STATUSLINE-001.A2).
<!-- id: REQ-STATUSLINE-012.A6 -->
- Under `NO_COLOR`, the header line contains no ANSI escape sequences.
