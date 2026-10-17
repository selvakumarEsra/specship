---
title: Gemini CLI
description: Opt-in support for wiring SpecShip's MCP server into Google's Gemini CLI — install it for you or print the snippet, global or per project, and what Gemini sessions do and don't get.
---

SpecShip is built for Claude Code. **Gemini CLI is the one other agent it
supports**, and only as an explicit opt-in: a plain `specship install` still
sets up Claude Code alone.

What Gemini CLI gets is the SpecShip **MCP server** — the same server Claude
Code launches, with the same code-graph and spec tools. The Claude Code extras
(hooks, slash commands, status line) have no Gemini equivalent and are not
installed.

## Install

Let SpecShip write the entry for you:

```bash
specship install --target gemini            # Gemini CLI only
specship install --target claude,gemini     # both agents in one go
```

The installer asks where to put it — or pass `--location`:

| Location | File | Scope |
|---|---|---|
| `global` | `~/.gemini/settings.json` | Every project you open in Gemini CLI |
| `local` | `.gemini/settings.json` in the current directory | This project only |

The installer adds a single `mcpServers.specship` entry. Any other MCP servers
and settings already in that file are left untouched, re-running the install
changes nothing, and an optional integration you enabled earlier
(`--with-jira`, `--with-designer`) stays enabled. When it finishes, the
install prints a note listing what a Claude Code install adds that Gemini CLI
doesn't get, so you're never left assuming something is wired when it isn't.

The tools answer from the project's SpecShip index. A `local` install
initializes and indexes the current project for you (skip with
`--skip-index`); after a `global` install, run `specship init` in each
project you open. See [Indexing a project](/guides/indexing/).

## Or paste the snippet yourself

To wire it by hand, print the snippet. Printing writes nothing to disk:

```bash
specship install --print-config --target gemini --location global
```

```json
{
  "mcpServers": {
    "specship": {
      "command": "specship",
      "args": ["serve", "--mcp"],
      "env": {
        "SPECSHIP_HOST": "gemini"
      }
    }
  }
}
```

Merge it into the `mcpServers` block of the settings file for the location you
want. Keep the `SPECSHIP_HOST` line — it is how the server knows it was
launched by Gemini CLI, which turns on
[model detection](#model-aware-output) for Gemini sessions.

## Model-aware output

Because a Gemini session runs no SpecShip hooks or status line, the server
reads the session's model from Gemini CLI's own configuration — the
`GEMINI_MODEL` environment variable, or `model` in the project's
`.gemini/settings.json`, falling back to `~/.gemini/settings.json`. A Flash
session then gets the compact, one-call-friendly output a lightweight model
needs; Gemini Pro gets full output. Set `SPECSHIP_MODEL` to force a tier. See
[Low-end models](/claude-code/low-end-models/).

## What Gemini CLI gets — and doesn't

| | Claude Code | Gemini CLI |
|---|---|---|
| SpecShip MCP tools (explore, search, specs, links, …) | ✓ | ✓ |
| Opt-in JIRA / Designer tools | ✓ | ✓ (with `--with-jira` / `--with-designer`) |
| Model-tier adaptation | ✓ | ✓ |
| Index freshness while the server runs (its file watcher) | ✓ | ✓ |
| Auto-sync hooks (post-edit and session-start sync, drift summary) | ✓ | — run `specship sync` when you need it |
| Steering nudges and session-start cheatsheet | ✓ | — the server's built-in instructions are the only steering |
| `/specship:*` slash commands | ✓ | — |
| `specship-explorer` subagent | ✓ | — |
| Status-line segment | ✓ | — |
| Auto-allowed tool permissions | ✓ | — Gemini CLI asks per its own settings |

## Uninstall

Remove just the Gemini wiring, keeping your indexes and the program:

```bash
specship uninstall --target gemini --keep-data --location global
```

Only the `specship` entry is removed — other servers and settings in the file
survive unchanged. A full `specship uninstall` (without `--keep-data`) removes
SpecShip completely, including any Gemini CLI entry.
