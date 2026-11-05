# Installer module

<!-- Inherits all rules from the root CLAUDE.md. This file adds
     installer-specific guidance for src/installer/. -->

## What this module is

Entry point for `specship install`. `targets/registry.ts` lists supported
targets (`claudeTarget`, `geminiTarget`); the `AgentTarget` interface in
`targets/types.ts` is what every target implements, so adding an agent is one
new file + one registry entry.

## Non-negotiable invariants

- **Claude Code plus the ratified Gemini CLI target** (explicit ask,
  2026-08-22 — `specs/agent-target-gemini.md`, `GEMINI-TARGET-DOC`).
  `targets/gemini.ts` implements the full `AgentTarget` contract over six
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
  never `run_shell_command`), and an opt-in user-tier policy TOML at
  `~/.gemini/policies/specship.toml` (REQ-GEMINI-009, `--trust`) that
  auto-allows SpecShip's read-only tools ONLY — write-capable tools and
  `run_shell_command` still prompt, an administrator policy still wins,
  the MCP entry is NEVER given `trust: true`, and uninstall removes the
  TOML iff it carries our header marker (user-authored files of the same
  name are left byte-identical). Omitting `--trust` writes no policy file;
  a plain reinstall preserves one a prior `--trust` install wrote. Fifth,
  the `/specship:*` slash commands as Gemini TOML under
  `<commands dir>/specship/` (REQ-GEMINI-005), rendered by
  `gemini-commands.ts` from the same `commands/specship/*.md` source and tier
  lists the Claude target installs — one source, two renderers — with
  marker-guarded install/uninstall.
  `resolveInstallTargets` maps absent / `auto` to the agent the command runs
  under (`agentFromEnv`, REQ-AGENTSWITCH-013; undetectable → Claude) and
  `claude` / `all` to Claude alone. Sixth, the `spec-author` / `design-md` skills
  under `<gemini dir>/skills/` and the `specship-explorer` subagent under
  `<gemini dir>/agents/` (REQ-AGENTSWITCH-005), gated on
  `probeGeminiVersion()` ≥ 0.28.0 — an older or unknown version is skipped
  with a note and the install still exits 0; `SPECSHIP_GEMINI_VERSION`
  overrides the probe (tests pin it). Uninstall always strips both.
  Everything Gemini has no equivalent for (the status line) is left
  unwritten and named in `WriteResult.notes` — never faked, never
  half-installed (REQ-GEMINI-006).
  The install also adds `CLAUDE.md` to Gemini's `context.fileName` (read in
  place, never copied). Don't add any OTHER agent target without an equally
  explicit ask — this fork's selling point is the smaller surface.
- **Agent switching (`AGENTSWITCH-DOC`).** `agent-record.ts` keeps
  `~/.specship/installed-agents.json` (agent + scope + choices);
  `install --replay-recorded` reinstalls each recorded agent and exits 3 when
  nothing is recorded (the bundle installers fall through on 3).
  `auto-migrate.ts` installs a newly detected agent: opt-out via
  `SPECSHIP_AUTO_MIGRATE=0` / `"autoMigrate": false`, carries SDD /
  auto-allow / integrations over, never rewrites user content, rolls back
  every write on failure. `targets/feature-parity.ts` is the
  REQ-AGENTSWITCH-010 parity map — a new surface on one target needs an entry
  there. The Claude plugin and the Gemini extension are generated from real
  installs (`scripts/sync-claude-plugin.mjs`,
  `scripts/build-gemini-extension.mjs`); never hand-edit them.
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
- `targets/gemini.ts` — Gemini CLI's settings file `~/.gemini/settings.json`
  (global) / `./.gemini/settings.json` (local), plus the surfaces above. The entry omits `type` —
  Gemini allows only `'sse' | 'http'` there and infers stdio from `command`.
- `targets/shared.ts` — JSON helpers (`getMcpServerConfig`,
  `getSpecShipPermissions`, `readJsonFile`/`writeJsonFile`,
  `jsonDeepEqual`, `removeMarkedSection`).

## How to verify work is done

- `npx vitest run __tests__/installer-targets.test.ts __tests__/installer.test.ts`
  — the contract suite (install idempotency, sibling MCP-server
  preservation, uninstall reverses install, byte-equal re-runs returning
  `unchanged`) iterates over `allTargets()`; the Claude-specifics suite
  covers legacy CLAUDE.md / `.claude.json` migration and pre-0.8 hook
  cleanup.
