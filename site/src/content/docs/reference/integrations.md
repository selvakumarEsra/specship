---
title: MCP & Claude Code wiring
description: How SpecShip wires itself into Claude Code — the MCP server registration, settings.json permissions, and the manual wire-up if you prefer to do it yourself.
---

SpecShip is a Claude Code-first tool. The `specship install` command does the wiring for you; this page exists for two cases:

1. **You want to know what it does**, before you let it edit your config files.
2. **You want to wire it up by hand** — the install command refuses, or you're scripting around it.

## What `specship install` writes

### 1. The MCP server entry

A no-flag install is **project-local** by default — it writes to `./.mcp.json`. Pass `--location global` to write to `~/.claude.json` instead, so the server runs for every project:

```json
{
  "mcpServers": {
    "specship": {
      "command": "specship",
      "args": ["serve", "--mcp"]
    }
  }
}
```

This tells Claude Code: "when you start, spawn `specship serve --mcp` as a stdio MCP server". The server exposes the code-graph tools (`specship_search`, `specship_explore`, `specship_node`, `specship_callers`, `specship_callees`, `specship_impact`, `specship_status`, `specship_files`), the spec tools (`specship_spec`, `specship_link_assert`, `specship_link_verify`, `specship_drifted`), and the design tools (`designer_session`, `designer_prompt`, `designer_ask`, `designer_list`, `designer_snapshot`, `designer_handoff`). See the [MCP server reference](/reference/mcp-server/) for what each does.

### 2. The auto-allow permissions list

Into `./.claude/settings.json` (project-local) or `~/.claude/settings.json` (global):

```json
{
  "permissions": {
    "allow": [
      "mcp__specship__specship_explore",
      "mcp__specship__specship_search",
      "mcp__specship__specship_node",
      "mcp__specship__specship_callers",
      "mcp__specship__specship_callees",
      "mcp__specship__specship_impact",
      "mcp__specship__specship_files",
      "mcp__specship__specship_status",
      "mcp__specship__designer_session",
      "mcp__specship__designer_prompt",
      "mcp__specship__designer_ask",
      "mcp__specship__designer_list",
      "mcp__specship__designer_snapshot",
      "mcp__specship__designer_handoff"
    ]
  }
}
```

This means Claude Code won't prompt you on every query — the read-only code-graph tools and the human-driven design tools are auto-allowed. The mutating spec tools (`specship_link_assert`, `specship_link_verify`) and `specship_spec` / `specship_drifted` are intentionally **not** in this list, so you get a permission prompt before SpecShip writes a link. Skip the whole list with `--no-permissions`.

### 3. The auto-sync hooks

A `PostToolUse` hook (on `Edit|Write|MultiEdit`) and a `SessionStart` hook (on `startup|resume`) run `specship sync --quiet` so the index keeps up with the agent's own edits without waiting on the background watcher.

### 4. The spec-driven-development steering (opt-in)

Part of the **spec-driven layer**, installed only with `specship install --sdd`: a short SDD rule is added to the project's `CLAUDE.md`, and a `UserPromptSubmit` hook nudges the agent to author the spec under `specs/` before reaching for a brainstorming or planning skill when you describe feature or bug work. `specship uninstall` removes both. A default install leaves these off so the retrieval wedge lands without an unrequested workflow.

### 5. The slash commands and subagent

The slash commands are a small set of **progressive doors** (sub-actions are selected inside a door, not as separate commands). A default install ships only the retrieval door; the spec-driven doors arrive with `--sdd`. The `specship-explorer` subagent ships alongside.

| Door | Tier | What it covers |
|---|---|---|
| `/ss-explore <symbols \| flow \| "impact of X">` | retrieval (default) | Reads: explore an area, trace a flow, or get a change's blast radius. |
| `/ss-spec [<ID> \| new \| fast \| implement \| review \| triage \| behaviour \| domain]` | spec-driven (`--sdd`) | The intent loop: no arg = the funnel; `<ID>` = a spec's detail; `new`/`fast` author (full vs no-interview); `implement`/`review`; `triage` routes a change to an existing spec; `behaviour` generates E2E tests; `domain` captures a domain fact. |
| `/ss-check [drifted \| fix <ID> \| relink <ID> \| health]` | spec-driven (`--sdd`) | The gate & health door: no arg = the enforcement gate; `drifted` = the review queue; `fix`/`relink` repair links; `health` = the maintainability report. |
| `/ss-design-implement <url>` | spec-driven (`--sdd`) | Snapshots a Claude Design URL and drafts + implements a spec from it. |
| `/ss-design-loop` | spec-driven (`--sdd`) | Runs the full human-tasted design→spec→code loop. |

See [Design-to-code](/workflows/design-to-code/) for the design commands.

## Manual wiring

If you don't want to run `specship install`:

```bash
npm i -g @selvakumaresra/specship
```

Then add the `mcpServers.specship` entry and the `permissions.allow` block above to your Claude Code config files by hand.

If you do want the slash commands, the easiest path is still `specship install` — it'll detect the existing MCP entry and only add the missing pieces.

## Per-project vs global

`specship install` writes to the current project's `./.mcp.json` and `./.claude/settings.json` **by default**, so the MCP server only runs for that project. This keeps SpecShip's tool surface out of Claude Code sessions on projects that haven't opted in. Pass `--location global` to write to your global Claude Code config (`~/.claude.json` + `~/.claude/settings.json`) instead:

```bash
specship install --location global
```

## Uninstall

```bash
specship uninstall
```

Strips SpecShip's MCP server entry, the auto-allow permissions, the auto-sync hooks, the spec-driven-development steering, and the slash commands. It defaults to the same location as install (project-local); pass `--location global` to remove a global install. Your project's `.specship/` directories are left untouched — they contain your local graph data and run history.

## Other agents

SpecShip is Claude Code only — the installer and tests cover one agent on purpose, the project's surface is smaller and easier to keep correct.

If you need MCP integration with another agent that speaks the protocol, point that agent's MCP config at `specship serve --mcp` manually. The MCP protocol is standard; SpecShip's server speaks it. Just don't expect the install flow to do the wiring for you.
