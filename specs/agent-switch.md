---
id: AGENTSWITCH-DOC
title: Agent-agnostic interfaces and automatic migration between agents
owner: installer
priority: high
version: 1
depends_on: [GEMINI-TARGET-DOC]
epicKey: SSHIP-695
jira_issue_REQ-AGENTSWITCH-001: SSHIP-696
jira_fingerprint_REQ-AGENTSWITCH-001: 0f5673744c0f3ec7
jira_issue_REQ-AGENTSWITCH-002: SSHIP-700
jira_fingerprint_REQ-AGENTSWITCH-002: 5c330dd01b0f6989
jira_issue_REQ-AGENTSWITCH-003: SSHIP-704
jira_fingerprint_REQ-AGENTSWITCH-003: aec65a516c0f81b3
jira_issue_REQ-AGENTSWITCH-004: SSHIP-708
jira_fingerprint_REQ-AGENTSWITCH-004: b2915f85a363df43
jira_issue_REQ-AGENTSWITCH-005: SSHIP-712
jira_fingerprint_REQ-AGENTSWITCH-005: 32473b1e30fcc159
jira_issue_REQ-AGENTSWITCH-006: SSHIP-716
jira_fingerprint_REQ-AGENTSWITCH-006: b79366a067a966f4
jira_issue_REQ-AGENTSWITCH-007: SSHIP-721
jira_fingerprint_REQ-AGENTSWITCH-007: 20bacc524b1671b7
jira_issue_REQ-AGENTSWITCH-008: SSHIP-725
jira_fingerprint_REQ-AGENTSWITCH-008: e07b6a00ec2cc3cd
jira_issue_REQ-AGENTSWITCH-009: SSHIP-731
jira_fingerprint_REQ-AGENTSWITCH-009: 1ee568c4194c3ac9
---

<!-- id: AGENTSWITCH-DOC -->
# Agent-agnostic interfaces and automatic migration between agents

SpecShip supports two coding agents: Claude Code (the default) and Gemini CLI
(opt-in, GEMINI-TARGET-DOC). The house rule says shared code must not assume
either one. A 2026-11-05 audit found 17 places outside the adapter layers
where it does, seven of which break or empty a feature on Gemini:

- reflect proposals are written to `CLAUDE.md`, `~/.claude/memory/` and
  `.claude/settings.json` with Claude hook events;
- session analytics, reflect mining and the explore "prior work" section read
  only Claude transcripts and match only Claude tool names (`Read`, `Bash`,
  `mcp__specship__…`);
- the CLAUDE.md audit never looks at `GEMINI.md`;
- the dashboard's memory and MCP-server views read only Claude files;
- the bundled `claude-design-implement` workflow cites `~/.claude/skills/…`;
- the offline bundle installer always installs for Claude Code.

There is also no record of which agents SpecShip was installed for, and no
way to notice that the user has moved to another one. A user who switches
from Claude Code to Gemini CLI today must know to run
`specship install --target gemini`, and still gets no skills or subagent.

This document makes every agent-facing interface go through a per-agent
adapter, and makes SpecShip set itself up for a newly used agent on its own.

**Decisions (user, 2026-11-05).**
- A detected switch installs SpecShip's own files for the new agent right
  away and prints one line naming what was written and how to undo it.
- The old agent stays wired in, so switching back needs nothing. Removing it
  stays an explicit `specship uninstall --target <id>`.
- The user's own memory text (CLAUDE.md outside SpecShip's marked blocks) is
  never copied. Gemini is pointed at it instead.
- Gemini gets SpecShip's skills and explorer subagent wherever the installed
  Gemini CLI supports them.

**Non-goals.** Adding any agent other than Claude Code and Gemini CLI (the
house rule still governs install targets); migrating the user's own commands,
skills, other MCP servers or memory notes; converting past transcripts
between formats; a status line for Gemini, which has no command-driven one;
and keeping the Claude plugin manifest (`hooks/hooks.json`) in step with the
installer, which is tracked separately.

