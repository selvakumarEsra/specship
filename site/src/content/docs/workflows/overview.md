---
title: Workflows — Overview
description: Define multi-step development workflows in YAML and run them with a single command. Spec → plan → code → test → review, on rails.
---

SpecShip's workflow engine runs **multi-step development tasks for AI coding agents** the same way you'd run a CI pipeline — except the steps are agent prompts, shell commands, approval gates, and code-graph queries, chained into a DAG.

Pick a workflow (a YAML file), give it inputs, and SpecShip:

1. Opens an **isolated git worktree** so the agent can work without touching your main checkout.
2. Walks the DAG, running each node's runner (`agent` / `shell` / `bash` / `approval` / `script`).
3. Streams **events** (`step_started`, `tool_called`, `artifact_created`, `approval_requested`) over the same SSE channel the desktop UI watches live.
4. Writes typed **artifacts** per node (`plan.md`, `diff.md`, `test_results.md`, `link_summary.md`).
5. Pauses at any **approval gate**; a human approves or rejects via CLI, the desktop UI, or a GitHub Actions comment.
6. On success, merges the worktree back. On failure, the worktree is preserved so you can poke at it.

```bash
specship workflow run spec-implement --input SPEC_ID=REQ-AUTH-005
```

That one command opens a worktree, plans the implementation against the knowledge graph, writes code, runs the affected tests, asks you to approve the diff, and merges — without ever touching your working tree.

## Why YAML?

YAML workflows make the agent's approach **legible, repeatable, and shareable**. Three concrete benefits:

| | |
|---|---|
| **Repeatable** | A workflow that worked last week works the same way today. Determinism around the agent's *plumbing* (steps, ordering, gates) is a forcing function for predictable output even when the agent itself is non-deterministic. |
| **Shareable** | Drop a `.specship/workflows/my-feature.yaml` in any repo and your whole team gets the same multi-step recipe. Workflows are just files. Review them in PRs. |
| **Auditable** | Every run writes events + artifacts to SQLite. You can replay any run's event timeline and see exactly what the agent did, what it cost, what diff it produced, and where a human intervened. |

## The four bundled workflows

| Workflow | Inputs | What it does |
|---|---|---|
| `spec-implement` | `SPEC_ID` | Plan → implement → run affected tests → approval gate → merge worktree |
| `spec-fix` | `SPEC_ID` | Diagnose a drifted/broken spec link → fix code → re-verify → re-link |
| `spec-verify` | `SPEC_ID` *(optional)* | Re-run the tests linked to a spec, promote `implemented` links to `verified` |
| `spec-relink` | `SPEC_ID` | Search the graph for a likely new home for an orphaned link → re-attach with confidence |

All four are tied to **specs** — that's SpecShip's bet that **specifications are the right unit of work**, not arbitrary prompts. But the runner is general; you can write workflows that have nothing to do with specs.

## Composability — DAGs, not scripts

Workflows are **directed acyclic graphs**, not linear scripts. Nodes can:

- **Depend on multiple parents** — fan-in to wait for several upstream steps.
- **Fan out into multiple children** — parallel test suites, parallel review LLMs.
- **Skip conditionally** — `when:` runs the node only if a previous step's output matches.
- **Loop** — re-run a sub-DAG until a condition is met (e.g. _"keep fixing tests until they pass, max 3 attempts"_).
- **Pause at approval gates** — wait for a human, then resume.

```yaml
steps:
  - id: plan
    runner: agent
    output: plan.md

  - id: lint
    runner: bash
    depends_on: [plan]

  - id: types
    runner: bash
    depends_on: [plan]

  - id: review
    runner: approval
    depends_on: [lint, types]
    message: "Plan looks good?"
```

Here `lint` and `types` run in parallel after `plan`, and `review` waits for both.

## Isolation — every run gets its own worktree

When a workflow starts, SpecShip provisions a **git worktree** under `.specship/wt/<runId>/`. Every step's `pwd` is the worktree, so the agent's edits, the bash commands, the test outputs all happen in an isolated checkout pinned to a branch.

If the workflow succeeds and reaches a `shell` step that fast-forward-merges back, the worktree's branch lands on `main` (or wherever). If anything fails, the worktree is **left behind** for you to inspect.

→ Read [Isolation & worktrees](/specship/workflows/isolation/) for the details.

## Portability — same workflow, three surfaces

The same YAML runs from any of:

| Surface | How |
|---|---|
| **CLI** | `specship workflow run <name> --input KEY=VAL` — what most users do most of the time. |
| **Desktop Web UI** | `specship serve --ui` exposes a *Run* button per workflow with a generated input form, then routes to the live run page. |
| **GitHub Actions** | A runner action that takes a `workflow:` name and inputs, runs against the cloned repo, posts events back as PR comments. Approvals via PR reaction. |

You author once. Where it runs is the user's choice.

## What's next

- [Quickstart](/specship/getting-started/quickstart/) — install, init, run your first workflow.
- [YAML schema](/specship/workflows/yaml-schema/) — the full reference for fields, runners, and conditions.
- [Bundled workflows](/specship/workflows/bundled/) — what `spec-implement` / `spec-fix` / `spec-verify` / `spec-relink` actually do, step by step.
- [Writing custom workflows](/specship/workflows/custom/) — drop your own under `.specship/workflows/`.
- [Channels](/specship/workflows/channels/) — running workflows from CLI, the web UI, or GitHub Actions.
