---
title: MCP & Claude Code wiring
description: How SpecShip wires itself into Claude Code — the MCP server registration, settings.json permissions, and the manual wire-up if you prefer to do it yourself.
---

SpecShip is a Claude Code-first tool. The `specship install` command does the wiring for you; this page exists for two cases:

1. **You want to know what it does**, before you let it edit your config files.
2. **You want to wire it up by hand** — the install command refuses, or you're scripting around it.

## What `specship install` writes

Three things, none of them surprising:

### 1. The MCP server entry

Into `~/.claude.json` (global, the default) or `./.mcp.json` (project, when you pass `--project`):

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

This tells Claude Code: "when you start, spawn `specship serve --mcp` as a stdio MCP server". The server exposes the `specship_*` tools (search, explore, node, callers, callees, impact, status, files, spec, link-assert, link-verify, drifted).

### 2. The auto-allow permissions list

Into `~/.claude/settings.json` (global) or `./.claude/settings.json` (project):

```json
{
  "tools": {
    "permissions": {
      "auto-allow": [
        "mcp__specship__specship_search",
        "mcp__specship__specship_explore",
        "mcp__specship__specship_callers",
        "mcp__specship__specship_callees",
        "mcp__specship__specship_impact",
        "mcp__specship__specship_node",
        "mcp__specship__specship_status",
        "mcp__specship__specship_files",
        "mcp__specship__specship_spec",
        "mcp__specship__specship_drifted"
      ]
    }
  }
}
```

This means Claude Code won't prompt you for permission on every SpecShip query — the read-only tools (search, explore, etc.) are auto-allowed. Mutating tools like `specship_link_assert` are intentionally NOT in this list, so the user gets a permission prompt before SpecShip writes anything.

### 3. The slash commands

Slash commands and a subagent ship as a Claude Code plugin under `~/.claude/plugins/specship/`:

| Command | What it runs |
|---|---|
| `/ss-spec <ID>` | Reads the spec via `specship_spec`. |
| `/ss-implement <ID>` | Kicks off the `spec-implement` workflow. |
| `/ss-fix <ID>` | Kicks off `spec-fix`. |
| `/ss-relink <ID>` | Kicks off `spec-relink`. |
| `/ss-drifted` | Lists everything in the drift queue. |
| `/ss-spec-author <description>` | Drafts a new spec using the `spec-author` skill. |
| `/ss-spec-review <ID-or-path>` | Reviews an existing spec against the quality rubric. |

## Manual wiring

If you don't want to run `specship install`:

```bash
npm i -g @selvakumaresra/specship
```

Then add the `mcpServers.specship` entry and the `auto-allow` block above to your Claude Code config files by hand.

If you do want the slash commands, the easiest path is still `specship install` — it'll detect the existing MCP entry and only add the missing pieces.

## Per-project vs global

`specship install` writes to your global Claude Code config by default. Pass `--project` to write to the current project's `./.mcp.json` and `./.claude/settings.json` instead:

```bash
specship install --project
```

The MCP server then only runs for that project. Useful when you have multiple SpecShip projects with different graph data and don't want them visible to every Claude Code session.

## Uninstall

```bash
specship uninstall
```

Strips SpecShip's MCP server entry, the auto-allow permissions, and the slash commands. Your project's `.specship/` directories are left untouched — they contain your local graph data and run history.

## Other agents

SpecShip is Claude Code only — the installer and tests cover one agent on purpose, the project's surface is smaller and easier to keep correct.

If you need MCP integration with another agent that speaks the protocol, point that agent's MCP config at `specship serve --mcp` manually. The MCP protocol is standard; SpecShip's server speaks it. Just don't expect the install flow to do the wiring for you.
