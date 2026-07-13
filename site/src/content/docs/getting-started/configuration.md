---
title: Configuration
description: Zero config files — plus the environment-variable switches for steering, compaction, integrations, and the watcher.
---

SpecShip is **zero-config** — no config file to write or keep in sync; behavior is tuned through a handful of environment variables (below). Language support is automatic from the file extension; there's nothing to wire up per language.

## What it skips out of the box

- **Dependency, build, and cache directories** — `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `Pods`, `.next`, and the like across every [supported stack](/reference/languages/) — so the graph is your code, not third-party noise. This holds even with no `.gitignore`.
- **Anything in your `.gitignore`** — honored in git repos via git, and in non-git projects by reading `.gitignore` directly (root and nested).
- **Files larger than 1 MB** — generated bundles, minified JS, vendored blobs.

## Excluding or including more

To keep something else out, add it to `.gitignore`. To pull a default-excluded directory back **in** (e.g. you really want a vendored dependency indexed), add a negation — `!vendor/`.

The defaults apply uniformly, so committing a dependency or build directory doesn't force it into the graph — the `.gitignore` negation is the explicit opt-in.

## Environment variables

SpecShip's runtime switches are environment-variable-shaped, and there are three places to set them — from most to least specific:

1. **An actual environment variable** — a shell `export`, or the `env` block in Claude Code's own `settings.json`. Always wins; use for one-off overrides.
2. **`<repo>/.specship/settings.json`** — the project's durable defaults; travels with the repo and overrides the machine level.
3. **`~/.specship/settings.json`** — machine-wide defaults for every project.

The file format is the env-var names as keys, string values:

```json
{
  "SPECSHIP_NO_STEERING": "1",
  "SPECSHIP_COMPACT": "0"
}
```

The settings-file chain currently covers the behavior switches (`SPECSHIP_NO_STEERING`, `SPECSHIP_COMPACT`, `SPECSHIP_MODEL`); the remaining variables below are env-only for now. The switches you'd actually reach for:

| Variable | What it does | Default |
|---|---|---|
| `SPECSHIP_NO_STEERING=1` | Turn off the per-prompt "use the graph first" nudge | steering on |
| `SPECSHIP_COMPACT=0` | Disable smaller-model output compaction entirely (also disables the tier-specific rendering) | compaction auto by model |
| `SPECSHIP_MODEL=<id>` | Force the model tier for compaction — normally detected automatically from the session | auto-detect |
| `SPECSHIP_INTEGRATIONS` | Which optional tool groups the MCP server exposes (`jira`, `designer`). The installer writes this into the MCP entry for `--with-jira` / `--with-designer`; you rarely set it by hand | none (local-only core) |
| `SPECSHIP_WATCH_DEBOUNCE_MS` | Auto-sync debounce after a file change (clamped 100 ms – 60 s) | `2000` |
| `SPECSHIP_NO_DAEMON=1` | Disable the file watcher (sandboxed environments; run `specship sync` manually) | watcher on |
| `SPECSHIP_MCP_TOOLS` | Comma-separated allowlist trimming the exposed MCP tool surface | all tools |

The complete generated list of every `SPECSHIP_*` variable the code reads is in the [CLI reference](/reference/cli/#environment-variables).

## Where data lives

Per-project data lives in a `.specship/` directory at your project root, containing the SQLite database (`specship.db`). Nothing leaves your machine.
