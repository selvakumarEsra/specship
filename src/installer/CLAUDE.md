# Installer module

<!-- Inherits all rules from the root CLAUDE.md. This file adds
     installer-specific guidance for src/installer/. -->

## What this module is

Entry point for `specship install` — Claude Code only. `targets/registry.ts`
lists supported targets (currently only `claudeTarget`); the `AgentTarget`
interface in `targets/types.ts` is preserved so re-adding another agent later
is one new file + one registry entry.

## Non-negotiable invariants

- **Claude Code only, plus the ratified Gemini CLI exception** (explicit ask,
  2026-08-22 — `specs/agent-target-gemini.md`, `GEMINI-TARGET-DOC`).
  `targets/gemini.ts` currently implements **only** `printConfig` (Phase 0,
  REQ-GEMINI-001) and is deliberately absent from `ALL_TARGETS` so a plain
  `specship install` stays byte-identically Claude-only and the contract
  suite (which loops `ALL_TARGETS`) doesn't run against a target whose
  install/detect/uninstall still throw. Register it in the change that
  lands REQ-GEMINI-002. Don't add any OTHER agent target without an equally
  explicit ask — this fork's selling point is the smaller surface.
- Any installer change needs matching coverage in
  `__tests__/installer-targets.test.ts` and a CHANGELOG entry — installer
  regressions break every new install silently.
- `instructions-template.ts` exports only the `<!-- SPECSHIP_START -->` /
  `<!-- SPECSHIP_END -->` markers. The installer **stopped writing** the
  legacy `## SpecShip` block into CLAUDE.md (issue #529); `install`
  (self-heal) and `uninstall` use the markers only to **strip** a block a
  previous install left behind.

## Where things live

- `targets/claude.ts` — Claude's config layout: `~/.claude.json` or
  `./.mcp.json` for the MCP entry; `~/.claude/settings.json` or
  `./.claude/settings.json` for permissions + hooks; commands/agents asset
  copies.
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
