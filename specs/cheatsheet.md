---
id: CHEATSHEET-DOC
title: Session cheat-sheet
owner: installer
priority: medium
version: 1
---

<!-- id: CHEATSHEET-DOC -->
# Session cheat-sheet

SpecShip's agent-facing guidance ships in the MCP `initialize` response, so
Claude always knows how to drive the tools. The *human* driving the session has
no equivalent — the surface (the four doors, JIRA, the drift/health gate,
lessons/memory, the verify chain) is discoverable only by reading docs. This
document ships a short, human-readable cheat-sheet at session start so a user
learns what SpecShip can do without leaving the terminal.

The mechanism is a new `specship cheatsheet` command wired into a `SessionStart`
hook, mirroring how every other SpecShip hook already runs a `specship`
subcommand (`sync`, `spec-nudge`, `steer-nudge`) rather than a shell script — a
script would not run on Windows.

Scope boundaries. This is distinct from two existing features and must not be
folded into either: (1) `starter-prompt` (REQ-ACTIVATION-002) generates a
*dynamic* first-run flow prompt and self-silences once retrieval is used — this
cheat-sheet is a *static* capability map; the two coexist. (2) The dashboard's
improvement tips (`claude_tip_state`, REQ-DESKTOP-020) are an unrelated feature
that happens to use the word "tips". Also out of scope: injecting the
cheat-sheet into the agent's context (the MCP `initialize` guidance already
covers the agent) and any blocking behaviour. Noise is the main risk, so output
is bounded to session *startup* (not resume) and is suppressible.

<!-- id: REQ-CHEAT-001 -->
## A `specship cheatsheet` command MUST emit a user-visible session cheat-sheet

Running `specship cheatsheet` prints a `SessionStart`-hook-compatible payload
whose `systemMessage` is the SpecShip cheat-sheet, so the harness renders it to
the user in the terminal. The command is part of the shipped CLI and runs on
every platform SpecShip supports without depending on a shell interpreter.

implementations:
  - src/activation/cheatsheet.ts:buildCheatsheetPayload

## Acceptance
<!-- id: REQ-CHEAT-001.A1 -->
- `specship cheatsheet` exits 0 and writes to stdout a single JSON object
  carrying a non-empty `systemMessage` string (the `SessionStart` hook contract
  for user-visible output).
<!-- id: REQ-CHEAT-001.A2 -->
- The payload contains no agent-context field (e.g. `additionalContext`) — the
  cheat-sheet is for the human only, not injected into Claude's context.
<!-- id: REQ-CHEAT-001.A3 -->
- The command produces the same output on macOS, Linux, and Windows — it is a
  first-class CLI subcommand, not a wrapper around a `.sh` script.

<!-- id: REQ-CHEAT-002 -->
## The cheat-sheet MUST cover SpecShip's core session surfaces

The message names the capabilities a user needs to start driving SpecShip, so
the cheat-sheet is a map of the product, not a single tip.

implementations:
  - src/activation/cheatsheet.ts:CHEATSHEET_TEXT

## Acceptance
<!-- id: REQ-CHEAT-002.A1 -->
- The message references all four doors — explore, spec, check, and learn.
<!-- id: REQ-CHEAT-002.A2 -->
- The message references the retrieval flow (explore-first), the JIRA surface,
  the drift/health gate, lessons/memory, and the verify chain.
<!-- id: REQ-CHEAT-002.A3 -->
- The message names only user-facing commands, tools, and env vars — no
  internal file paths, symbol names, or benchmark figures.

<!-- id: REQ-CHEAT-003 -->
## The cheat-sheet MUST print only on session startup, never on resume

The hook fires the cheat-sheet when a session first starts, not when an existing
session resumes, so a user resuming work is not shown the same map repeatedly.

implementations:
  - src/installer/targets/claude.ts:SPECSHIP_HOOKS

## Acceptance
<!-- id: REQ-CHEAT-003.A1 -->
- The registered `SessionStart` hook matches `startup` and does not match
  `resume`.
<!-- id: REQ-CHEAT-003.A2 -->
- Resuming a session emits no cheat-sheet output.

<!-- id: REQ-CHEAT-004 -->
## Cheat-sheet output MUST be suppressible via an environment opt-out

A user who has learned the surface can silence the cheat-sheet without editing
their hook config, matching the existing `SPECSHIP_NO_STEERING` opt-out.

implementations:
  - src/activation/cheatsheet.ts:buildCheatsheetPayload

## Acceptance
<!-- id: REQ-CHEAT-004.A1 -->
- With `SPECSHIP_NO_CHEATSHEET=1` set, `specship cheatsheet` emits no
  `systemMessage` and the session start is silent.
<!-- id: REQ-CHEAT-004.A2 -->
- With the variable unset or empty, the cheat-sheet prints normally.

<!-- id: REQ-CHEAT-005 -->
## The installer MUST register the startup cheat-sheet hook, and uninstall MUST remove it

`specship install` writes the `SessionStart` cheat-sheet hook alongside the
existing auto-sync hooks, and `specship uninstall` removes exactly what install
added, so the machine returns to its prior state.

implementations:
  - src/installer/targets/claude.ts:writeHooksEntry

## Acceptance
<!-- id: REQ-CHEAT-005.A1 -->
- After `install` with auto-allow, `settings.json` contains a `SessionStart`
  hook running `specship cheatsheet` with a `startup` matcher.
<!-- id: REQ-CHEAT-005.A2 -->
- Re-running `install` with the hook already present reports `unchanged` and
  does not duplicate the hook (idempotent, byte-equal re-run).
<!-- id: REQ-CHEAT-005.A3 -->
- After `uninstall`, the cheat-sheet hook is gone and no other user-authored
  hook in `settings.json` is disturbed.

<!-- id: REQ-CHEAT-006 -->
## The shipped plugin package MUST register the same startup cheat-sheet hook

The plugin's bundled `hooks/hooks.json` carries the identical `SessionStart`
cheat-sheet hook, so a plugin-based install and a CLI `install` provision the
same behaviour and cannot drift apart.

implementations:

## Acceptance
<!-- id: REQ-CHEAT-006.A1 -->
- `hooks/hooks.json` declares a `SessionStart` hook running `specship cheatsheet`
  with a `startup` matcher.
<!-- id: REQ-CHEAT-006.A2 -->
- The hook command in `hooks/hooks.json` matches the command the installer
  writes, verified by a test that reads both sources.

<!-- id: REQ-CHEAT-007 -->
## This repository MUST dogfood the shipped command

Once `specship cheatsheet` exists, this repo's own session-start hook points at
it instead of the local `.claude/hooks/specship-tips.sh`, so there is a single
source of the cheat-sheet text and no divergence between what maintainers see
and what ships.

implementations:

## Acceptance
<!-- id: REQ-CHEAT-007.A1 -->
- This repo's `.claude/settings.json` `SessionStart` hook runs
  `specship cheatsheet`.
<!-- id: REQ-CHEAT-007.A2 -->
- The standalone `.claude/hooks/specship-tips.sh` is removed.
