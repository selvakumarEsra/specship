---
id: GEMINI-TARGET-DOC
title: Agent-agnostic SpecShip — Google Gemini CLI target
owner: selvakumar [needs user confirmation]
priority: high
version: 1
jira_issue_REQ-GEMINI-001: SSHIP-46
jira_fingerprint_REQ-GEMINI-001: 3e87e343e387ddbe
jira_issue_REQ-GEMINI-002: SSHIP-50
jira_fingerprint_REQ-GEMINI-002: 80f873d64381857c
jira_issue_REQ-GEMINI-003: SSHIP-55
jira_fingerprint_REQ-GEMINI-003: 7512a4f8dbe0f3fe
jira_issue_REQ-GEMINI-004: SSHIP-58
jira_fingerprint_REQ-GEMINI-004: 8c670887ce8247da
jira_issue_REQ-GEMINI-005: SSHIP-61
jira_fingerprint_REQ-GEMINI-005: dde32fd0d774fa74
jira_issue_REQ-GEMINI-006: SSHIP-64
jira_fingerprint_REQ-GEMINI-006: 3f684dd984a9a430
jira_issue_REQ-GEMINI-007: SSHIP-68
jira_fingerprint_REQ-GEMINI-007: 761be48e4b321386
jira_issue_REQ-GEMINI-008: SSHIP-73
jira_fingerprint_REQ-GEMINI-008: 4d4e35f023392939
jira_issue_REQ-GEMINI-009: SSHIP-64
jira_fingerprint_REQ-GEMINI-009: 4fc822fee7260a63
jira_issue_REQ-GEMINI-010: SSHIP-70
jira_fingerprint_REQ-GEMINI-010: e21277e9ac5e73b8
jira_issue_REQ-GEMINI-011: SSHIP-76
jira_fingerprint_REQ-GEMINI-011: ceb5d564ce8e42b3
---

<!-- id: GEMINI-TARGET-DOC -->
# Agent-agnostic SpecShip — Google Gemini CLI target

SpecShip's engine (extraction, graph, MCP server) is already agent-neutral;
only the periphery is coupled to Claude Code. This document contracts the
ratified Phases 0–2 of Gemini support: documenting manual Gemini CLI MCP
setup, adding a `gemini` installer target behind the existing `AgentTarget`
abstraction, and making the model-compaction tier system provider-neutral.

Out of scope (future phases, not contracted here): client-aware MCP server
instructions (Phase 3) and dashboard transcript-ingest adapters for Gemini
sessions (Phase 4). The `src/claudemd/` audit remains Claude-specific.

Phase 1b (2026-10-26, REQ-GEMINI-009–011, REQ-GEMINI-004 revised): make
Gemini prefer SpecShip — GEMINI.md steering, prompt/session/tool hooks
mapped onto Gemini's hook events, and an opt-in read-only auto-approval
policy for SpecShip's own tools. Non-goal: bypassing or weakening an
administrator's Gemini policy, including its `run_shell_command` rule.
SpecShip never calls an LLM itself — "agnostic" here means agent-host and
model-family agnostic, not a Gemini API integration.

Positioning note: this supersedes the "Claude Code only — don't add agent
targets" house rule in `CLAUDE.md` for the Gemini target specifically
(explicit user ask, 2026-08-22). The CLAUDE.md house rule MUST be amended in
the same change that lands REQ-GEMINI-002.

<!-- id: REQ-GEMINI-001 -->
## Phase 0 — Manual Gemini CLI setup MUST be documented and printable

Before any installer work ships, a Gemini CLI user MUST be able to wire the
SpecShip MCP server by hand. `specship install --print-config` (or an
equivalent flag targeting gemini) MUST emit the JSON snippet for Gemini CLI's
`mcpServers` settings block, and the README/docs MUST carry the same snippet
with the settings-file location. The snippet MUST NOT be invented from memory
at implementation time — verify the current Gemini CLI settings schema
(`~/.gemini/settings.json`, `mcpServers` key) against Gemini CLI's released
docs.

