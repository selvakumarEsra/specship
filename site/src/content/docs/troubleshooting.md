---
title: Troubleshooting
description: Fixes for the most common SpecShip issues.
---

## Start with `specship doctor`

```bash
specship doctor            # or: specship doctor --json
```

It's read-only and checks the four things an install needs: the **runtime** (the SQLite backend loads), **FTS5** full-text search, **MCP server boot** (it spawns `specship serve --mcp` and waits for a reply), and whether the **project index** answers a query. It exits non-zero on a usage-blocking failure and prints a remediation line for each failing check. The same check runs at the end of `specship install`, where it is advisory only.

## "Unsupported Node.js version" / the installer refuses your Node

SpecShip needs **Node.js 22.5 or newer, below 25** — it runs on your installed Node and ships no runtime of its own.

- **Node 25.x** — the `specship` command stops with a banner: a V8 WASM-compiler bug crashes Node 25 with `Fatal process out of memory: Zone` while compiling parser grammars. Install Node 24 or 22 LTS (e.g. `nvm install 24 && nvm use 24`). `SPECSHIP_ALLOW_UNSAFE_NODE=1` bypasses the check, but expect the crash.
- **Older than 22.5** — the npm package declares the supported range, and the bundle installers stop with a message naming it. Upgrade Node.
- **Offline bundle** — the bundle's `install.sh` / `install.ps1` checks the `node` on your `PATH` before installing; install a supported Node on that machine first.

## FTS5 check fails / `no such module: fts5`

SpecShip's search index needs SQLite's FTS5 extension. It uses `better-sqlite3` when that package is installed (its bundled SQLite always has FTS5), otherwise Node's built-in `node:sqlite` — and some Node builds (notably some Node 22.x builds) ship `node:sqlite` without FTS5.

- **Use Node 24**, whose built-in SQLite includes FTS5. This is the simplest fix.
- **Running from source / a dev checkout?** Install `better-sqlite3` (`npm install --save-dev better-sqlite3`). If you see `Could not locate the bindings file`, its native module was built for a different Node — run `npm rebuild better-sqlite3` under the Node you're actually using.
- `specship status` shows which backend is live (`Backend:`), and `SPECSHIP_SQLITE_BACKEND=node-sqlite|better-sqlite3` forces one.

## The SpecShip tools don't appear in Claude Code

- **Restart Claude Code** (or run `/mcp`) after `specship install` — an MCP server added to the config is not visible to a session that was already open.
- **Project-local install, different project.** A default install is project-local: the tools only load in the project you installed into. Re-run `specship install` there, or use `--location global`.
- **`specship` not on `PATH`.** Claude Code launches `specship serve --mcp` by name; the installer warns when it can't find it. Add the npm global bin (or `~/.local/bin` for bundle installs) to your `PATH`.
- Run `specship doctor` — the MCP-boot check fails if the server can't start.

## A session still behaves like an older SpecShip after upgrading

The MCP server Claude Code launches may not be the `specship` on your `PATH` (e.g. a leftover global install). Ask the agent to run `specship_status` — it reports the running server's version, install method, and install directory. Fix the stale install, then restart Claude Code.

## "SpecShip not initialized"

Run `specship init` in your project directory first (it builds the index too).

## `specship index` scans your whole home directory

If indexing finds tens of thousands of files and runs for a very long time, check the `Project:` line in `specship status`. When the current repo has no index database (`.specship/specship.db` was deleted or never created), the CLI looks in **parent directories** for an initialized project — and can land on your home directory, then crawl it. Passing an explicit path doesn't prevent this.

Stop the run (Ctrl-C), then re-anchor the repo:

```bash
cd your-repo
specship init .      # recreates the index here (takes the path literally)
specship status      # Project: should now be your repo
```

## Indexing is slow

Check that `node_modules` and other large directories are excluded (they are by default, and anything gitignored is skipped). Files over 1 MB are skipped. Use `--quiet` to reduce output overhead.

## MCP hits `database is locked`

SpecShip opens SQLite in WAL mode, where concurrent reads never block on a writer. If you still see it:

- **`specship status` shows `Journal:` other than `wal`** — WAL couldn't be enabled on this filesystem (common on network shares and WSL2 `/mnt`), so reads can block on writes. Move the project (with its `.specship/` folder) onto a local disk.

## Indexing is blocked by a stale lock

If an indexing run was killed, its lock file can block the next one. `specship unlock` removes it.

## Index goes stale on WSL2 `/mnt` drives

Recursive file watching is unreliable there, so the watcher is disabled automatically. The installer offers git hooks that re-sync after commit / pull / checkout; otherwise run `specship sync` after changes. `SPECSHIP_FORCE_WATCH=1` forces the watcher on.

## Missing symbols

The MCP server auto-syncs on save (wait a couple of seconds). Run `specship sync` manually if needed. Check that the file's language is [supported](/reference/languages/) and isn't excluded by `.gitignore`.

## Output looks condensed

On a lightweight model (Haiku, Gemini Flash) SpecShip deliberately returns tighter output — complete source for fewer files. Force the tier with `SPECSHIP_MODEL=full`, or turn the tuning off with `SPECSHIP_COMPACT=0`. See [Configuration](/getting-started/configuration/#how-the-model-tier-is-detected).
