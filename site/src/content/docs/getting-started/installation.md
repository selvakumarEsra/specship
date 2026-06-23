---
title: Installation
description: Install SpecShip and wire it into Claude Code.
---

SpecShip is **Claude Code only** — the installer configures one agent on purpose, so the surface stays small and easy to keep correct. If you need MCP integration with another agent that speaks the protocol, point it at `specship serve --mcp` by hand (see [MCP & Claude Code wiring](/specship/reference/integrations/)).

## 1. Run the installer

```bash
npx @selvakumaresra/specship install
```

The installer will:

- Ask whether to wire SpecShip into **just this project** (the default) or **all projects** (global).
- Write the MCP server entry so Claude Code launches `specship serve --mcp`.
- Add the read-only `specship_*` (and `designer_*`) tools to Claude Code's auto-allow list, so you aren't prompted on every query.
- Install the bundled slash commands and the `specship-explorer` subagent as a Claude Code plugin.
- Add the auto-sync hooks (re-index after the agent edits files; catch up on session start).
- Write a short spec-driven-development steering rule into the project's `CLAUDE.md` plus a prompt hook that nudges the agent to author a spec first for feature/bug work. Skip it with `--no-sdd`.
- For a project-local install, initialize the current project and build its index.

## Project-local vs global

A no-flag `specship install` is **project-local** by default — it writes to `./.mcp.json` and `./.claude/settings.json`, so SpecShip's MCP tools only load for Claude Code sessions in this project. That keeps the always-on tool-list overhead out of sessions on unrelated projects.

Pass `--location global` to write to `~/.claude.json` and `~/.claude/settings.json` instead, so a single install works in every project you open.

## Non-interactive (scripting / CI)

```bash
specship install --yes                       # project-local, auto-allow on
specship install --yes --location global      # all projects
specship install --no-sdd                     # skip the spec-driven-development steering
specship install --no-permissions             # skip the auto-allow list
specship install --print-config               # print the MCP snippet, no file writes
```

| Flag | Values | Default |
|---|---|---|
| `--location` | `global`, `local` | prompt (highlights `local`) |
| `--yes` | (boolean) non-interactive | prompt every step → `local` |
| `--no-sdd` | (boolean) skip the SDD steering | steering on |
| `--no-permissions` | (boolean) skip the auto-allow list | permissions on |
| `--print-config` | print the MCP snippet and exit | — |

> `--yes` is non-interactive and resolves to a **project-local** install. Pass `--location global` alongside it for the old global behavior.

## 2. Restart Claude Code

Restart Claude Code so it picks up the new MCP server entry and loads the `specship_*` tools.

## 3. Initialize more projects

A project-local install already indexed the current project. For any other project:

```bash
cd your-project
specship init
```

`specship init` builds the per-project knowledge graph index (indexing runs by default — the old `-i`/`--index` flag is accepted but no longer needed). A global install then works in every project you open.

## Supported platforms

Every release ships a self-contained build (bundled Node runtime — nothing to compile) for all three desktop OSes, on both x64 and arm64:

| Platform | Architectures | Install |
|---|---|---|
| Windows | x64, arm64 | PowerShell installer or npm |
| macOS | x64, arm64 | shell installer or npm |
| Linux | x64, arm64 | shell installer or npm |

## Uninstall

```bash
specship uninstall
```

This reverses the installer — stripping SpecShip's MCP server entry, the auto-allow permissions, the slash commands, the auto-sync hooks, and the spec-driven-development steering from Claude Code. It defaults to the same location as install (project-local), so an `--yes` install/uninstall pair stays symmetric; pass `--location global` to remove a global install. Your project indexes (`.specship/`) are left untouched — remove those per-project with `specship uninit`.