**Order.** REQ-AGENTSWITCH-006 → 007 → 008 → 009 deliver the switch;
001 → 005 then remove the leaks the audit found. Each requirement is
independently shippable.

**Test plan.** Each requirement is covered by unit tests against temp HOME
and project directories, the pattern `installer-targets.test.ts` already
uses. The guard in REQ-AGENTSWITCH-001 is a source-scan test. No live agent
is needed. Test evidence is added per requirement as its tests land: a
requirement gets a `verifies:` block only once its tests exist.

<!-- id: REQ-AGENTSWITCH-001 -->
## Host facts MUST come from one per-agent profile

Every fact that differs between agents MUST be read from that agent's
profile in the adapter layer, never written as a literal in shared code.
These facts include the memory file name, the tool-name prefix, hook event
names, configuration and transcript directories, the names of the built-in
read/search tools and the display name. Shared code is the engine, MCP
server, spec layer, steering, reflect, analytics, dashboard server, CLI
commands and bundled workflows. Code that needs a host fact and has no
active host MUST use the Claude Code profile, as today.

implementations:
  - src/activation/hook-output.ts:HostTraits
  - src/activation/hook-output.ts:deriveHostTraits
  - src/installer/targets/types.ts:AgentTarget

## Acceptance
<!-- id: REQ-AGENTSWITCH-001.A1 -->
- A source-scan test fails when a host literal (`mcp__specship__`,
  `.claude/`, `.gemini/`, `CLAUDE.md`, `GEMINI.md`, `UserPromptSubmit`,
  `BeforeAgent`, `~/.claude.json`) appears in shared code outside the
  adapter directories and an explicit, commented allowlist.
<!-- id: REQ-AGENTSWITCH-001.A2 -->
- Every leak listed in this document's introduction is fixed, and any
  remaining literal is on that allowlist with a one-line reason.
<!-- id: REQ-AGENTSWITCH-001.A3 -->
- Steering and search-interception helpers take the host profile as a
  required argument; a call without one does not compile.

<!-- id: REQ-AGENTSWITCH-002 -->
## Agent-facing text MUST name the active agent's tools and files

Tool guidance, the session cheatsheet, nudges and CLI messages MUST name the
tools, files and product of the agent that is running. The MCP server MUST
choose its instructions from the client that connected to it. Text shown
with no known host MUST stay as it is today.

implementations:
  - src/mcp/session.ts:MCPSession
  - src/activation/cheatsheet.ts
  - src/installer/instructions-template.ts:getSddRuleBlock

## Acceptance
<!-- id: REQ-AGENTSWITCH-002.A1 -->
- An MCP session opened by Gemini CLI receives instructions that name
  Gemini's read and search tools and `GEMINI.md`. A session opened by Claude
  Code receives today's text byte for byte.
<!-- id: REQ-AGENTSWITCH-002.A2 -->
- `specship uninstall --target gemini` reports Gemini paths, never Claude
  paths.
<!-- id: REQ-AGENTSWITCH-002.A3 -->
- The steering block written to `GEMINI.md` names only commands and skills
  that the Gemini install actually provides.

<!-- id: REQ-AGENTSWITCH-003 -->
## Memory-file features MUST act on the active agent's memory file

The memory-file audit and reflect proposals MUST read and write the memory
file, settings file and hook events of the agent they run for. On a project
with both agents installed, the audit MUST cover both memory files and name
the file each finding is about.

implementations:
  - src/claudemd/audit.ts:auditClaudeMd
  - src/claudemd/audit.ts:runClaudeMdAudit
  - src/reflect/targets.ts:buildProposal

## Acceptance
<!-- id: REQ-AGENTSWITCH-003.A1 -->
- On a Gemini-only project, the audit reports findings for `GEMINI.md` and
  none for a `CLAUDE.md` that does not exist.
