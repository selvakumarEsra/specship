---
title: Steering & session start
description: How SpecShip keeps Claude Code reaching for the code graph — the per-prompt nudge, the point-of-use search reminder, the session-start cheatsheet, and the status-line tips — and how to turn each off.
---

SpecShip is only useful if the agent actually calls it. Left alone, a model
falls back to `Read` and `Grep` out of habit. `specship install` therefore adds
a few small, advisory nudges to Claude Code. None of them blocks anything, all
of them only speak in a project that has a SpecShip index, and each has its
own off switch.

| Nudge | When it speaks | Turn it off |
|---|---|---|
| [Per-prompt steering](#per-prompt-steering) | Every prompt you submit | `SPECSHIP_NO_STEERING=1` |
| [Search reminder](#point-of-use-search-reminder) | The first `Grep`/`Glob` of a session that hasn't used SpecShip yet | `SPECSHIP_NO_STEERING=1` |
| [Session-start cheatsheet](#session-start-cheatsheet) | Once, when a new session starts (not on resume) | `SPECSHIP_NO_CHEATSHEET=1` |
| [Status-line tips](#status-line-tips) | Continuously, under the status-line metrics | `SPECSHIP_NO_STATUSLINE_TIPS=1` |

`specship uninstall` removes all of the hooks together with the rest of the
wiring.

## Per-prompt steering

A `UserPromptSubmit` hook (`specship steer-nudge`) adds one short line to each
prompt reminding Claude Code to call `specship_explore` with the relevant
symbol or file names **before** reading or editing code — for understanding,
implementing, fixing, and refactoring alike — and to treat the source it
returns as already read.

On a [lightweight model](/claude-code/low-end-models/) the line becomes a
stricter do-this template: one `specship_explore` call, answer from its
output, don't spawn subagents, don't re-read files the tool returned.

## Point-of-use search reminder

The prompt-level nudge fades over a long turn — the agent often reaches for a
raw search many tool calls later. A `PreToolUse` hook on `Grep` and `Glob`
(`specship search-intercept`) catches that moment and adds a one-line
reminder that `specship_explore` usually answers in one call.

It is deliberately gentle:

- **Advisory only.** The search always runs — the reminder is added context,
  never a denial.
- **At most once per session.**
- **Quiet in sessions already using SpecShip.** If the session has made any
  SpecShip tool call, it never fires.

It shares the `SPECSHIP_NO_STEERING=1` opt-out with the per-prompt nudge.

### Gemini CLI (REQ-GEMINI-011)

A Gemini install writes `BeforeTool` matchers for the same purpose on three
tools: `grep_search`, `glob`, and `run_shell_command`. For `run_shell_command`
the hook inspects the first pipeline segment and only acts when it starts
with a code-search program (`grep`, `rg`, `ag`, `ack`, `fd`, `find`,
`git grep`) — `npm test | grep FAIL`, `git status`, `ls`, `cat`, `sed -n` are
left alone.

Two modes:

- **Advisory (default).** Same contract as Claude's reminder — one
  `additionalContext` line pointing at `specship_explore`, at most once per
  session, silent once the session has used SpecShip. The call still runs.
- **Strict (`SPECSHIP_GEMINI_STRICT=1`, env > project > install settings).**
  For a `grep_search` or `glob` call in an indexed project, SpecShip returns
  a top-level `{decision: "deny"}` with a reason naming `specship_explore`
  and the search pattern. Strict NEVER denies `run_shell_command`: Gemini
  fires `BeforeTool` only after the user's shell confirmation prompt, so a
  deny there would make the user approve a command and then watch it get
  blocked — a search-shaped shell command gets the advisory line in both
  modes. Parse-failure on the transcript, an unindexed project, or a
  session already using SpecShip all ALLOW the call.

Neither mode suppresses Gemini's shell confirmation prompt — the hook runs
after it. Strict mode only redirects Gemini's built-in `grep_search` and
`glob` tools.

## Session-start cheatsheet

When a new session starts, `specship cheatsheet` prints a one-screen guide:
the four doors (`/specship:explore`, `/specship:spec`, `/specship:check`,
`/specship:learn`), explore-first retrieval, JIRA, the drift/health gate,
lessons and memory, and the verify chain. It prints on startup only, not when
you resume a session.

Two lines appear only when they have something to say:

- **Project conventions** — the rules you've applied from the
  [style lane](/claude-code/improvements/#project-conventions), read from
  `.specship/conventions.md` (at most 8, then a `+N more` pointer).
- **Learned proposals awaiting review** — a count of open
  [reflection proposals](/claude-code/improvements/), so the queue is
  discovered without opening anything.

## Status-line tips

If you use SpecShip's status-line segment (added by `specship install` unless
you pass `--skip-statusline`; an existing status line is never overwritten),
it shows a header line (model, working directory, git branch, Claude Code
version), the SpecShip index and call metrics, and a rotating one-line usage
tip below them — what `specship_explore`, `specship_impact`, and the spec
commands can do — cycling on a timer.

When SpecShip has switched to compact output for a smaller model, the status
line also shows a dim **`optimizing for Lite`** or **`optimizing for
Standard`** note. It disappears on a frontier model or with
`SPECSHIP_COMPACT=0`. See [Low-end models](/claude-code/low-end-models/).

## Setting the switches

Every switch above is an environment variable, but you don't have to export
it in your shell. The steering, compaction, and model-tier switches can also
live in a SpecShip settings file, keyed by the variable name:

```json
{ "SPECSHIP_NO_STEERING": "1" }
```

- `<repo>/.specship/settings.json` — per project, travels with the repo
- `~/.specship/settings.json` — machine-wide

An actual environment variable wins over the project file, which wins over
the machine file. See [Configuration](/getting-started/configuration/) for the
full list.