Verified against **Gemini CLI 0.56.0** (npm `@google/gemini-cli`, latest on
2026-08-22; cross-checked against 0.28.0) by reading the released package's
`config/settingsSchema.js` and `MCPServerConfig`: settings key `mcpServers`,
stdio fields `command` / `args` / `env` / `cwd`, and `type` restricted to
`'sse' | 'http'` — so the Claude entry's `type: 'stdio'` is NOT carried over;
a stdio server is identified by having `command`. Settings locations are
`~/.gemini/settings.json` (global) and `<project>/.gemini/settings.json`.

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget.printConfig
  - src/installer/targets/gemini.ts:settingsPath
  - src/installer/targets/gemini.ts:GeminiCliTarget

verifies:
  - __tests__/installer-targets.test.ts:geminiPrintConfigWritesNothing
  - __tests__/installer-targets.test.ts:geminiPrintConfigMatchesClaudeCommand
  - __tests__/installer-targets.test.ts:geminiPrintConfigNamesSettingsPath

## Acceptance
<!-- id: REQ-GEMINI-001.A1 -->
- Printing the Gemini config touches no files on disk (same contract as
  `AgentTarget.printConfig`).
<!-- id: REQ-GEMINI-001.A2 -->
- The printed snippet, pasted verbatim into Gemini CLI's settings file, yields
  a working `specship` MCP server entry (command + args identical to what the
  Claude target's MCP entry launches).
<!-- id: REQ-GEMINI-001.A3 -->
- README/docs describe both global and per-project placement of the snippet.

<!-- id: REQ-GEMINI-002 -->
## Phase 1 — A `gemini` installer target MUST implement `AgentTarget`

A new `GeminiCliTarget` MUST implement the existing `AgentTarget` interface
(`detect` / `install` / `uninstall` / `printConfig` / `describePaths` /
`supportsLocation`) and register in the target registry with stable id
`gemini`, widening `TargetId` to `'claude' | 'gemini'`. The default
`specship install` with no target flag MUST continue to install the Claude
target only — Gemini is opt-in via an explicit target selection.

Flag spelling (resolved 2026-08-22): `--target <ids>`, the flag that already
exists on `specship install` and already routes `--print-config`. It widens
from "vestigial for install" to actually SELECTING targets — `--target gemini`,
`--target claude,gemini` — with the absent/`claude`/`auto`/`all` values still
meaning Claude-only so no existing invocation changes behaviour. A second
spelling (`--gemini`) would fork the surface for no gain.

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget
  - src/installer/targets/types.ts:AgentTarget
  - src/installer/targets/registry.ts:listTargetIds
  - src/installer/index.ts:resolveInstallTargets

verifies:
  - __tests__/installer-targets.test.ts:geminiDetectReportsInstalledAndConfigured
  - __tests__/installer-targets.test.ts:geminiUninstallOnVirginHomeIsNotFound
  - __tests__/installer-targets.test.ts:geminiInstallWritesTypelessStdioEntry

## Acceptance
<!-- id: REQ-GEMINI-002.A1 -->
- `detect('global')` reports `installed` when the Gemini CLI config directory
  is present, and `alreadyConfigured` when a specship MCP entry already exists
  at that location.
<!-- id: REQ-GEMINI-002.A2 -->
- `uninstall` removes only what `install` wrote: sibling MCP servers, other
  settings keys, and unrelated GEMINI.md content survive byte-identical, and
  uninstalling when nothing was installed returns `not-found` actions without
  error.
<!-- id: REQ-GEMINI-002.A3 -->
- Re-running `install` with nothing changed reports every file `unchanged`
  (idempotent, same contract as the Claude target).
<!-- id: REQ-GEMINI-002.A4 -->
- A plain `specship install` (no target flag) behaves byte-identically to the
  pre-change Claude-only installer — the existing installer test suite passes
  unmodified.

<!-- id: REQ-GEMINI-003 -->
## The Gemini MCP entry MUST be written to Gemini's settings surface

`GeminiCliTarget.install` MUST write the specship server into Gemini CLI's
`mcpServers` settings block — global location `~/.gemini/settings.json`,
local location `<project>/.gemini/settings.json` — preserving all sibling
servers and unrelated settings keys. Integration opt-ins (`--with-jira`,
`--with-designer`) MUST ride the entry's `env` exactly as the Claude target's
`writeMcpEntry` does, including preserving a prior install's opt-ins on
upgrade.

implementations:
  - src/installer/targets/gemini.ts:writeGeminiMcpEntry

verifies:
  - __tests__/installer-targets.test.ts:geminiPreservesSiblingServersAndKeys
  - __tests__/installer-targets.test.ts:geminiReinstallPreservesIntegrations

## Acceptance
<!-- id: REQ-GEMINI-003.A1 -->
- Installing into a settings file that already has other `mcpServers` entries
  leaves those entries byte-identical.
<!-- id: REQ-GEMINI-003.A2 -->
- An integration enabled by a previous install is preserved when a later
  install omits the flag (parity with REQ-INTEG-001.A3).

<!-- id: REQ-GEMINI-004 -->
## Gemini install MUST write a GEMINI.md steering block with marker semantics

`specship install --target gemini` MUST write a marker-delimited SpecShip
block into Gemini CLI's context file (`GEMINI.md` — global
`~/.gemini/GEMINI.md`, local `<project>/GEMINI.md`, matching the install
location). The block MUST carry two things and nothing more:

- **Retrieval preference** — a short directive that, in a SpecShip-indexed
  project, structure / flow / "where is X" / "who calls X" / impact questions
  go to the `specship_*` MCP tools BEFORE `grep_search`, `glob`, `read_file`
  or a search command in `run_shell_command`. It MUST NOT restate the tool
  playbook: Gemini CLI forwards the MCP server's `initialize` instructions to
  the model (verified in 0.28.0, `McpClient.getInstructions`), so
  `server-instructions.ts` stays the single source of truth (issue #529).
- **SDD rule** — when the governance tier is selected, the same
  spec-author-first rule the Claude target writes, generated from the same
  source (`getSddRuleBlock`) so the two cannot drift.

The block MUST have the same idempotence, upgrade self-healing and surgical
removal semantics the Claude target applies to CLAUDE.md, and content outside
the markers MUST never be modified. Default-on for `--target gemini`
(resolved 2026-10-26).

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget.install
  - src/installer/targets/gemini.ts:writeGeminiInstructionsEntry
  - src/installer/targets/gemini.ts:writeGeminiSddEntry
  - src/installer/targets/gemini.ts:removeGeminiInstructionsEntry
  - src/installer/targets/gemini.ts:removeGeminiSddEntry
  - src/installer/instructions-template.ts:getGeminiRetrievalBlock
  - src/installer/instructions-template.ts:getSddRuleBlock

verifies:
  - __tests__/installer-targets.test.ts:geminiInstallPreservesUserGeminiMdContent
  - __tests__/installer-targets.test.ts:geminiUninstallStripsOnlyOurBlock
  - __tests__/installer-targets.test.ts:geminiRetrievalBlockLeadsWithSpecshipAndDoesNotDuplicatePlaybook
  - __tests__/installer-targets.test.ts:geminiSddBlockIsByteIdenticalToClaudeAndOptOutStrips
  - __tests__/installer-targets.test.ts:geminiReinstallIsUnchangedAndReplacesOldBlockInPlace
  - __tests__/installer-targets.test.ts:geminiRetrievalBlockHonoursGlobalVsLocalPath

## Acceptance
<!-- id: REQ-GEMINI-004.A1 -->
- Installing into a GEMINI.md with existing user content preserves that
  content byte-identical outside the marker block.
<!-- id: REQ-GEMINI-004.A2 -->
- Uninstall removes exactly the marker block (and the file only if SpecShip
  created it and nothing else remains).
<!-- id: REQ-GEMINI-004.A3 -->
- The written block names the `specship_*` tools as the first choice over
  `grep_search` / `glob` / `read_file` / shell search, and contains no
  per-tool usage text that also appears in `server-instructions.ts` (a test
  asserts no shared paragraph).
<!-- id: REQ-GEMINI-004.A4 -->
- The SDD portion is byte-identical to the Claude target's SDD rule block
  and is absent when the governance tier is not selected (`--no-sdd`).
<!-- id: REQ-GEMINI-004.A5 -->
- Re-running install with nothing changed reports GEMINI.md `unchanged`; a
  block from an older version is replaced in place, not duplicated.

<!-- id: REQ-GEMINI-005 -->
## Slash commands MUST render from a single source into Gemini's format

The Gemini target MUST ship the same command surface as the Claude target's
`commands/specship/` set, rendered into Gemini CLI's custom-command format
(TOML under the Gemini commands directory). The Gemini rendering MUST be
generated from the same source-of-truth command definitions the Claude/plugin
install path uses — two renderers, one source — so the surfaces cannot drift.
A command whose body depends on Claude-only machinery (e.g. dispatching the
`specship-explorer` subagent) MUST either degrade to an equivalent inline
instruction or be excluded with a note, never shipped broken.
[needs review: which commands are in the Gemini set vs excluded — decide at
implementation from the capability matrix]

## Acceptance
<!-- id: REQ-GEMINI-005.A1 -->
- A test proves the Gemini command set is derived from the same source files
  as the Claude command set (editing a source command changes both outputs).
<!-- id: REQ-GEMINI-005.A2 -->
- Uninstall removes the shipped Gemini command files and leaves user-authored
  commands in the same directory untouched.

<!-- id: REQ-GEMINI-006 -->
## Capability degradation MUST be explicit, never silent

The Claude target's surfaces with no Gemini equivalent MUST NOT be faked or
half-installed. As of REQ-GEMINI-010/011 the steering and session hooks DO
have Gemini equivalents and are installed; what remains unsupported is the
`specship-explorer` subagent, the status-line segment, and (until
REQ-GEMINI-005 lands) the slash commands. `install` MUST print one
capability note listing exactly the surfaces a Claude install provides that
this Gemini install does not. `describePaths` MUST list only paths the Gemini
target actually writes.

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget.install

verifies:
  - __tests__/installer-targets.test.ts:geminiInstallNotesUnsupportedSurfaces

## Acceptance
<!-- id: REQ-GEMINI-006.A1 -->
- A Gemini install's `WriteResult.notes` names each still-unsupported surface
  (subagent, status line, and slash commands while REQ-GEMINI-005 is unbuilt)
  in one note, and no longer lists hooks.
<!-- id: REQ-GEMINI-006.A2 -->
- No file under `.claude/` or Claude's settings is ever written by the Gemini
  target.
<!-- id: REQ-GEMINI-006.A3 -->
- README/docs carry the Claude-vs-Gemini capability matrix and make no parity
  claim for unsupported surfaces (promise only what you can prove).

<!-- id: REQ-GEMINI-007 -->
## Phase 2 — Model compaction tiers MUST be provider-neutral

The compaction tier axis MUST be expressed as capability tiers — `lite`,
`standard`, `full` — resolved through an explicit provider mapping table
rather than Claude-only substring checks. At minimum: Haiku and Gemini
Flash/Flash-Lite class models map to `lite`; Sonnet class maps to `standard`;
Opus/Fable and Gemini Pro class map to `full`. An unknown or absent model id
MUST resolve to `full` (never compact blind — existing invariant). The
`SPECSHIP_COMPACT` and `SPECSHIP_MODEL` overrides MUST keep working and
`SPECSHIP_MODEL` MUST accept Gemini model ids. Existing behavior for Claude
model ids MUST be unchanged (haiku→lite ≡ old haiku tier, sonnet→standard ≡
old sonnet tier).

implementations:
  - src/mcp/model-context.ts:modelTier
  - src/mcp/model-context.ts:detectModelTier
  - src/mcp/model-context.ts:compactToolResult
  - src/mcp/tools.ts:ToolHandler.getTools
  - src/mcp/tools.ts:ToolHandler.buildFlowFromNamedSymbols
  - src/activation/steering.ts:buildSteeringNudge
  - src/statusline/render.ts:renderSegment
  - src/statusline/index.ts:buildSegment

verifies:
  - __tests__/model-context.test.ts:geminiIdsMapToCapabilityTiers
  - __tests__/model-context.test.ts:unknownModelIdResolvesFull
  - __tests__/model-context.test.ts:specshipModelAcceptsGeminiIdWithoutMarker
  - __tests__/model-context.test.ts:geminiSessionWithoutClaudeChannelResolvesFull

## Acceptance
<!-- id: REQ-GEMINI-007.A1 -->
- `modelTier('gemini-2.5-flash')` (and flash-lite variants) resolves to the
  lite tier; `modelTier('gemini-2.5-pro')` resolves to full.
<!-- id: REQ-GEMINI-007.A2 -->
- Every existing model-context test passes with only tier-name renames — no
  behavioral change for Claude ids.
<!-- id: REQ-GEMINI-007.A3 -->
- `SPECSHIP_MODEL=gemini-2.5-flash` forces the lite tier through the settings
  chain with no session marker present.
<!-- id: REQ-GEMINI-007.A4 -->
- On a Gemini session (no Claude transcript/status-line signal), tier
  detection falls back to `SPECSHIP_MODEL`/settings and otherwise resolves
  `full` — it never misreads a Claude-specific channel.

<!-- id: REQ-GEMINI-008 -->
## Installer tests and release notes MUST cover the new target

Per the installer module's standing rules, the Gemini target MUST land with
an installer test suite mirroring the Claude target's coverage
(detect/install/uninstall/idempotence/sibling-preservation) and a user-facing
`CHANGELOG.md` entry under `[Unreleased]`. The agent-eval harness SHOULD be
run against a Gemini CLI session before any retrieval-parity claim is
published (the 1-call / zero-Read bar was measured on Claude Code only).

Landed as a `Gemini target — specifics` block inside the existing
`__tests__/installer-targets.test.ts` rather than a separate file: the
registered target now also runs the parameterized `ALL_TARGETS` contract loop
(install / idempotence / sibling preservation / uninstall) in that same file,
so splitting the Gemini-only cases out would separate them from the contract
they extend.

implementations:
  - __tests__/installer-targets.test.ts:geminiEntrySweptByRegistryUninstall

## Acceptance
<!-- id: REQ-GEMINI-008.A1 -->
- `npx vitest run __tests__/installer-targets.test.ts` passes and exercises
  install, re-install (unchanged), uninstall, and sibling-preservation cases
  against temp directories.
<!-- id: REQ-GEMINI-008.A2 -->
- CHANGELOG `[Unreleased]` gains a plain-sentence New Features entry with no
  internal paths or symbols.

<!-- id: REQ-GEMINI-009 -->
## An opt-in read-only auto-approval policy MUST be installable for Gemini

`specship install --target gemini --trust` MUST write a user-tier Gemini
policy file (`~/.gemini/policies/specship.toml`) whose rules ALLOW only
SpecShip's read-only MCP tools — `specship_explore`, `specship_search`,
`specship_node`, `specship_callers`, `specship_callees`, `specship_impact`,
`specship_files`, `specship_status`, `specship_health`, `specship_spec`,
`specship_drifted` — so those calls never raise Gemini's per-tool
confirmation. Tools that write state or reach an external service
(`specship_link_assert`, `specship_link_verify`, every `specship_jira_*`,
the designer tools) MUST NOT be allowed by this policy and keep Gemini's
normal confirmation. The installer MUST NOT set `trust: true` on the server
entry (it approves every tool, verified in 0.28.0 as a `specship__*` allow
rule). Without `--trust`, no policy file is written (resolved 2026-10-26:
it changes the user's approval settings, so it is opt-in).

The policy is user tier by construction. SpecShip MUST NOT write to Gemini's
system/admin policy directory and MUST NOT attempt to override an
administrator's policy: Gemini's tier ordering lets an admin rule win over
this one, and that is the intended outcome. The `run_shell_command` tool is
out of scope — this requirement removes prompts only for SpecShip's own
tools; fewer shell prompts come from REQ-GEMINI-010/011 steering the agent
off the shell.

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget.install
  - src/installer/targets/gemini.ts:GeminiCliTarget.uninstall

## Acceptance
<!-- id: REQ-GEMINI-009.A1 -->
- With `--trust`, the written TOML parses under Gemini CLI's policy schema
  (`mcpName = "specship"`, `toolName` list, `decision = "allow"`, integer
  `priority` in 0–999) and lists exactly the read-only tool set above.
<!-- id: REQ-GEMINI-009.A2 -->
- No write-capable tool (link_assert, link_verify, any jira_*, any designer_*)
  appears in an allow rule, and the settings entry never carries `trust`.
<!-- id: REQ-GEMINI-009.A3 -->
- Without `--trust`, install writes no policy file; a later install without
  `--trust` preserves a policy file a previous `--trust` install wrote
  (parity with integration opt-ins, REQ-INTEG-001.A3).
<!-- id: REQ-GEMINI-009.A4 -->
- Uninstall removes only `specship.toml`; other files in the user policies
  directory are untouched, and nothing is ever written under the system
  policies directory.
<!-- id: REQ-GEMINI-009.A5 -->
- README/docs state plainly that an administrator policy overrides this file
  and that shell-command confirmations are unaffected by it.

<!-- id: REQ-GEMINI-010 -->
## Gemini install MUST wire prompt- and session-level steering hooks

`specship install --target gemini` MUST write SpecShip's hooks into the
`hooks` block of Gemini's settings file (same location as the MCP entry),
mapping the Claude hooks onto Gemini's events (verified in 0.28.0
`HookEventName`):

| Claude hook | Gemini event | Command |
|---|---|---|
| UserPromptSubmit `steer-nudge` | `BeforeAgent` | retrieval nudge |
| UserPromptSubmit `spec-nudge` (governance tier) | `BeforeAgent` | SDD nudge |
| SessionStart `cheatsheet` | `SessionStart` | cheat-sheet |
| SessionStart / PostToolUse `sync` | `SessionStart` / `AfterTool` on `write_file\|replace` | index sync |

Each command MUST read Gemini's hook payload (`session_id`,
`transcript_path`, `cwd`, `hook_event_name`, `prompt`) and emit Gemini's
output schema (`hookSpecificOutput.additionalContext` for context,
`systemMessage` for the user-visible cheat-sheet). The same silence gates as
the Claude hooks apply unchanged: no `.specship/` index → silent;
`SPECSHIP_NO_STEERING=1` → silent; `SPECSHIP_NO_CHEATSHEET` → no
cheat-sheet. Default-on for `--target gemini`. Sibling hooks the user wrote
MUST survive install and uninstall byte-identical.

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget.install
  - src/activation/steering.ts:buildSteeringNudge
  - src/activation/cheatsheet.ts:buildCheatsheetPayload