<!-- id: REQ-AGENTSWITCH-003.A2 -->
- A reflect hook proposal applied for Gemini is written to
  `.gemini/settings.json` under `AfterTool` with Gemini's file-write tool
  names, not to `.claude/settings.json` under `PostToolUse`.
<!-- id: REQ-AGENTSWITCH-003.A3 -->
- A reflect memory proposal applied for Gemini lands in a SpecShip-marked
  block of `GEMINI.md`.

<!-- id: REQ-AGENTSWITCH-004 -->
## Session data MUST be read through per-agent transcript adapters

Analytics, reflect mining and the explore "prior work" section MUST read
sessions through one adapter per agent. Each adapter normalises that agent's
tool names to one shared set before anything counts them. Gemini sessions
are one JSON document per session with bare MCP tool names
(DOM-SPECSHIP-007). A transcript the adapter cannot parse MUST be skipped and
counted, never guessed at. [needs review] Whether existing `claude_*` tables
are renamed, or a host column is added, is an implementation choice to be
settled at plan time.

implementations:
  - src/analytics/specship-impact.ts
  - src/reflect/miner.ts

## Acceptance
<!-- id: REQ-AGENTSWITCH-004.A1 -->
- A Gemini session that calls `specship_explore` twice and `read_file` once
  is counted as two SpecShip calls and one file read.
<!-- id: REQ-AGENTSWITCH-004.A2 -->
- Claude session counts for an unchanged fixture are identical before and
  after the change.
<!-- id: REQ-AGENTSWITCH-004.A3 -->
- An unparseable transcript file is skipped, and the skip count is reported.

<!-- id: REQ-AGENTSWITCH-005 -->
## A Gemini install MUST carry skills and the subagent where supported

`specship install --target gemini` MUST install SpecShip's skills and its
explorer subagent in Gemini's own locations and formats whenever the
installed Gemini CLI supports them. Tool names in those files MUST be the
names Gemini uses. When the installed version lacks support, the install
MUST say which artifact was skipped and why, instead of skipping it
silently. Uninstall removes exactly what install wrote.

implementations:
  - src/installer/targets/gemini.ts

## Acceptance
<!-- id: REQ-AGENTSWITCH-005.A1 -->
- With a Gemini CLI that supports skills, the install writes
  `spec-author` and `design-md` under Gemini's skills directory, and
  uninstall removes them, leaving user skills in place.
<!-- id: REQ-AGENTSWITCH-005.A2 -->
- The installed subagent names `specship_explore`, never
  `mcp__specship__specship_explore`.
<!-- id: REQ-AGENTSWITCH-005.A3 -->
- With a Gemini CLI that lacks subagent support, the install output names
  the skipped subagent and the version it needs, and exits 0.

<!-- id: REQ-AGENTSWITCH-006 -->
## SpecShip MUST record which agents it is installed for, and where

Every install, uninstall and update MUST keep a record of the agents
SpecShip is installed for. For each entry the record holds the agent, the
scope (user-wide or one project), the project root when project-scoped, the
SpecShip version and the time. The record lives in the user's SpecShip home,
holds no credentials, and is rebuilt from the agents' own config files when
it is missing or unreadable. `specship update` and the offline bundle
installer MUST reinstall for every recorded agent, instead of only Claude
Code.

implementations:
  - src/installer/agent-record.ts:recordInstall
  - src/installer/agent-record.ts:recordUninstall
  - src/installer/agent-record.ts:rebuildAgentRecord
  - src/installer/agent-record.ts:ensureAgentRecord
  - src/installer/agent-record.ts:writeAgentRecord
  - src/installer/agent-record.ts:readAgentRecord
  - src/installer/index.ts:runInstallerWithOptions
  - src/installer/index.ts:reinstallRecordedAgents
  - src/installer/index.ts:uninstallTargets
  - src/update/updater.ts:runUpdate

