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
jira_fingerprint_REQ-AGENTADAPT-003: f87fbd428ce0788b
jira_issue_REQ-AGENTADAPT-004: SSHIP-373
jira_fingerprint_REQ-AGENTADAPT-004: c791de9f1bfa0db5
jira_issue_REQ-AGENTADAPT-005: SSHIP-484
jira_fingerprint_REQ-AGENTADAPT-005: df9129d43a33a271
jira_issue_REQ-AGENTADAPT-006: SSHIP-488
jira_fingerprint_REQ-AGENTADAPT-006: f0cc08be444bb130
jira_issue_REQ-AGENTADAPT-007: SSHIP-494
jira_fingerprint_REQ-AGENTADAPT-007: 3d65e6513967d4d2
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
  - __tests__/agent-adapter.test.ts:allowlistEntriesCarryReasons

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

verifies:
  - __tests__/agent-adapter.test.ts:claudeScopedModulesAreDeclared
  - __tests__/agent-adapter.test.ts:unusedAllowlistEntryDoesNotFail

## Acceptance
<!-- id: REQ-AGENTADAPT-004.A1 -->
- The allowlist lists `src/analytics/`, `src/db/migrations.ts`, `src/claudemd/` and `src/reflect/` with reasons matching this requirement.
<!-- id: REQ-AGENTADAPT-004.A2 -->
- Removing an allowlisted module's host-specific usage does not require touching the guard (an allowlist entry with no remaining matches does not fail).

<!-- id: REQ-AGENTADAPT-005 -->
## Workflow prompt steps MUST run through a per-host headless-agent adapter

Audit (2026-10-27): the workflow engine's prompt runner spawns the Claude CLI
directly — its binary, flags, tool names, system-prompt flag and stream
format are hard-coded in shared code — so `/specship:spec implement` launched
from Gemini CLI still needs Claude Code. A prompt step MUST instead be handed
to a headless-agent adapter that owns one host's binary, argument
translation and output parsing, and returns the same step result (final
text, live tool-call and message events, optional stats) whatever the host.
Shared workflow code MUST NOT name a host binary or host flag. Claude Code
stays the behaviour-identical default: the arguments it receives for a given
step MUST NOT change.

implementations:
  - src/workflows/agents/index.ts:getHeadlessAgent
  - src/workflows/agents/claude.ts:claudeHeadlessAgent
  - src/workflows/runners/prompt.ts:PromptRunner.run

verifies:
  - __tests__/workflow-headless-agents.test.ts:claudeArgsAreUnchanged
  - __tests__/workflow-headless-agents.test.ts:promptRunnerUsesTheRunAgent
  - __tests__/agent-adapter.test.ts:workflowCodeNamesNoHostBinary

## Acceptance
<!-- id: REQ-AGENTADAPT-005.A1 -->
- For a step with a model, allowed tools, denied tools and an appended system prompt, the Claude adapter produces exactly the argument list the runner produced before this change.
<!-- id: REQ-AGENTADAPT-005.A2 -->
- The prompt runner spawns the binary and arguments of the run's selected adapter and parses that adapter's output, so the same step yields the same completed text whichever host ran it.
<!-- id: REQ-AGENTADAPT-005.A3 -->
- A guard test fails when code under `src/workflows/` outside `src/workflows/agents/` names a host binary or a host-only flag.

<!-- id: REQ-AGENTADAPT-006 -->
## The workflow agent MUST be chosen deterministically and recorded on the run

The agent that runs a workflow's prompt steps MUST be resolved once, at run
start, in this order: the `--agent` flag, the `SPECSHIP_WORKFLOW_AGENT`
environment variable, `workflow.agent` in `specship.config.json`, the coding
agent that launched the command (detected by its adapter from the
environment it sets for child processes), then Claude Code. The choice MUST
be stored with the run so approve, reject-revise and resume use the same
agent even when issued from a different shell. An unknown agent name MUST
fail the launch before any step runs, naming the known agents; a selected
agent whose binary cannot be started MUST fail the first prompt step with an
error naming the binary and the `--agent` override.

implementations:
  - src/workflows/agents/index.ts:resolveWorkflowAgent
  - src/workflows/executor.ts:WorkflowExecutor.start
  - src/bin/specship.ts