## Acceptance
<!-- id: REQ-GEMINI-010.A1 -->
- After install, Gemini's settings `hooks` block contains the BeforeAgent,
  SessionStart and AfterTool entries above, each a `type: "command"` hook,
  and re-running install reports the settings file `unchanged`.
<!-- id: REQ-GEMINI-010.A2 -->
- Fed a Gemini `BeforeAgent` payload with a flow-shaped prompt in an indexed
  project, the nudge command prints JSON whose
  `hookSpecificOutput.additionalContext` names `specship_explore`; in an
  unindexed project or with `SPECSHIP_NO_STEERING=1` it prints nothing.
<!-- id: REQ-GEMINI-010.A3 -->
- Fed a Gemini `SessionStart` payload, the cheat-sheet command emits a
  `systemMessage` and never `additionalContext`.
<!-- id: REQ-GEMINI-010.A4 -->
- Uninstall removes exactly the SpecShip hook entries; user-written hooks and
  other settings keys survive byte-identical.
<!-- id: REQ-GEMINI-010.A5 -->
- The Claude target's hook output for the same prompts is unchanged (the
  existing steering tests pass unmodified).

<!-- id: REQ-GEMINI-011 -->
## A BeforeTool search interceptor MUST redirect Gemini searches to SpecShip

The Gemini install MUST add a `BeforeTool` hook matching `grep_search`,
`glob` and `run_shell_command`. For `run_shell_command` it MUST act only when
the command is search-shaped — its first program is a code-search tool
(`grep`, `rg`, `ag`, `ack`, `git grep`, `find`, `fd`) — and MUST ignore a
search tool used as a filter on another command's output (e.g.
`npm test | grep FAIL`). [needs review: whether read-shaped commands such as
`cat`/`head` belong in the advisory set]