verifies:
  - __tests__/agent-record.test.ts:reqAgentswitch006A1
  - __tests__/agent-record.test.ts:reqAgentswitch006A2
  - __tests__/agent-record.test.ts:reqAgentswitch006A3
  - __tests__/agent-record.test.ts:reqAgentswitch006A4
  - __tests__/agent-record.test.ts:reqAgentswitch006A2SkipsBadEntry
  - __tests__/agent-record.test.ts:reqAgentswitch006A3KeepsChoices
  - __tests__/agent-record.test.ts:reqAgentswitch006A3ReplayCli

## Acceptance
<!-- id: REQ-AGENTSWITCH-006.A1 -->
- After `specship install --target gemini --local` in project P, the record
  lists Gemini for P. After `specship uninstall --target gemini` it no
  longer does.
<!-- id: REQ-AGENTSWITCH-006.A2 -->
- Deleting the record and running any SpecShip command rebuilds it from the
  agent config files that carry a SpecShip MCP entry.
<!-- id: REQ-AGENTSWITCH-006.A3 -->
- `specship update` on a machine recorded for both agents reinstalls both.
<!-- id: REQ-AGENTSWITCH-006.A4 -->
- The record contains no tokens, keys or environment values.

<!-- id: REQ-AGENTSWITCH-007 -->
## SpecShip MUST detect which agent it is running under

SpecShip MUST work out the agent it is serving from the evidence that agent
supplies:
- the MCP client's name at session start;
- the hook payload's event name;
- the agent's launcher environment variables when a SpecShip command runs in
  the agent's shell.

Evidence that matches no supported agent MUST yield "unknown", and unknown
MUST NOT trigger any change.

The client names were read from the installed agents' own source on
2026-11-05: Gemini CLI 0.28.0 sends `gemini-cli-mcp-client`, and Claude Code
2.1.318 sends `claude-code`.

implementations:
  - src/agents/detect.ts:agentFromMcpClient
  - src/agents/detect.ts:agentFromHookEvent
  - src/agents/detect.ts:agentFromEnv
  - src/agents/detect.ts:agentDisplayName
  - src/workflows/agents/index.ts:headlessAgents
  - src/mcp/session.ts:MCPSession.getDetectedAgent
  - src/activation/hook-output.ts:detectHookAgent
verifies:
  - __tests__/agent-detect.test.ts:reqAgentswitch007A1
  - __tests__/agent-detect.test.ts:reqAgentswitch007A2
  - __tests__/agent-detect.test.ts:reqAgentswitch007A2InitializedAndHuman
  - __tests__/agent-detect.test.ts:reqAgentswitch007A3

## Acceptance
<!-- id: REQ-AGENTSWITCH-007.A1 -->
- An MCP `initialize` from client `gemini-cli-mcp-client` is detected as
  Gemini; one from `claude-code` as Claude Code; one from any other client
  as unknown.
<!-- id: REQ-AGENTSWITCH-007.A2 -->
- `specship status` run with `GEMINI_CLI=1` set reports Gemini as the
  current agent.
<!-- id: REQ-AGENTSWITCH-007.A3 -->
- A `SessionStart` payload, which both agents send, is not taken as proof
  of either agent on its own.

<!-- id: REQ-AGENTSWITCH-008 -->
## A switch to a newly used agent MUST set SpecShip up for it automatically

When SpecShip detects a supported agent that the record does not list for
the current scope, it MUST install SpecShip's own files for that agent at
the same scope as the existing install, without asking. These files are the
MCP entry, marked memory blocks, commands, hooks, skills and subagent. It
MUST then print one line naming what was written and the command that
undoes it. The previously used agent's files MUST be left in place. This
happens at most once per agent and scope, and is turned off by
`SPECSHIP_AUTO_MIGRATE=0` or `"autoMigrate": false` in
`specship.config.json`. A failed migration MUST leave the new agent's files
as they were and report the failure on the next SpecShip output.

SpecShip can only notice a new agent when something of its own runs under
that agent. Detection therefore happens at three points:
- a SpecShip MCP session the new agent opens (for example from a user-wide
  install, or an entry the user added by hand);
- a `specship` command run in the new agent's shell;
- the SpecShip git hook firing for a commit made from that shell.

