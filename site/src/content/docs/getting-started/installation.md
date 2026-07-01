---
title: Installation
description: Install SpecShip and wire it into Claude Code.
---

SpecShip is **Claude Code only** — the installer configures one agent on purpose, so the surface stays small and easy to keep correct. If you need MCP integration with another agent that speaks the protocol, point it at `specship serve --mcp` by hand (see [MCP & Claude Code wiring](/reference/integrations/)).

## 1. Run the installer

```bash
npx @specship/specship install
```

The installer will:

- Ask whether to wire SpecShip into **just this project** (the default) or **all projects** (global).
- Write the MCP server entry so Claude Code launches `specship serve --mcp`.
- Add the read-only `specship_*` (and `designer_*`) tools to Claude Code's auto-allow list, so you aren't prompted on every query.
- Install the **`/ss-explore`** reads door and the `specship-explorer` subagent.
- Add the auto-sync hooks (re-index after the agent edits files; catch up on session start).
- For a project-local install, initialize the current project and build its index.

That's the **retrieval wedge** — everything you need for the agent to explore the index instead of re-reading files, with zero workflow change. The **spec-driven layer** (the `/ss-spec` and `/ss-check` doors plus the "author a spec first" steering) is **opt-in** — add it with `specship install --sdd` when you want it. An existing spec-driven install is preserved on upgrade; it's never silently downgraded.

## Project-local vs global

A no-flag `specship install` is **project-local** by default — it writes to `./.mcp.json` and `./.claude/settings.json`, so SpecShip's MCP tools only load for Claude Code sessions in this project. That keeps the always-on tool-list overhead out of sessions on unrelated projects.

Pass `--location global` to write to `~/.claude.json` and `~/.claude/settings.json` instead, so a single install works in every project you open.

## Non-interactive (scripting / CI)

```bash
specship install --yes                       # project-local, auto-allow on, retrieval only
specship install --yes --location global      # all projects
specship install --sdd                        # ALSO install the spec-driven layer (doors + steering)
specship install --no-permissions             # skip the auto-allow list
specship install --print-config               # print the MCP snippet, no file writes
```

| Flag | Values | Default |
|---|---|---|
| `--location` | `global`, `local` | prompt (highlights `local`) |
| `--yes` | (boolean) non-interactive | prompt every step → `local` |
| `--sdd` | (boolean) also install the spec-driven layer (`/ss-spec` + `/ss-check` doors + steering) | off (retrieval only) |
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

## Offline / air-gapped install

Every release is a **self-contained bundle** — a vendored Node runtime plus the app, with zero native addons to compile — so it installs on a machine with **no npm, no compiler, and no internet**. Download the bundle on a connected machine, copy it across, and run the installer baked inside it.

**1. On a machine with internet**, grab the archive matching the *offline* machine's platform from the [Releases page](https://github.com/selvakumarEsra/specship/releases) — `specship-<target>.tar.gz` (or `.zip` on Windows), where `<target>` is one of `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`.

**2. On the offline machine**, extract the archive and run the bundle's own installer. It puts `specship` on your `PATH` and wires Claude Code (MCP server, permissions, slash commands, auto-sync hooks) using only the bundled runtime — nothing is compiled and nothing is fetched:

```bash
tar -xzf specship-<target>.tar.gz
cd specship-<target>
./install.sh                 # add --skip-claude to install onto PATH only
```

On **Windows**, unzip `specship-win32-<arch>.zip` and run `.\install.ps1` from the extracted folder. On **macOS**, clear Gatekeeper quarantine on the unsigned bundle first, or the launcher is blocked: `xattr -dr com.apple.quarantine specship-<target>`.

The installer honors `SPECSHIP_INSTALL_DIR` (default `~/.specship`) and `SPECSHIP_BIN_DIR` (default `~/.local/bin`); add the bin dir to your `PATH` if it isn't already there. To reverse it, run `./install.sh --uninstall`. Then, in any project:

```bash
cd your-repo && specship init
```

**From a source checkout?** `scripts/offline-install.sh <bundle>` (and `scripts/offline-install.ps1` on Windows) does the same given a downloaded bundle directory or archive. This is a bundle-install path, **not a build from source** — it never runs npm or a compiler on the target.

The bundle vendors its own Node, so the offline machine needs no Node installed. `npm i -g` is *not* an offline path (it resolves per-platform packages from the npm registry) — use the release archive above.

## Uninstall

```bash
specship uninstall
```

This reverses the installer — stripping SpecShip's MCP server entry, the auto-allow permissions, the slash commands, the auto-sync hooks, and the spec-driven-development steering from Claude Code. It defaults to the same location as install (project-local), so an `--yes` install/uninstall pair stays symmetric; pass `--location global` to remove a global install. Your project indexes (`.specship/`) are left untouched — remove those per-project with `specship uninit`.