verifies:
  - __tests__/workflow-headless-agents.test.ts:agentResolutionOrder
  - __tests__/workflow-headless-agents.test.ts:launchingHostIsDetected
  - __tests__/workflow-headless-agents.test.ts:agentIsRecordedOnTheRun
  - __tests__/workflow-headless-agents.test.ts:unknownAgentFailsBeforeAnyStep
  - __tests__/workflow-headless-agents.test.ts:missingBinaryNamesTheOverride

## Acceptance
<!-- id: REQ-AGENTADAPT-006.A1 -->
- With all sources set to different agents the flag wins; removing each source in turn falls through to the next in the stated order, ending at Claude Code.
<!-- id: REQ-AGENTADAPT-006.A2 -->
- A command launched from inside a Gemini CLI shell, with no flag, env or config, selects the Gemini adapter.
<!-- id: REQ-AGENTADAPT-006.A3 -->
- The selected agent is stored in the run's metadata, and a resumed or revised step uses it regardless of the resuming shell's environment. (evidence: unit)
<!-- id: REQ-AGENTADAPT-006.A4 -->
- `--agent codex` (or any name with no adapter) exits non-zero before a run is created, listing the known agents.
<!-- id: REQ-AGENTADAPT-006.A5 -->
- When the selected agent's binary is not on PATH, the first prompt step fails with a message naming the binary and `--agent`, and is not retried as transient.

<!-- id: REQ-AGENTADAPT-007 -->
## The Gemini CLI adapter MUST translate a step faithfully or refuse it

The Gemini adapter runs a step in Gemini CLI's headless mode with
stream-json output, verified against the installed 0.28.0 source
(DOM-SPECSHIP-008). Allowed tools MUST be translated to Gemini's names
(Claude-form built-ins to `read_file`, `write_file`, `replace`,
`run_shell_command`, `glob`, `grep_search`; `mcp__specship__<tool>` to
`specship__<tool>`; `Bash(<prefix>:*)` to `run_shell_command(<prefix>)`),
because headless Gemini removes every approval-needing tool not on the list.
The appended system prompt MUST be delivered ahead of the step prompt, since
Gemini has no append flag. A model tier alias (`haiku`, `sonnet`, `opus`)
MUST map through `workflow.agents.gemini.models` in config, and with no
mapping the flag is omitted so Gemini's own default model runs — a Claude
model id is never passed to Gemini. A step the adapter cannot translate —
an allowed tool with no Gemini equivalent, or any `denied_tools` (Gemini's
headless mode has no deny flag) — MUST fail with the untranslatable item
named, never run with the feature silently dropped. Not contracted: a live
Gemini run (the eval harness stays the measurement bar, REQ-THRU-012).

implementations:
  - src/workflows/agents/gemini.ts:geminiHeadlessAgent
  - src/workflows/agents/gemini.ts:translateGeminiTools
  - src/workflows/agents/gemini.ts:handleGeminiStreamLine

verifies:
  - __tests__/workflow-headless-agents.test.ts:geminiToolsAreTranslated
  - __tests__/workflow-headless-agents.test.ts:geminiSystemPromptLeadsTheStdin
  - __tests__/workflow-headless-agents.test.ts:geminiModelTiersMapThroughConfig
  - __tests__/workflow-headless-agents.test.ts:geminiUntranslatableStepFails
  - __tests__/workflow-headless-agents.test.ts:geminiStreamIsParsed

## Acceptance
<!-- id: REQ-AGENTADAPT-007.A1 -->
- `Read, Write, Edit, Bash, Glob, Grep, mcp__specship__specship_spec, Bash(git status:*)` translate to `read_file, write_file, replace, run_shell_command, glob, grep_search, specship__specship_spec, run_shell_command(git status)`.
<!-- id: REQ-AGENTADAPT-007.A2 -->
- The step's stdin carries the appended system prompt first and the step prompt after it; no append-system-prompt flag is passed.
<!-- id: REQ-AGENTADAPT-007.A3 -->
- `model: haiku` with a configured mapping passes that Gemini model id; with no mapping, or with a Claude model id, no model flag is passed.
<!-- id: REQ-AGENTADAPT-007.A4 -->
- A step allowing a tool with no Gemini equivalent, or declaring `denied_tools`, fails before spawning, naming the item.
<!-- id: REQ-AGENTADAPT-007.A5 -->
- Recorded Gemini stream-json lines yield tool-call and message events, the concatenated assistant messages as the step's text, the init model and duration as stats, and a failed step when the result status is `error`.
