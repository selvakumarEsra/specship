---
title: Workflows — Overview
description: Define multi-step development workflows in YAML and run them with a single command. Spec → plan → code → test → review, on rails.
---

SpecShip's workflow engine runs **multi-step development tasks for Claude Code** the same way you'd run a CI pipeline — except the steps are agent prompts, shell commands, scripts and approval gates, chained into a DAG.

Pick a workflow (a YAML file), give it inputs, and SpecShip:

1. Optionally opens an **isolated git worktree** so the agent can work without touching your main checkout (every bundled workflow that edits code does).
2. Walks the DAG in dependency order, running each node by its `kind` (`prompt` / `bash` / `script` / `approval` / `cancel`). `prompt` nodes run Claude Code headless (`claude --print`).
3. Records **events** (`step_started`, `tool_called`, `agent_message`, `step_completed`, `approval_requested`, …) in SpecShip's SQLite, where the dashboard's run page reads them live.
4. Writes each node's output as an **artifact** under `.specship/artifacts/runs/<runId>/nodes/`.
5. Pauses at any **approval gate**; a human approves or rejects from the CLI or the dashboard.
6. When the run finishes, leaves the worktree and its branch for you to inspect and merge. Nothing is merged automatically, and a worktree is only ever deleted by an explicit `specship workflow purge`.

```bash
specship workflow run spec-implement --input SPEC_ID=REQ-AUTH-005
```

That one command opens a worktree, plans the implementation against the knowledge graph, pauses for you to approve the plan, writes code, runs a lint/typecheck gate, runs the tests, asserts spec links, has a read-only reviewer check every acceptance criterion, and pauses again with the real `git diff --stat` for your final approval — without ever touching your working tree.

## Why YAML?

YAML workflows make the agent's approach **legible, repeatable, and shareable**. Three concrete benefits:

| | |
|---|---|
| **Repeatable** | A workflow that worked last week works the same way today. Determinism around the agent's *plumbing* (steps, ordering, gates) is a forcing function for predictable output even when the agent itself is non-deterministic. |
| **Shareable** | Drop a `.specship/workflows/my-feature.yaml` in any repo and your whole team gets the same multi-step recipe. Workflows are just files. Review them in PRs. |
| **Auditable** | Every run writes events + artifacts to SQLite. You can replay any run's event timeline and see exactly what the agent did, what each step cost, and where a human intervened. |

## The bundled workflows

| Workflow | Inputs | What it does |
|---|---|---|
| `spec-implement` | `SPEC_ID` | Plan → approve → implement → lint/typecheck gate → suppression scan → diff → tests → links → coverage → adversarial review → final approval |
| `spec-implement-mixed` | `SPEC_ID` | Same steps and gates as `spec-implement`; Sonnet plans and reviews, Haiku does the mechanical steps |
| `spec-fix` | `SPEC_ID` | Diagnose a drifted/broken link → approve → fix → tests → approve → update link state |
| `spec-verify` | *(none)* | Run the test suite and move `implemented` links to `verified` only where test evidence passed |
| `spec-relink` | `SPEC_ID` | Find the new home of an orphaned link's symbol → you pick a candidate → re-assert the link |
| `spec-author` | `DESCRIPTION` | Draft a spec grounded in the code → gap-fill review → quality review → final approval → write the file |
| `claude-design-implement` | `CONNECTOR_URL` or `HANDOFF_DIR`, `FILE_LABEL`, `SLUG` | Snapshot a Claude Design → tokens → draft spec → review gate → write spec → hand off to implement |

All of them are tied to **specs** — that's SpecShip's bet that **specifications are the right unit of work**, not arbitrary prompts. But the runner is general; you can write workflows that have nothing to do with specs.

## Composability — DAGs, not scripts

Workflows are **directed acyclic graphs**. Nodes can:

- **Depend on multiple parents** — fan-in with `depends_on: [a, b]`.
- **Choose how parents combine** — `trigger_rule:` (`all_success` by default, or `one_success`, `none_failed_min_one_success`, `all_done`).
- **Skip conditionally** — `when:` runs the node only if an expression over earlier outputs or inputs is true.
- **Retry** — `retry:` re-runs a failed node (transient errors by default, or any error).
- **Pause at approval gates** — wait for a human, then resume. A gate's `on_reject` prompt turns a rejection into a revise-and-re-review loop.

Nodes execute one at a time, in dependency order — a DAG fixes *what waits for what*, not concurrency.

```yaml
nodes:
  - id: plan
    kind: prompt
    prompt: Plan the change for $INPUT.SPEC_ID. Do not edit code.

  - id: lint
    kind: bash
    depends_on: [plan]
    bash: npm run lint

  - id: types
    kind: bash
    depends_on: [plan]
    bash: npx tsc --noEmit

  - id: review
    kind: approval
    depends_on: [lint, types]
    message: "Plan looks good?"
```

Here `review` waits until both `lint` and `types` have succeeded.

## Isolation — opt-in worktrees

A workflow that sets `worktree: { enabled: true }` gets its own **git worktree** under `~/.specship/worktrees/<repo-hash>/`, on a branch named `specship/wf-<workflow>-<shortRunId>`. Every node's working directory is the worktree, so the agent's edits, the bash commands and the test runs all happen in an isolated checkout.

When the run completes, the worktree and branch stay put for you to inspect, merge, or open a PR from. If anything fails — or you reject or cancel — the worktree is kept as well. Only `specship workflow purge <runId>` removes it.

→ Read [Isolation & worktrees](/workflows/isolation/) for the details.

## Where you run them

| Surface | How |
|---|---|
| **CLI** | `specship workflow run <name> --input KEY=VAL` — what most users do most of the time. The `/specship:spec implement`, `/specship:spec design` and `/specship:check fix` slash commands launch the same workflows. |
| **Dashboard** | `specship desktop` serves the dashboard at `http://127.0.0.1:4242`. Launch a workflow with a generated input form, follow the live run page, and approve / reject / resume / cancel / purge from it. The drift queue's **Fix**, **Re-verify** and **Re-attach** buttons launch `spec-fix`, `spec-verify` and `spec-relink`. |
| **CI** | Run the same CLI command in a CI job. There is no dedicated GitHub Action; see [Channels](/workflows/channels/) for what works headlessly. |

You author once. Where it runs is the user's choice.

## What's next

- [Quickstart](/getting-started/quickstart/) — install, init, run your first workflow.
- [YAML schema](/workflows/yaml-schema/) — the full reference for fields, node kinds, and conditions.
- [Bundled workflows](/workflows/bundled/) — what each built-in actually does, node by node.
- [Writing custom workflows](/workflows/custom/) — drop your own under `.specship/workflows/`.
- [Channels](/workflows/channels/) — running workflows from the CLI, the dashboard, or CI.