A project where SpecShip is wired only into Claude Code, opened in a Gemini
session that never runs SpecShip, cannot be detected, and the documentation
MUST say so rather than promise more.

implementations:
  - src/installer/auto-migrate.ts:maybeAutoMigrate
  - src/installer/auto-migrate.ts:autoMigrateEnabled
  - src/installer/auto-migrate.ts:migrationScope
  - src/installer/auto-migrate.ts:takePendingMigrationFailure
  - src/installer/auto-migrate.ts:migrationLine
  - src/installer/targets/shared.ts:beginWriteJournal
  - src/installer/targets/shared.ts:endWriteJournal
  - src/installer/targets/shared.ts:rollbackJournal
  - src/installer/targets/shared.ts:removeFileSync
  - src/installer/targets/shared.ts:atomicWriteFileSync
  - src/installer/targets/gemini.ts:writeGeminiCommandsEntries
  - src/installer/targets/gemini.ts:writeGeminiPolicyEntry
  - src/mcp/session.ts:MCPSession.handleInitialize
  - src/mcp/session.ts:MCPSession.runAutoMigrate
  - src/mcp/session.ts:MCPSession.handleToolsCall
verifies:
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A1
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A2
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A3
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A4
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A4Config
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A5
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A5Pending
  - __tests__/auto-migrate.test.ts:reqAgentswitch008A5RecordFails
  - __tests__/auto-migrate.test.ts:journalRollsBackWrites
  - __tests__/auto-migrate.test.ts:hotPathCost
  - __tests__/auto-migrate.test.ts:cliTriggerAndUndo

## Acceptance
<!-- id: REQ-AGENTSWITCH-008.A1 -->
- On a project recorded for Claude Code only, a SpecShip MCP session opened
  by Gemini CLI installs the Gemini files for that project and prints one
  line naming them and `specship uninstall --target gemini --local`.
<!-- id: REQ-AGENTSWITCH-008.A2 -->
- Claude Code's `.mcp.json`, `.claude/` files and `CLAUDE.md` are
  byte-for-byte unchanged by that migration.
<!-- id: REQ-AGENTSWITCH-008.A3 -->
- A second Gemini session in the same project writes nothing and prints
  nothing.
<!-- id: REQ-AGENTSWITCH-008.A4 -->
- With `SPECSHIP_AUTO_MIGRATE=0`, the same session writes nothing and
  prints a one-line hint naming `specship install --target gemini`.
<!-- id: REQ-AGENTSWITCH-008.A5 -->
- If writing one Gemini file fails, files already written for Gemini in that
  attempt are removed, and the next SpecShip output reports the failure.

<!-- id: REQ-AGENTSWITCH-009 -->
## Migration MUST NOT rewrite content the user owns

A migration MUST change only what SpecShip itself owns: marker-delimited
blocks, entries it identifies as its own, and files it wrote. The user's
memory text outside SpecShip's markers MUST stay where it is. Gemini MUST
instead be configured to read the project's `CLAUDE.md` alongside
`GEMINI.md`, keeping any context file names the user already set. Other
MCP servers, user commands and user skills MUST NOT be copied or moved.

implementations:
  - src/installer/targets/gemini.ts

## Acceptance
<!-- id: REQ-AGENTSWITCH-009.A1 -->
- After a Claude → Gemini migration, `CLAUDE.md` is unchanged, and Gemini's
  settings list `CLAUDE.md` as a context file alongside `GEMINI.md`.
<!-- id: REQ-AGENTSWITCH-009.A2 -->
- A context file name the user had already configured is still present
  after migration.
<!-- id: REQ-AGENTSWITCH-009.A3 -->
- A second MCP server in `.mcp.json` does not appear in Gemini's settings
  after migration.
<!-- id: REQ-AGENTSWITCH-009.A4 -->
- `specship uninstall --target gemini` removes the added `CLAUDE.md`
  context entry and leaves the user's own entries.
