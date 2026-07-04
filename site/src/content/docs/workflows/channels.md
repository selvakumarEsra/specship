---
title: Channels — CLI, Web UI, GitHub Actions
description: Where you can run workflows. The same YAML, three surfaces — terminal, desktop web UI, and CI.
---

A workflow is just a file. **Where** it runs is the user's choice. SpecShip ships three channels today; the YAML is the same on all three.

| Channel | Surface | Best for |
|---|---|---|
| **CLI** | terminal | day-to-day; what most users use most of the time |
| **Web UI** | desktop app at `:4242` | review-heavy runs; live timeline + artifact viewer |
| **GitHub Actions** | CI | nightly runs; PR-triggered runs; team-wide automation |

## CLI

```bash
specship workflow run <name> --input KEY=VAL [--input KEY=VAL ...]
```

Outputs a run id and starts streaming events:

```
$ specship workflow run spec-implement --input SPEC_ID=REQ-AUTH-005
[runId] 9f3a2b1c
✓ plan        (28s · $0.41)
✓ implement   (52s · $1.88)
✓ test        (15s)
⠦ review      paused — awaiting approval
```

While paused, in another terminal:

```bash
specship workflow approve 9f3a2b1c --comment "looks good"
```

The original terminal picks up the resume and continues. Or:

```bash
specship workflow reject 9f3a2b1c --reason "missing error case for expired refresh token"
specship workflow cancel 9f3a2b1c
specship workflow resume 9f3a2b1c
specship workflow status 9f3a2b1c
specship workflow list                  # all your recent runs
```

The CLI is a thin client over SpecShip's runner; an approval issued via CLI and an approval issued from the Web UI hit the same endpoint and have the same effect.

## Desktop dashboard

`specship serve --ui` boots a single-process Fastify server that renders the dashboard **server-side** on `http://127.0.0.1:4242`. The dashboard is **read-only** — you launch and approve workflows from the CLI (`specship workflow run`) or the `/specship:*` slash commands, and watch the results here:

- **Runs** lists every discovered run; open one for its persisted event timeline — `step_started`, `tool_called`, `artifact_created`, `approval_requested` — with timestamps.
- Per-step artifacts (`plan.md`, `diff.md`, `test_results.md`) render inline.

Because every event and artifact is persisted in SpecShip's SQLite, you can replay the timeline of a run from a week ago and see exactly what happened.

→ Read the full UI walkthrough at [Claude Code — Overview](/claude-code/overview/) (the dashboard) and [the README's Dashboard section](https://github.com/selvakumarEsra/specship#dashboard).

## GitHub Actions

Run a workflow from CI by checking out the repo, installing SpecShip, and invoking it like the CLI:

```yaml
# .github/workflows/spec-verify-on-pr.yml
name: Verify spec links

on:
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm i -g @specship/specship
      - run: specship init -i           # build the graph on the clean clone
      - name: Run spec-verify
        run: specship workflow run spec-verify --background
      - name: Wait for completion
        run: specship workflow wait $(specship workflow list --limit 1 --json | jq -r '.[0].id')
```

What this CI run does:

1. Checks out the repo (full history so the graph can index everything).
2. Installs Node, installs SpecShip globally.
3. Runs `specship init -i` to build the knowledge graph fresh on the CI runner.
4. Runs the `spec-verify` workflow in the background, then `--wait`s for it.
5. The workflow's exit code becomes the job's exit code — fails the PR if any spec is `drifted` or `broken`.

For workflows that need approval gates in CI, use a **GitHub Environment** with required reviewers. The job's pause maps cleanly to the environment's "waiting for approval" state.

### Posting events back as PR comments

A separate `specship gh-comment <runId>` command turns a finished run's event timeline into a Markdown comment and `gh pr comment`s it onto the PR. Drop it as the last step of your job:

```yaml
      - name: Post run summary to PR
        if: always()
        run: specship gh-comment $(specship workflow list --limit 1 --json | jq -r '.[0].id')
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The comment renders the per-step timing, cost, artifact list, and (for failed runs) the error message + a link to download `plan.md` / `diff.md` from the run artifacts.

## What's the right channel for what?

A loose rule of thumb:

| If… | Use… |
|---|---|
| You're iterating fast and want to see output immediately | **CLI** |
| You need to review a diff or read an agent's plan carefully | **Web UI** |
| You want automated runs on every PR | **GitHub Actions** |
| You're sharing a workflow with non-coding teammates | **Web UI** (no terminal required) |
| You want audit trail of every prod-bound change | **GitHub Actions** with approvals |

All three read and write the same SQLite, so a run started on the CLI can be approved in the Web UI and inspected later from CI.

→ Back to [Workflows — Overview](/workflows/overview/).
