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
jira_fingerprint_REQ-GEMINI-004: 5d711f66f181d2fe
jira_issue_REQ-GEMINI-005: SSHIP-61
jira_fingerprint_REQ-GEMINI-005: 6337f5225ca067bf
jira_issue_REQ-GEMINI-006: SSHIP-64
jira_fingerprint_REQ-GEMINI-006: 3f684dd984a9a430
jira_issue_REQ-GEMINI-007: SSHIP-68
jira_fingerprint_REQ-GEMINI-007: ae839b9275f8d254
jira_issue_REQ-GEMINI-008: SSHIP-73
jira_fingerprint_REQ-GEMINI-008: 4d4e35f023392939
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
## SDD steering MUST target GEMINI.md with the same marker semantics

When the governance tier is selected, the spec-driven-development steering
rule MUST be written into the project `GEMINI.md` (Gemini CLI's context file)
as a marker-delimited block, with the same idempotence, upgrade self-healing,
and surgical-removal semantics the Claude target applies to CLAUDE.md.
Content outside the markers MUST never be modified.

implementations:
  - src/installer/targets/gemini.ts:writeGeminiSddInstructionsEntry

## Acceptance
<!-- id: REQ-GEMINI-004.A1 -->
- Installing into a GEMINI.md with existing user content preserves that
  content byte-identical outside the marker block.
<!-- id: REQ-GEMINI-004.A2 -->
- Uninstall removes exactly the marker block (and the file only if SpecShip
  created it and nothing else remains).

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

implementations:
  - src/installer/targets/gemini.ts:writeGeminiCommandsEntries

## Acceptance
<!-- id: REQ-GEMINI-005.A1 -->
- A test proves the Gemini command set is derived from the same source files
  as the Claude command set (editing a source command changes both outputs).
<!-- id: REQ-GEMINI-005.A2 -->
- Uninstall removes the shipped Gemini command files and leaves user-authored
  commands in the same directory untouched.

<!-- id: REQ-GEMINI-006 -->
## Capability degradation MUST be explicit, never silent

The Claude target's surfaces with no Gemini equivalent — auto-sync hooks
(PostToolUse/SessionStart), the UserPromptSubmit retrieval-steering and SDD
nudge hooks, the `specship-explorer` subagent, and the status-line segment —
MUST NOT be faked or half-installed. `install` MUST print a capability note
listing what a Claude install provides that this Gemini install does not,
including the consequence that steering relies solely on the MCP server
instructions. `describePaths` MUST list only paths the Gemini target actually
writes.

implementations:
  - src/installer/targets/gemini.ts:GeminiCliTarget.install

verifies:
  - __tests__/installer-targets.test.ts:geminiInstallNotesUnsupportedSurfaces

## Acceptance
<!-- id: REQ-GEMINI-006.A1 -->
- A Gemini install's `WriteResult.notes` names each unsupported surface
  (hooks, subagent, status line) in one note.
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
