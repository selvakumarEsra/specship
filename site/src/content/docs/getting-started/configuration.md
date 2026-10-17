---
title: Configuration
description: Zero config by default — plus the optional specship.config.json project file and the environment-variable switches for steering, compaction, model tiers, integrations, and the watcher.
---

SpecShip works with **no configuration**. Language support is automatic from the file extension, and the defaults below cover what gets indexed. When you want to tune a project, there are two layers:

- **`specship.config.json`** — an optional, checked-in project file at the repo root for team-shared settings (quality gates, the flow diagram, auto-learn, the JIRA binding, architecture rules).
- **Environment-variable switches** — per-user / per-machine behavior (steering, compaction, model tier, watcher), settable as real env vars or in SpecShip settings files.

## What it skips out of the box

- **Dependency, build, and cache directories** — `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `Pods`, `.next`, and the like across every [supported stack](/reference/languages/) — so the graph is your code, not third-party noise. This holds even with no `.gitignore`.
- **Anything in your `.gitignore`** — honored in git repos via git, and in non-git projects by reading `.gitignore` directly (root and nested).
- **Files larger than 1 MB** — generated bundles, minified JS, vendored blobs.

## Excluding or including more

To keep something else out, add it to `.gitignore`. To pull a default-excluded directory back **in** (e.g. you really want a vendored dependency indexed), add a negation — `!vendor/`.

The defaults apply uniformly, so committing a dependency or build directory doesn't force it into the graph — the `.gitignore` negation is the explicit opt-in.

## Project file: `specship.config.json`

Every block is optional; a missing or unparseable file falls back to defaults. Commit it so your team and CI share the same settings. SpecShip writes to it for you in two places — `specship check --enable-gate <checks...>` and `specship jira bind` — preserving every other key.

```json
{
  "enforce": {
    "gate": { "drift": true, "behaviour": true },
    "behaviour": { "exclude": ["REQ-LEGACY-001"] },
    "mutation": { "report": "reports/mutation/mutation.json", "threshold": 0.8 }
  },
  "diagram": { "enabled": true, "output": "docs/flow-diagram.md", "maxNodes": 150, "depth": 6 },
  "reflect": { "autoSweep": true, "sweepCooldownHours": 6 },
  "jira": {
    "projectKey": "PROJ",
    "epicKey": "PROJ-12",
    "storyIssueType": "Task",
    "subtaskIssueType": "Sub-task"
  }
}
```

| Key | What it does | Default |
|---|---|---|
| `enforce.gate.<check>` | Make a `specship check` check **gating** (non-zero exit) instead of advisory. Checks: `drift`, `behaviour`, `fitness`, `maintainability`, `suppressions`, `mutation`. `--strict` gates everything for one run without touching the file. | every check advisory |
| `enforce.behaviour.exclude` | Requirement IDs excluded from behaviour (test-evidence) gating | none |
| `enforce.mutation.report` | Path to a mutation-testing JSON report (the standard schema Stryker and compatible tools emit). Presence of `enforce.mutation` (or `gate.mutation`) turns the check on; SpecShip never runs the mutation tool itself, and a missing report is reported as *skipped*, never as passing. | check off; `reports/mutation/mutation.json` |
| `enforce.mutation.threshold` | Minimum mutant kill rate (0–1) for a requirement's linked implementation files | `0.8` |
| `diagram.enabled` | Keep `docs/flow-diagram.md` refreshed on every `specship sync` / `index`. The refresh also runs automatically once the diagram file exists (create it with `specship diagram`). | `false` |
| `diagram.output` / `diagram.maxNodes` / `diagram.depth` | Output path, node budget before modules collapse into summary nodes, and call-chain depth — same as the `specship diagram` `--output` / `--max-nodes` / `--depth` flags | `docs/flow-diagram.md` / `150` / `6` |
| `reflect.autoSweep` | Set `false` to stop the background auto-learn pass that piggybacks on `specship sync`. On-demand capture (`/specship:learn`, `specship reflect`) is unaffected. | on |
| `reflect.sweepCooldownHours` | Minimum hours between background learning passes | `6` |
| `maintainability.thresholds` | Override `highDegree`, `largeSymbolLines`, `godFileSymbols` for the maintainability check | built-in |
| `maintainability.exclude` | Globs excluded from the maintainability check (additive) | none |
| `fitness.rules` | Architecture-fitness rules evaluated by `specship fitness` / `specship check` | no rules |
| `jira.projectKey` | The repo's shared JIRA project binding. With a binding committed, every `specship sync` publishes new specs and refreshes changed ones (per-spec opt-out: `jira_publish: false` in frontmatter). Each user still needs their own credentials (`specship jira configure`); without them sync skips publishing with a one-line note. On an unbound repo sync makes zero JIRA calls. | unbound |
| `jira.epicKey` | Default epic new specs are created under (a spec's frontmatter can override) | none — authoring asks |
| `jira.storyIssueType` / `jira.subtaskIssueType` | Issue types to publish as — e.g. `Task` / `Sub-task` for team-managed projects with no `Story` type | `Story` / `Sub-task` |
| `jira.board` / `jira.sprint` | Board and sprint for sprint views and coverage | none |

**Credentials never go in this file.** A credential-shaped field under `jira` (`email`, `apiToken`, `token`, `password`, `username`, `host`, `baseUrl`, `pat`) is rejected with an error naming the file and field — credentials live in `~/.specship/jira.json` (written by `specship jira configure`) or `SPECSHIP_JIRA_*` environment variables. See the [JIRA guide](/guides/jira/).

## Environment variables

SpecShip's runtime switches are environment-variable-shaped, and there are three places to set them — from most to least specific:

1. **An actual environment variable** — a shell `export`, or the `env` block in Claude Code's own `settings.json`. Always wins; use for one-off overrides.
2. **`<repo>/.specship/settings.json`** — the project's durable defaults; overrides the machine level.
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
| `SPECSHIP_NO_STEERING=1` | Turn off the per-prompt "use the graph first" nudge and the raw-file-search reminder | steering on |
| `SPECSHIP_NO_CHEATSHEET=1` | Turn off the session-start cheat-sheet of SpecShip commands (prints once per session startup) | cheat-sheet on |
| `SPECSHIP_NO_STATUSLINE_TIPS=1` | Turn off the rotating usage tip on the status-line segment | tips on |
| `SPECSHIP_COMPACT=0` | Disable smaller-model output tuning entirely (also disables the tier-specific rendering) | auto by model |
| `SPECSHIP_MODEL=<tier-or-id>` | Force the model tier — either a tier name (`lite`, `standard`, `full`) or a model id (`gemini-3.5-flash`, `claude-haiku-4-5`). Wins over auto-detection | auto-detect |
| `SPECSHIP_HOST=gemini` | Marks the MCP server as launched by Gemini CLI, enabling tier detection from Gemini's settings. Written into the entry by `--target gemini`; include it if you paste the snippet by hand | unset (Claude Code) |
| `SPECSHIP_INTEGRATIONS` | Which optional tool groups the MCP server exposes (`jira`, `designer`). The installer writes this into the MCP entry for `--with-jira` / `--with-designer`; you rarely set it by hand | none (local-only core) |
| `SPECSHIP_MCP_TOOLS` | Comma-separated allowlist trimming the exposed MCP tool surface | all tools |
| `SPECSHIP_NO_WATCH=1` | Disable the file watcher (run `specship sync` manually, or let the git hooks sync) | watcher on |
| `SPECSHIP_FORCE_WATCH=1` | Force the watcher on where it's auto-disabled (WSL2 `/mnt/*` drives) | auto |
| `SPECSHIP_WATCH_DEBOUNCE_MS` | Auto-sync debounce after a file change (clamped 100 ms – 60 s) | `2000` |
| `SPECSHIP_NO_DAEMON=1` | Don't share one background MCP daemon across sessions — each MCP client gets its own direct server process | shared daemon |
| `SPECSHIP_SQLITE_BACKEND` | Force the SQLite backend: `node-sqlite` (Node's built-in) or `better-sqlite3` (when installed) | `better-sqlite3` if installed, else `node-sqlite` |

The complete generated list of every `SPECSHIP_*` variable the code reads is in the [CLI reference](/reference/cli/#environment-variables).

### How the model tier is detected

Output is sized to the model running the session — `lite` (Haiku, Gemini Flash), `standard`, or `full` — resolved in this order; the first hit wins:

1. `SPECSHIP_COMPACT=0` — tuning off entirely (full output).
2. `SPECSHIP_MODEL` — the manual override, naming a tier or a model id.
3. The Claude Code session model, recorded by the status line / session-start hook.
4. Gemini CLI's own configuration: the `GEMINI_MODEL` environment variable, then `model` in `.gemini/settings.json` (your project's file first, then `~/.gemini/settings.json`). This is how a Gemini CLI session gets a tier — it has no status line or hooks to read. This step only runs when the server was launched by Gemini CLI, which `specship install --target gemini` guarantees by setting `SPECSHIP_HOST=gemini` in the MCP entry. A Claude Code session in a repo that also uses Gemini CLI is never affected by these files.
5. Nothing detected — full output, unchanged. SpecShip never trims for a model it can't identify.

Gemini settings are only ever read, never written, and an unreadable or malformed settings file is simply treated as "unknown model".

## Where data lives

- **`<repo>/.specship/`** — the project's SQLite database (`specship.db`) and per-project state (`settings.json`, learned conventions). Nothing leaves your machine.
- **`<repo>/specship.config.json`** — the optional, checked-in project file above.
- **`~/.specship/`** — user-level state: machine-wide `settings.json`, workflow worktrees, and `jira.json` credentials if you configured JIRA.
