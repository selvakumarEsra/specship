---
title: Introduction
description: SpecShip is a local-first code-intelligence graph, spec layer, and workflow engine for Claude Code — your agent answers structural questions in a few calls instead of re-reading the codebase.
---

SpecShip **stops your agent re-reading the codebase.** It parses your project with tree-sitter into a local SQLite knowledge graph and exposes it to **Claude Code** over MCP, so structural and flow questions — "how does X reach Y", "what calls this", "what breaks if I change it" — resolve in a few fast tool calls instead of a grep-and-Read crawl. On top of the graph sit ID-stable specs with test-evidenced links to code, and a YAML workflow engine that implements a spec in an isolated git worktree.

SpecShip is built for **Claude Code**. Gemini CLI is supported as an opt-in, MCP-only target (`specship install --target gemini`) — see [Installation](/getting-started/installation/#gemini-cli-opt-in).

## What it ships

| Surface | What it does |
|---|---|
| **Graph** | Tree-sitter parsing across 20+ languages → SQLite (FTS5) knowledge graph of symbols, call edges, framework routes. Extraction is deterministic — derived from the AST, never LLM-summarized. `specship_explore` returns the verbatim source of the relevant symbols in one call. |
| **Specs** | Requirements as ID-stable Markdown nodes (`REQ-AUTH-005`). Code links carry state — `implemented`, `verified`, `drifted`, `broken`, `orphaned` — and **`verified` means a linked test actually passed**. |
| **Quality gates** | `specship check` gates drift, behaviour (test evidence), architecture fitness, maintainability, newly added lint suppressions, and (opt-in) mutation score. `specship lint` checks spec files; `specship coverage` shows which requirements and criteria have test evidence. |
| **Workflows** | A YAML DAG runner. Bundled `spec-implement`, `spec-implement-mixed`, `spec-fix`, `spec-verify`, `spec-relink`, and more — plus anything you write. Runs in an isolated git worktree with approval gates. |
| **Learning** | Human-gated learning from your real sessions: repeated code-style corrections become project conventions, undocumented domain terms become drafted fact files, and `/specship:learn` captures either on demand. Nothing is written without your approval. |
| **Dashboard** | `specship desktop` — a loopback web UI over the same database: specs and traceability, the drift queue, workflow runs, and Claude Code session analytics ingested from `~/.claude/projects/*.jsonl`. |

Everything reads and writes the same local SQLite under `.specship/`. The core makes no network calls and has no API key and no telemetry. The two integrations that do talk to a service — **JIRA** (your Atlassian instance) and **Designer** (claude.ai, experimental) — are strictly opt-in (`--with-jira`, `--with-designer`).

## Why a graph

Most agent-with-codebase setups burn time on **discovery** — `grep`, `glob`, and `Read` just to find which files to look at. SpecShip pre-indexes that discovery: every symbol, call edge, framework route, and cross-language bridge is in the graph before the agent asks. The target is a flow question answered in one SpecShip call on a small repo (three to five on a large one) with zero file reads. Measured, dated benchmark results live in the project [README](https://github.com/selvakumarEsra/specship#readme).

### Works on small models too

SpecShip sizes its output to the model running the session. On a lightweight model (Claude Haiku, Gemini Flash) it returns fewer files with complete source, sends a short imperative version of its guidance, and trims the tool menu to the core tools — so a small model stops searching and answers. Frontier and mid-tier sessions get the full output, and a model SpecShip can't identify is never trimmed. Override with `SPECSHIP_MODEL=lite|standard|full` or turn it off with `SPECSHIP_COMPACT=0` — see [Configuration](/getting-started/configuration/#how-the-model-tier-is-detected).

## Why specs

The spec is the **anchor for repeatable AI work**. Without a written, ID-stable requirement you're stuck with conversational briefs that drift each time, can't be verified after the fact, and can't be handed off.

A spec gives you:

- A **stable id** (`REQ-AUTH-005`) that survives rewrites.
- **Links to code** (`implementations:`) and **proving tests** (`verifies:`), each with state — and a requirement can only reach `verified` when a linked test has passed (`specship verify --report <vitest-json>` records a real run).
- A **brief the agent can read** (`specship_spec`) without you re-describing the goal every turn.

→ [Why specs](/specs/why-specs/) for the longer version.

## A workflow, in one command

```bash
specship workflow run spec-implement --input SPEC_ID=REQ-AUTH-005
```

That run opens a git worktree, reads the spec and the graph, drafts a plan and **pauses for your approval**, implements, runs your project's lint/typecheck (with one automated fix round) and a scan for newly added lint suppressions, runs the tests, asserts spec links, computes acceptance-criteria coverage, has a read-only adversarial reviewer grade each criterion, and pauses again for your final review. The worktree branch is left for you to inspect and merge. → [Your first workflow](/getting-started/your-first-workflow/).

## 100% local

The core never leaves your machine. Per-project data lives in `.specship/`; delete the directory and it's gone. User-level state (worktrees, saved JIRA credentials if you opted in) lives in `~/.specship/`.

## What to read next

- **[Quickstart](/getting-started/quickstart/)** — install + first command.
- **[Installation](/getting-started/installation/)** — every install option, offline bundles, Gemini CLI.
- **[Your first graph](/getting-started/your-first-graph/)** — index a project and query it.
- **[Your first workflow](/getting-started/your-first-workflow/)** — run `spec-implement` against a real spec.
- **[Workflows — Overview](/workflows/overview/)** — the engine's full feature set.
- **[Claude Code — Overview](/claude-code/overview/)** — the dashboard's analytics surfaces.
