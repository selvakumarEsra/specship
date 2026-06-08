---
title: Installation
description: Install SpecShip and configure your AI coding agents.
---

## 1. Run the installer

```bash
npx @selvakumaresra/specship
```

The installer will:

- Ask which agent(s) to configure — auto-detecting installed ones from **Claude Code**, **Cursor**, **Codex CLI**, **opencode**, **Hermes Agent**, **Gemini CLI**, **Antigravity IDE**, and **Kiro**.
- Prompt to install `specship` on your `PATH` (so agents can launch the MCP server).
- Ask whether configs apply to all your projects or just this one.
- Write each chosen agent's MCP server config plus an instructions file (e.g. `CLAUDE.md`, `.cursor/rules/specship.mdc`, `~/.codex/AGENTS.md`).
- Set up auto-allow permissions when Claude Code is one of the targets.
- Initialize your current project (local installs only).

## Non-interactive (scripting / CI)

```bash
specship install --yes                              # auto-detect agents, install global
specship install --target=cursor,claude --yes       # explicit target list
specship install --target=auto --location=local     # detected agents, project-local
specship install --print-config codex               # print snippet, no file writes
```

| Flag | Values | Default |
|---|---|---|
| `--target` | `auto`, `all`, `none`, or csv (`claude,cursor,…`) | prompt |
| `--location` | `global`, `local` | prompt |
| `--yes` | (boolean) | prompt every step |
| `--no-permissions` | (boolean) skip Claude auto-allow list | permissions on |
| `--print-config <id>` | dump snippet for one agent and exit | — |

## 2. Restart your agent

Restart your agent (Claude Code / Cursor / Codex CLI / opencode / Hermes Agent / Gemini CLI / Antigravity IDE / Kiro) for the MCP server to load.

## 3. Initialize projects

```bash
cd your-project
specship init -i
```

This builds the per-project knowledge graph index and wires up any project-local agent surfaces, so a single global `specship install` works in every project you open.

## Supported platforms

Every release ships a self-contained build (bundled Node runtime — nothing to compile) for all three desktop OSes, on both x64 and arm64:

| Platform | Architectures | Install |
|---|---|---|
| Windows | x64, arm64 | PowerShell installer or npm |
| macOS | x64, arm64 | shell installer or npm |
| Linux | x64, arm64 | shell installer or npm |

## Uninstall

Changed your mind? One command removes SpecShip from every agent it configured:

```bash
specship uninstall
```

This reverses the installer — stripping SpecShip's MCP server config, instructions, and permissions from each configured agent. Your project indexes (`.specship/`) are left untouched; remove those per-project with `specship uninit`. Use `--target` to remove from specific agents, or `--yes` to run non-interactively.