Two modes (resolved 2026-10-26):

- **Advisory (default)** — identical contract to the Claude interceptor
  (REQ-STEER-004/005): emit one `additionalContext` line pointing at
  `specship_explore`, never a decision; at most once per session; silent once
  the session has used a specship tool. The search still runs.
- **Strict (opt-in, `SPECSHIP_GEMINI_STRICT=1`, env > project > install
  settings)** — for a search-shaped call in an indexed project, return
  `decision: "deny"` with a `reason` telling the agent to call
  `specship_explore` (naming the symbols from the search pattern) and that a
  search the index cannot answer may be retried by asking the user. Strict is
  a deliberate, Gemini-only exception to the advisory rule, chosen by the
  user; it is never on by default and never applies to the Claude target.

Session-use detection MUST be host-aware: Gemini's transcript format and its
MCP tool naming (`specship__<tool>`) differ from Claude's, and a parser that
cannot read the transcript MUST fail toward silence in advisory mode and
toward ALLOW in strict mode (never deny on a parse failure).

implementations:
  - src/activation/search-intercept.ts:buildSearchIntercept
  - src/installer/targets/gemini.ts:GeminiCliTarget.install

## Acceptance
<!-- id: REQ-GEMINI-011.A1 -->
- Advisory: a Gemini `BeforeTool` payload for `grep_search` in an indexed
  project yields one `additionalContext` line and no `decision`; the second
  call in the same session yields nothing.
<!-- id: REQ-GEMINI-011.A2 -->
- `run_shell_command` with `rg "renderScene" src/` is treated as a search;
  `npm test | grep FAIL`, `git status` and `ls` are not, in both modes.
<!-- id: REQ-GEMINI-011.A3 -->
- Strict: the same search-shaped call returns `decision: "deny"` with a
  reason naming `specship_explore`; in an unindexed project, or when the
  transcript cannot be read, the call is allowed (no decision).
<!-- id: REQ-GEMINI-011.A4 -->
- With strict unset, no code path emits a `deny`/`block` decision (test
  asserts across all fixtures).
<!-- id: REQ-GEMINI-011.A5 -->
- Docs claim strict mode avoids the shell confirmation prompt only if a test
  against Gemini CLI proves `BeforeTool` runs before policy confirmation.
  [needs review: verify hook-vs-confirmation ordering in Gemini CLI before
  making that claim]

