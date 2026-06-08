---
title: Introduction
description: SpecShip is a workflow engine for AI coding agents — define multi-step development workflows in YAML, run them in isolated worktrees against a knowledge graph of your code and specs.
---

SpecShip is a **workflow engine for AI coding agents**. You describe a multi-step development task in YAML — plan, implement, lint, test, review, merge — and SpecShip runs it for you, in an isolated git worktree, with one command.

> _Define multi-step development workflows in YAML — code review, bug fixes, feature implementation, testing — and run them with a single command._

Under the hood it ships four things that work together:

| Surface | What it does |
|---|---|
| **Workflows** | A YAML DAG runner. Bundled `spec-implement`, `spec-fix`, `spec-verify`, `spec-relink` plus anything you write. |
| **Specs** | Requirements as ID-stable Markdown nodes. The agent links the code it writes back to the requirement, with state. |
| **Graph** | Tree-sitter parsing across 20+ languages → SQLite knowledge graph. The agent answers structural questions in 1-3 calls instead of grepping files. |
| **Claude Code analytics** | Live ingest of `~/.claude/projects/*.jsonl` → sessions, memory, file/tool/subagent heatmaps, cost rollups, a rule-based tips engine. |

All four read and write the same local SQLite. There's no external service, no API key, no telemetry — SpecShip is 100% local.

## Four properties of the workflow engine

| | |
|---|---|
| **Repeatable** | Package your best AI coding patterns as shareable YAML workflows. Check them into git; share them across your team. |
| **Isolated** | Each workflow runs in its own git worktree — no conflicts, no mess. Half-finished agent runs never touch your working tree. |
| **Portable** | Run from the CLI, the desktop web UI, or your GitHub Actions runners. Same YAML, three surfaces. |
| **Composable** | Chain nodes into DAGs with `depends_on:`, loops, conditional branches, and approval gates. Real control flow, not just scripts. |

## A 30-second example

```yaml
name: spec-implement
inputs:
  - { name: SPEC_ID, required: true }
isolation: worktree
steps:
  - { id: plan,      runner: agent,    output: plan.md }
  - { id: implement, runner: agent,    depends_on: [plan],      output: diff.md }
  - { id: test,      runner: bash,     depends_on: [implement], command: pnpm test --filter affected }
  - { id: review,    runner: approval, depends_on: [test],      message: "Approve?" }
  - { id: merge,     runner: shell,    depends_on: [review],    command: git merge --ff-only $WORKTREE }
```

```bash
specship workflow run spec-implement --input SPEC_ID=REQ-AUTH-005
```

That command opens a worktree, plans the implementation against your specs and code graph, writes code, runs only the affected tests, pauses for your approval, and merges.

## Why specs

The spec is the **anchor for repeatable AI work**. Without a written, ID-stable requirement, you're stuck with conversational briefs that drift each time, can't be verified after the fact, and can't be handed off.

A spec gives you:

- A **stable id** (`REQ-AUTH-005`) that survives rewrites.
- A **link to code** with state — `verified`, `drifted`, `broken`, `orphaned`.
- A **brief the agent can read** without you re-describing the goal every turn.

→ [Why specs](/specship/specs/why-specs/) for the longer version.

## Why a graph

Most agent-with-codebase setups burn tokens on **discovery** — `grep`, `glob`, and `Read` to find which files to even look at. SpecShip pre-indexes that discovery: every symbol, every call edge, every framework route, every cross-language bridge is in the graph before the agent asks.

Real numbers on a recent benchmark (median of 4 runs across 7 repos, Claude Code Opus 4.7):

- **35% cheaper**
- **57% fewer tokens**
- **46% faster**
- **71% fewer tool calls**

The gains scale with codebase size — large repos see zero file reads.

## Why ingest Claude Code transcripts

Claude Code writes a JSONL audit trail to `~/.claude/projects/<project>/<sessionId>.jsonl` for every session. That trail has per-prompt cost, per-tool-call result size, cache hit/miss, and subagent attribution.

SpecShip ingests it, surfaces it in the desktop UI, and runs a rule-based tips engine over it. You discover that you read `auth.ts` 17 times yesterday, that `Bash(grep)` cost you $4 last week, that your evening sessions have a 91% cache miss rate — and a one-click fix for each.

## 100% local

No data leaves your machine. No API keys, no external services. Everything lives in `.specship/` per project. Delete the directory; it's gone.

## What to read next

- **[Quickstart](/specship/getting-started/quickstart/)** — the 30-second install + first command.
- **[Your first workflow](/specship/getting-started/your-first-workflow/)** — the 12-minute walkthrough: install, init, run `spec-implement` against a real spec, watch the timeline, approve the diff.
- **[Workflows — Overview](/specship/workflows/overview/)** — the engine's full feature set.
- **[Why specs](/specship/specs/why-specs/)** — what specs buy you beyond "shared brief".
- **[Claude Code — Overview](/specship/claude-code/overview/)** — the desktop UI's analytics surfaces.
