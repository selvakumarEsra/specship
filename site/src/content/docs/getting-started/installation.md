---
title: Installation
description: Install SpecShip and wire it into Claude Code.
---

SpecShip is built for **Claude Code** — the installer wires one agent by default, so the surface stays small and easy to keep correct. The one exception is **Gemini CLI**, an opt-in, MCP-only target (see [Gemini CLI (opt-in)](#gemini-cli-opt-in)).

**Requirement:** Node.js **22.5 or newer, below 25** — on every install route (npm, the one-line installer, and the offline bundle). SpecShip ships no runtime of its own; it runs on yours. An unsupported Node is caught up front with a message naming the supported range: the npm package declares the range at install time, and the `specship` command refuses to start on Node 25 (a V8 bug crashes grammar compilation there).

## 1. Get the CLI

Two routes put the `specship` binary on your machine — this is the only step where a package manager is involved:

```bash
npm i -g @specship/specship        # online
```

Or, with no npm and no network, use the [offline bundle](#offline--air-gapped-install): download the release archive, extract, and run its `install.sh` / `install.ps1`.

## 2. Wire Claude Code

```bash
specship install
```

`specship install` is **wiring-only** — it never installs or updates the binary (and never touches npm). It:

- Asks **one question**: wire SpecShip into **just this project** (the default) or **all projects** (global). Pass `--path <repo>` to target a specific repo from anywhere, or `--yes` to skip the question.
- Writes the MCP server entry so Claude Code launches `specship serve --mcp`.
- Adds the read-only `specship_*` tools to Claude Code's auto-allow list, so you aren't prompted on every query (`--no-permissions` to skip).
- Adds the SpecShip **status-line segment** by default — an existing status line is never overwritten (`--skip-statusline` to skip).
- Installs the `/specship:explore` command and the `specship-explorer` subagent — plus, with the spec-driven layer (the default), the `/specship:spec`, `/specship:check`, `/specship:learn`, and `/specship:day` commands and the `spec-author` skill.
- Adds the auto-sync hooks (re-index after the agent edits files; catch up on session start), the per-prompt steering nudge, a one-time reminder when the agent reaches for a raw file search without consulting the index, and a session-start cheat-sheet of SpecShip's commands (`SPECSHIP_NO_CHEATSHEET=1` to silence).
- **Indexes the project** you're installing into by default (`--skip-index` to skip).
- On an interactive, project-local install with the spec-driven layer, offers to gate `specship check` on drift & behaviour (recommended; declining keeps every check advisory — enable later with `specship check --enable-gate drift behaviour`).
- Finishes with an **install check** (runtime, FTS5, MCP server boot, index) and a **restart reminder**.

Every defaulted decision is named in the closing summary together with the flag that opts out of it — nothing happens invisibly.

If the `specship` command isn't on your PATH yet, the installer warns (Claude Code launches it by name) and points at both acquisition routes — it never runs them for you.

A default install gives you the **full surface**: the retrieval layer (the agent explores the index instead of re-reading files, plus a per-prompt nudge steering it there) **and the spec-driven layer** — the `/specship:spec` and `/specship:check` doors plus the "author a spec first" steering. Spec-driven development is on by default as of 0.18; pass `--no-sdd` for a retrieval-only install (the old default). An existing install is preserved on upgrade; it's never silently downgraded.

## Project-local vs global

A no-flag `specship install` is **project-local** by default — it writes to `./.mcp.json` and `./.claude/settings.json`, so SpecShip's MCP tools only load for Claude Code sessions in this project. That keeps the always-on tool-list overhead out of sessions on unrelated projects.

Pass `--location global` to write to `~/.claude.json` and `~/.claude/settings.json` instead, so a single install works in every project you open.

## Non-interactive (scripting / CI)

```bash
specship install --yes                        # project-local, auto-allow on, full surface
specship install --yes --location global      # all projects
specship install --with-jira --with-designer  # also enable the optional integrations
specship install --no-sdd                     # retrieval-only (skip the spec-driven layer)
specship install --no-permissions             # skip the auto-allow list
specship install --print-config               # print the MCP snippet, no file writes
```

| Flag | Values | Default |
|---|---|---|
| `--location` | `global`, `local` | prompt (highlights `local`) |
| `--path <repo>` | target repo to wire + initialize, from any cwd | current directory |
| `--yes` | (boolean) non-interactive | interactive asks one question (location) → `local` |
| `--skip-statusline` | (boolean) don't add the SpecShip status-line segment (an existing status line is never overwritten either way) | segment added |
| `--skip-index` | (boolean) don't index the project being wired | indexed |
| `--no-sdd` | (boolean) skip the spec-driven layer (`/specship:spec` + `/specship:check` doors + steering) — retrieval-only | spec-driven layer ON |
| `--with-jira` | (boolean) enable the optional JIRA integration (talks to your Atlassian instance; never auto-allowed — Claude prompts per call) | off (core stays 100% local) |
| `--with-designer` | (boolean) enable the optional Designer integration (**experimental** — drives claude.ai/design via a debug Chrome session) | off |
| `--no-permissions` | (boolean) skip the auto-allow list | permissions on |
| `--target <ids>` | `claude`, `gemini`, `claude,gemini` | `claude` |
| `--print-config` | print the MCP snippet and exit (Claude Code; `--target gemini` prints the Gemini CLI snippet) | — |

> Integrations are remembered: a later plain `specship install` preserves an earlier `--with-*` opt-in — it never silently disables one.

The default install also wires a tiny per-prompt nudge that steers Claude Code toward `specship_explore` before it reads or edits code — the pattern that saves the most time. It only speaks in projects with a SpecShip index; set `SPECSHIP_NO_STEERING=1` to turn it off (see [Configuration](/getting-started/configuration/#environment-variables) for how to set environment variables).

> `--yes` is non-interactive and resolves to a **project-local** install. Pass `--location global` alongside it for the old global behavior.

## 3. Restart Claude Code

An MCP server added to the config is **not visible to a session that's already open**. Restart Claude Code (or run `/mcp`) so it loads the `specship_*` tools.

The install check that ends `specship install` is advisory — it never fails the install. To diagnose an install at any time, run:

```bash
specship doctor          # human-readable
specship doctor --json   # for scripts
```

`doctor` is read-only and runs the same four checks — the runtime and SQLite backend, FTS5 full-text search, MCP server boot, and whether the project index answers a query — and **exits non-zero on a usage-blocking failure**, so it can gate a provisioning script or CI step. See [Troubleshooting](/troubleshooting/) for fixes.

## 4. Initialize more projects

The install already indexed the project you ran it in. For any other project:

```bash
cd your-project
specship init
```

`specship init` builds the per-project knowledge graph index (indexing runs by default — the old `-i`/`--index` flag is accepted but no longer needed). A global install then works in every project you open.

## Gemini CLI (opt-in)

Gemini CLI can use the same SpecShip MCP server. It is **never installed by default** — a plain `specship install` sets up Claude Code alone.

```bash
specship install --target gemini              # Gemini CLI only
specship install --target claude,gemini       # both
specship install --print-config --target gemini   # print the snippet, write nothing
```

`--target gemini` writes the `specship` entry into Gemini CLI's `mcpServers` block — `~/.gemini/settings.json` for all projects, or `./.gemini/settings.json` for just this one — leaving any other servers and settings untouched. Re-running it changes nothing, and an integration you enabled earlier stays enabled. `--print-config --target gemini` prints the same entry for you to paste by hand (global unless you add `--location local`).

The entry sets `SPECSHIP_HOST=gemini`, which lets SpecShip read the session's model from Gemini CLI's own settings and size its output for it (Flash gets the compact output) — keep it if you paste the snippet by hand.

**What Gemini gets:** the SpecShip MCP tools and the server's built-in guidance — nothing else. Slash commands, auto-sync and steering hooks, the `specship-explorer` subagent, the status line, and the auto-allow list are Claude Code features with no Gemini equivalent; the installer prints a note saying so. Remove the Gemini wiring alone with `specship uninstall --target gemini --keep-data`.

## Supported platforms

Every release ships a prebuilt bundle (nothing to compile; runs on your machine's Node 22.5+, below 25) for all three desktop OSes, on both x64 and arm64:

| Platform | Architectures | Install |
|---|---|---|
| Windows | x64, arm64 | PowerShell installer or npm |
| macOS | x64, arm64 | shell installer or npm |
| Linux | x64, arm64 | shell installer or npm |

## Offline / air-gapped install

Every release is a **prebuilt bundle** — the app with zero native addons to compile — so it installs on a machine with **no npm, no compiler, and no internet**. The larger parser grammars ship compressed and decompress transparently on first use, so everything still works fully offline. The one prerequisite is **Node.js 22.5 or newer (below 25)** already installed on that machine; the bundle ships no runtime of its own and runs on yours. Download the bundle on a connected machine, copy it across, and run the installer baked inside it.

**1. On a machine with internet**, grab the archive matching the *offline* machine's platform from the [Releases page](https://github.com/selvakumarEsra/specship/releases) — `specship-<target>.tar.gz` (or `.zip` on Windows), where `<target>` is one of `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`.

**2. On the offline machine**, extract the archive and run the bundle's own installer. It puts `specship` on your `PATH`, then **asks where to wire Claude Code** — globally (every project) or a specific repo (project-local, indexing that repo) — using only the bundled app and your machine's Node; nothing is compiled and nothing is fetched:

```bash
tar -xzf specship-<target>.tar.gz
cd specship-<target>
./install.sh                     # interactive: asks global vs one repo
./install.sh --global            # non-interactive: wire all projects
./install.sh --path ~/dev/myrepo # non-interactive: wire + index one repo
./install.sh --skip-claude       # PATH only; wire later with `specship install`
```

Without a terminal (scripted installs), the default is **global** — the installer never writes project wiring into the bundle directory. On Windows the same choices are `-Global`, `-Path C:\dev\myrepo`, `-SkipClaude`.

On **Windows**, unzip `specship-win32-<arch>.zip` and run `.\install.ps1` from the extracted folder. On **macOS**, clear Gatekeeper quarantine on the unsigned bundle first, or the launcher is blocked: `xattr -dr com.apple.quarantine specship-<target>`.

The installer honors `SPECSHIP_INSTALL_DIR` (default `~/.specship`) and `SPECSHIP_BIN_DIR` (default `~/.local/bin`); add the bin dir to your `PATH` if it isn't already there. To reverse it, run `./install.sh --uninstall`. Then, in any project:

```bash
cd your-repo && specship init
```

**From a source checkout?** `scripts/offline-install.sh <bundle>` (and `scripts/offline-install.ps1` on Windows) does the same given a downloaded bundle directory or archive. This is a bundle-install path, **not a build from source** — it never runs npm or a compiler on the target.

If the offline machine has no `node` on its `PATH` — or one outside 22.5–24.x — the installer stops with a clear message instead of leaving a broken install. `npm i -g` is *not* an offline path (it resolves per-platform packages from the npm registry) — use the release archive above.

## Uninstall

```bash
specship uninstall
```

This is a **complete removal**: it unwires SpecShip from Claude Code at both locations (MCP entry, auto-allow permissions, slash commands, hooks, steering, status line), removes a Gemini CLI entry if one exists, deletes the current project's `.specship/` index and the user-level `~/.specship/` directory (including worktrees and any saved JIRA credentials), and removes the `specship` program itself. It first lists exactly what will be deleted and asks for confirmation (`--yes` / `--force` skips the prompt). Indexes in *other* projects aren't discovered automatically — remove those per-project with `specship uninit`.

To only unwire and keep your data and the binary:

```bash
specship uninstall --keep-data                     # project-local wiring
specship uninstall --keep-data --location global   # global wiring
```
