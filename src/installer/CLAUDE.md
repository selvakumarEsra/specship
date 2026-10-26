# Installer module

<!-- Inherits all rules from the root CLAUDE.md. This file adds
     installer-specific guidance for src/installer/. -->

## What this module is

Entry point for `specship install`. `targets/registry.ts` lists supported
targets (`claudeTarget`, `geminiTarget`); the `AgentTarget` interface in
`targets/types.ts` is what every target implements, so adding an agent is one
new file + one registry entry.

## Non-negotiable invariants

- **Claude Code only, plus the ratified Gemini CLI exception** (explicit ask,
  2026-08-22 — `specs/agent-target-gemini.md`, `GEMINI-TARGET-DOC`).
  `targets/gemini.ts` implements the full `AgentTarget` contract over three
  surfaces — Gemini's `mcpServers` settings block (REQ-GEMINI-002/003),
  GEMINI.md steering (REQ-GEMINI-004: a marker-delimited retrieval-preference
  block plus the default-on SDD rule, generated from the same
  `getSddRuleBlock` the Claude target uses so the two surfaces cannot drift),
  and the settings `hooks` block (REQ-GEMINI-010: `BeforeAgent` /
  `SessionStart` / `AfterTool` wired to the same `specship` hook commands the
  Claude target uses; those commands echo the payload's `hook_event_name`;
  REQ-GEMINI-011 adds `BeforeTool` matchers on `grep_search` / `glob` /
  `run_shell_command` for the search interceptor, with opt-in strict mode
  via `SPECSHIP_GEMINI_STRICT=1` that denies built-in search tools only —
  never `run_shell_command`).
  Being in `ALL_TARGETS` does NOT make it install by default:
  `resolveInstallTargets` maps absent / `claude` / `auto` / `all` to Claude
  alone, so Gemini is reachable only by naming it (`--target gemini`,
  `--target claude,gemini`). Everything Gemini has no equivalent for
  (permissions, slash commands, the explorer subagent, the status line) is
  left unwritten and named in `WriteResult.notes` — never faked, never
  half-installed (REQ-GEMINI-006). TOML commands (REQ-GEMINI-005) are still
  unimplemented. Don't add any OTHER agent target without an equally explicit
  ask — this fork's selling point is the smaller surface.
- Any installer change needs matching coverage in
  `__tests__/installer-targets.test.ts` and a CHANGELOG entry — installer
  regressions break every new install silently.
- `instructions-template.ts` holds three marker pairs. The legacy
  `<!-- SPECSHIP_START -->` / `<!-- SPECSHIP_END -->` pair is strip-only: the
  installer **stopped writing** the `## SpecShip` block into CLAUDE.md
  (issue #529), and `install` (self-heal) and `uninstall` use it only to
  **strip** a block a previous install left behind. The SDD pair wraps
  `getSddRuleBlock` (shared by both targets), and the Gemini retrieval pair
  wraps `getGeminiRetrievalBlock` — an ordering rule only, never a copy of
  the tool playbook in `server-instructions.ts`.

## Where things live

- `targets/claude.ts` — Claude's config layout: `~/.claude.json` or
  `./.mcp.json` for the MCP entry; `~/.claude/settings.json` or
  `./.claude/settings.json` for permissions + hooks; commands/agents asset
  copies.
- `targets/gemini.ts` — Gemini CLI's one surface: `~/.gemini/settings.json`
  (global) / `./.gemini/settings.json` (local). The entry omits `type` —
  Gemini allows only `'sse' | 'http'` there and infers stdio from `command`.
- `targets/shared.ts` — JSON helpers (`getMcpServerConfig`,
  `getSpecShipPermissions`, `readJsonFile`/`writeJsonFile`,
  `jsonDeepEqual`, `removeMarkedSection`).

## How to verify work is done

- `npx vitest run __tests__/installer-targets.test.ts __tests__/installer.test.ts`
  — the contract suite (install idempotency, sibling MCP-server
  preservation, uninstall reverses install, byte-equal re-runs returning
  `unchanged`) iterates over `ALL_TARGETS`; the Claude-specifics suite
  covers legacy CLAUDE.md / `.claude.json` migration and pre-0.8 hook
  cleanup.
