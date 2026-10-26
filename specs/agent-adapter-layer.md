---
id: AGENTADAPT-DOC
title: Agent-adapter layer — host specifics behind one seam
owner: specship-core
priority: high
version: 1
brief: agent-adapter-layer/brief.md
jira_issue_REQ-AGENTADAPT-001: SSHIP-363
jira_fingerprint_REQ-AGENTADAPT-001: 087cbddde8c81133
jira_issue_REQ-AGENTADAPT-002: SSHIP-367
jira_fingerprint_REQ-AGENTADAPT-002: e5906fcf8305f685
jira_issue_REQ-AGENTADAPT-003: SSHIP-370
jira_fingerprint_REQ-AGENTADAPT-003: 0aba1c90126042ab
jira_issue_REQ-AGENTADAPT-004: SSHIP-373
jira_fingerprint_REQ-AGENTADAPT-004: dc6d9b21971f48c1
---

<!-- id: AGENTADAPT-DOC -->
# Agent-adapter layer — host specifics behind one seam

CLAUDE.md's house rule (2026-10-26) says shared code is agent-agnostic: the
engine, MCP server, spec layer, steering logic and CLI must not hard-code one
coding agent's event names, tool-name prefixes, transcript formats or config
paths. Host specifics live only in the installer targets and the hook I/O
adapter (`src/activation/hook-output.ts`). This document makes that rule
enforceable and fixes the places that already break it.

Audit (2026-10-26, `src/` minus `src/installer/targets/`): the steering
nudge text names `mcp__specship__specship_explore` — Claude's qualified tool
name — and since REQ-GEMINI-010 that text is also injected into Gemini CLI
sessions, where the tool is `specship_explore`. Hook commands pass Claude
event names (`UserPromptSubmit`, `PreToolUse`) as literal fallbacks in the
CLI, and the search interceptor defaults to Claude's tool marker.

Non-goals: per-host analytics ingest (dashboard transcript features stay
Claude-only — 2026-09 pivot, phase D, uncontracted); new install targets
(governed by the separate install-target house rule); retiring the
`.claude/`-path users in `src/reflect/` and `src/claudemd/` (classified as
Claude-scoped below, not migrated here).

<!-- id: REQ-AGENTADAPT-001 -->
## Agent-facing text MUST name SpecShip tools in the calling host's form

Every string SpecShip injects into an agent's context (the steering nudge in
both tiers, the search-interceptor line) MUST name SpecShip tools using the
calling host's tool-name form, supplied by the hook adapter: Claude Code's
`mcp__specship__<tool>`, Gemini CLI's bare `<tool>`. Claude Code output MUST
stay byte-identical to today's (the steering wording is A/B-gated —
REQ-STEER-003 — so it may not drift as a side effect).

implementations:
  - src/activation/steering.ts:buildSteeringNudge
  - src/activation/steering.ts:renderSteering
  - src/activation/hook-output.ts:deriveHostTraits

verifies:
  - __tests__/agent-adapter.test.ts:claudeSteeringTextIsByteIdentical
  - __tests__/agent-adapter.test.ts:geminiSteeringNamesTheBareTool
  - __tests__/agent-adapter.test.ts:liteTierFollowsTheHostToolForm

## Acceptance
<!-- id: REQ-AGENTADAPT-001.A1 -->
- For a Claude payload (or one with no event name), the standard and lite steering texts are byte-identical to the pre-change `STEERING_TEXT` / `STEERING_TEXT_LITE`.
<!-- id: REQ-AGENTADAPT-001.A2 -->
- For a Gemini payload, the steering text names `specship_explore` and contains no `mcp__specship__` substring, in both tiers.
<!-- id: REQ-AGENTADAPT-001.A3 -->
- No steering or interceptor text is emitted to Gemini that names a tool Gemini does not expose under that name.

<!-- id: REQ-AGENTADAPT-002 -->
## Host traits MUST have a single source in the hook adapter

`src/activation/hook-output.ts` MUST be the only module that maps a hook
payload to host traits (tool-name prefix, specship tool markers, transcript
format, deny support, the fallback event name used when a payload names
none). Shared modules — the steering and interceptor logic and the CLI hook
commands — MUST take those traits as inputs and MUST NOT default to, or
compare against, a host-specific literal themselves.

implementations:
  - src/activation/hook-output.ts:deriveHostTraits
  - src/activation/search-intercept.ts:buildSearchIntercept

verifies:
  - __tests__/agent-adapter.test.ts:traitsComeOnlyFromTheAdapter
  - __tests__/agent-adapter.test.ts:payloadWithoutEventNameGetsLegacyTraits

## Acceptance
<!-- id: REQ-AGENTADAPT-002.A1 -->
- `deriveHostTraits` returns, per host, the tool-name prefix, the specship tool markers, the transcript format, deny support and the fallback event names; the CLI hook commands read their fallback event name from it rather than passing a literal.
<!-- id: REQ-AGENTADAPT-002.A2 -->
- A payload with no `hook_event_name` resolves to the legacy (Claude Code) traits, so existing Claude installs behave exactly as before.

<!-- id: REQ-AGENTADAPT-003 -->
## A guard test MUST fail when shared code hard-codes a host-specific name

A test MUST scan `src/**/*.ts` code lines (comments excluded) for host
event names (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `BeforeAgent`,
`BeforeTool`, `AfterTool`) and SpecShip tool-name prefixes
(`mcp__specship__`) and fail on any occurrence outside an explicit
allowlist. The allowlist MUST name each entry with a one-line reason and
contains exactly: the installer targets (`src/installer/`), the hook adapter
(`src/activation/hook-output.ts`), and the Claude-scoped modules of
REQ-AGENTADAPT-004.

implementations:
  - __tests__/agent-adapter.test.ts:HOST_SPECIFIC_ALLOWLIST

verifies:
  - __tests__/agent-adapter.test.ts:sharedCodeHasNoHostSpecificNames

## Acceptance
<!-- id: REQ-AGENTADAPT-003.A1 -->
- The guard passes on the tree after this change and fails (naming file and line) when a host event name or `mcp__specship__` is added to a non-allowlisted module.
<!-- id: REQ-AGENTADAPT-003.A2 -->
- Every allowlist entry carries a reason string; an entry without one fails the test.

<!-- id: REQ-AGENTADAPT-004 -->
## Claude-scoped modules SHOULD be declared, not silently exempt

Some modules are Claude-only by decision, not by accident, and SHOULD be
recorded as such in the guard's allowlist: Claude transcript analytics
(`src/analytics/`, and the `claude_tool_calls` migration in
`src/db/migrations.ts`) — per-host ingest is uncontracted (phase D); the
CLAUDE.md governance audit (`src/claudemd/`) — Claude-specific per
GEMINI-TARGET-DOC; the reflection lanes that propose Claude hook/settings
edits (`src/reflect/`). Migrating any of these is separate work with its own
spec. `.claude/` config-path users are inventoried here
(`src/bin/specship.ts`, `src/index.ts`, `src/sync/worktree.ts`,
`src/reflect/*`, `src/claudemd/audit.ts`, `src/installer/*`) but are not yet
guarded. [needs review: extend the guard to config paths once reflect and
claudemd are host-parameterized]

## Acceptance
<!-- id: REQ-AGENTADAPT-004.A1 -->
- The allowlist lists `src/analytics/`, `src/db/migrations.ts`, `src/claudemd/` and `src/reflect/` with reasons matching this requirement.
<!-- id: REQ-AGENTADAPT-004.A2 -->
- Removing an allowlisted module's host-specific usage does not require touching the guard (an allowlist entry with no remaining matches does not fail).
