---
title: Channels — CLI, dashboard, CI
description: Where you can run workflows. The same YAML, three surfaces — the terminal, the desktop dashboard, and CI.
---

A workflow is just a file. **Where** it runs is the user's choice. The YAML is the same everywhere, and every surface reads and writes the same SQLite, so a run started in one place can be approved and inspected in another.

| Channel | Surface | Best for |
|---|---|---|
| **CLI** | terminal (and the `/specship:*` slash commands) | day-to-day; what most users use most of the time |
| **Dashboard** | `specship desktop` at `http://127.0.0.1:4242` | review-heavy runs; live timeline, artifacts, one-click gate actions, drift-queue repairs |
| **CI** | any CI runner, via the CLI | deterministic checks on every PR |

## CLI

```bash
specship workflow run <name> --input KEY=VAL [--input KEY=VAL ...]
```

`run` executes the workflow in the foreground until it **completes, fails, or pauses at an approval gate**, then prints the result:

```
$ specship workflow run spec-implement --input SPEC_ID=REQ-AUTH-005
Run 9f3a2b1c-4d… → paused
Worktree: /Users/you/.specship/worktrees/3a7f09c2e4b1/spec-implement-9f3a2b1c
```

At a gate, read the step outputs (`.specship/artifacts/runs/<runId>/nodes/`, or the dashboard's run page), then decide:

```bash
specship workflow approve 9f3a2b1c-… --comment "looks good"   # record the approval
specship workflow resume  9f3a2b1c-…                          # carry the run past the gate
```

The full set of actions:

| Command | What it does |
|---|---|
| `specship workflow list` | Discovered workflows with their tier and node count, plus any files that failed validation. |
| `specship workflow run <name> -i KEY=VAL` | Start a run. |
| `specship workflow runs` | The 50 most recent runs with status and duration. |
| `specship workflow approve <runId> [--comment "…"]` | Approve the paused gate. Follow with `resume`. |
| `specship workflow reject <runId> --reason "…"` | Park the run as `rejected`, worktree and artifacts intact. |
| `specship workflow resume <runId>` | Continue an approved run, or revise a rejected one (runs the gate's `on_reject` prompt with your reason, then pauses for re-review). |
| `specship workflow cancel <runId> [--reason "…"]` | Stop a run. The worktree is kept. |
| `specship workflow purge <runId>` | Remove a finished run's worktree and branch — the only way anything is deleted. Artifacts and the run record are kept. |

`--json` gives machine-readable output for `list`, `run` and `runs`; `--path <projectRoot>` targets another project. Commands that take a `<runId>` need the full id — copy it from the `run` output, the dashboard, or `specship workflow runs --json`.

You'll rarely type `workflow run` for the bundled workflows: `/specship:spec implement <SPEC_ID>` launches `spec-implement`, `/specship:spec design <url>` launches `claude-design-implement`, and `/specship:check fix <SPEC_ID>` launches `spec-fix`.

## Dashboard

`specship desktop` starts a local server on `http://127.0.0.1:4242` (change it with `--port` / `--host`) that serves the dashboard and its HTTP API. For workflows it gives you:

- **Workflows** — every discovered workflow with its inputs. **Launch** opens a form generated from the workflow's `inputs:` (required fields enforced, defaults pre-filled) and takes you to the new run.
- **Runs** — every run, filterable by status (`running`, `paused`, `rejected`, `completed`, `failed`, `cancelled`), with duration, cost and model. Open one for its live event timeline — `step_started`, `tool_called`, `agent_message`, `step_completed`, `approval_requested` — per-step cost and duration, and each step's artifact rendered inline.
- **Gate actions on the run page** — **Approve** (records the approval and resumes in one click), **Reject** with a reason, **Cancel**, and on a rejected run **Resume & revise** or **Purge worktree**.
- **Drift queue repairs** — each drifted, broken or orphaned link has a button that launches the matching workflow: **Fix** → `spec-fix`, **Re-verify** → `spec-verify`, **Re-attach** → `spec-relink`.

Because every event and artifact is persisted, you can open a run from a week ago and see exactly what happened. For the rest of the dashboard, see [Claude Code — Overview](/claude-code/overview/).

## CI

There's no dedicated GitHub Action — run SpecShip's CLI in a job like any other tool. What works well headlessly is the **deterministic** part of SpecShip:

```yaml
# .github/workflows/specship-gate.yml
name: SpecShip gate

on:
  pull_request:
    branches: [main]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm i -g @specship/specship
      - run: specship init                            # build the graph on the clean clone
      - run: npx vitest run --reporter=json --outputFile=vitest.json || true
      - run: specship verify --report vitest.json     # promote/demote links from real test results
      - run: specship check --since origin/main       # drift + behaviour gate for the touched specs
      - run: specship suppressions --since origin/main
```

- `specship verify --report` maps a vitest JSON report onto declared test-evidence links and moves link state itself — no model involved.
- `specship check` fails only on the checks you've configured to gate; see the [CLI reference](/reference/cli/).
- `specship suppressions` exits non-zero when the change adds lint/type suppression comments.

Running a whole **workflow** in CI is possible (`specship workflow run spec-verify`), but every `prompt` node runs Claude Code headless, so the runner needs the `claude` CLI installed and authenticated, and a run that reaches an approval gate stops there with status `paused` — CI can't approve it. Keep workflows with gates for the CLI and the dashboard.

## What's the right channel for what?

| If… | Use… |
|---|---|
| You're iterating fast and want to see output immediately | **CLI** |
| You need to review a diff or read an agent's plan carefully | **Dashboard** |
| You're triaging the drift queue | **Dashboard** (one click per repair) |
| You want automated checks on every PR | **CI**, with the deterministic commands |

→ Back to [Workflows — Overview](/workflows/overview/).
