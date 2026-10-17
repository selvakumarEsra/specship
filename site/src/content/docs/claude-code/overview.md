---
title: Claude Code — Overview
description: SpecShip ingests ~/.claude/projects/*.jsonl transcripts in the background and surfaces sessions, heatmaps, costs, project comparison, memory, MCP servers, and tips in the desktop dashboard.
---

SpecShip ships with deep integration into Claude Code's native data — the JSONL transcripts that Claude Code writes to `~/.claude/projects/<project>/<sessionId>.jsonl` for every session.

A background ingest watcher (started in-process by `specship desktop`) tails those files, parses them, and writes per-session, per-prompt, and per-tool-call rows into SpecShip's SQLite. The dashboard's **Claude Code** section then exposes the data seven ways:

| Page | What it answers |
|---|---|
| **[Sessions](/claude-code/sessions/)** | What did each session cost, how well was it cached, which tools, commands, and files did it touch? Click in for the prompt timeline. |
| **[Heatmap](/claude-code/heatmap/)** | Which files do my sessions touch most? Which tools return the most tokens? Which subagents run most? |
| **[Costs](/claude-code/costs/)** | Where's the money going? Daily spend, by-model donut, cache analytics, the most expensive prompts. |
| **[Compare projects](/claude-code/costs/#compare-projects)** | Which projects are cost-efficient and which are hungry? |
| **[Memory](/claude-code/memory/)** | What does the agent load at session start? The `CLAUDE.md` hierarchy, `@import`s, and memory-tool notes. |
| **[MCP](/claude-code/mcp/)** | Which MCP servers is Claude Code configured to load, are they answering, and how much are they used? |
| **[Tips](/claude-code/tips/)** | Rule-based findings: _"You read auth.ts 12× in one session — specship_explore covers it."_ |

The **Project** section of the same dashboard covers your specs: the knowledge graph, the spec funnel, the **Traceability** matrix (every requirement's code links, proving tests, criteria met, verdict, and drift age), the drift queue, and workflow runs.

Each page reads the same SQLite. No external services, no API keys, no telemetry — Claude Code's own JSONL is the source.

## What gets ingested

For each session the ingest extracts:

- `session_id`, `project_path`, `started_at`, `ended_at`, `prompt_count`, `last_model`
- per-prompt: `text`, `cost_usd`, `input/output/cache_creation/cache_read` tokens, `is_sidechain` (is this a subagent's prompt?)
- per-tool-call: `tool_name`, `input_summary`, `result_length`, timestamp, link to its parent prompt

That's enough to drive every analytics surface — cost rollups, cache hit rates, tool-by-tool heatmaps, subagent attribution, "expensive prompt" detection — and the [self-improvement](/claude-code/improvements/) miner.

## Why this matters

Claude Code is unusual among coding agents in that **every session leaves an audit trail on disk**: the chat, every tool call, token counts, and cost. That's enough to:

- **Compute your real cache hit rate** — and find the sessions where it collapses.
- **Spot expensive tools** — a `Read` that returned a whole god-file is a clear signal a structural query would do better.
- **Attribute work to subagents** — which Task-spawned subagent types run most?
- **Compare projects** — why is one project's cache rate so much lower than another's?

SpecShip surfaces it without you having to wire anything up.

## Honest numbers

Every figure on these pages is either **measured** from your transcripts, **estimated and labeled** as such, or **absent**:

- Token sizes derived from result length are marked `est.` (characters ÷ 4).
- A session whose model has no pricing row shows **unpriced** instead of a confident `$0.00`, and cost totals say how many unpriced sessions they exclude.
- Values SpecShip can't measure — for example drift counts for projects other than the one whose index the dashboard opened — show `—` rather than an invented number.

## How the ingest watcher runs

When `specship desktop` starts:

1. The HTTP server binds `127.0.0.1:4242` and serves both the API and the dashboard.
2. The engine opens the project's SQLite (the current directory's project, else your most recent initialized one).
3. The **ingest watcher** does a one-shot catch-up pass over `~/.claude/projects/`, then watches that directory.

The catch-up pass parses any new `.jsonl` files (and new lines on existing files). After that, every change triggers an incremental ingest after a short debounce, so new sessions land in the dashboard within about a second of Claude Code writing them. Pages load their data when you open them or change a filter.

The watcher is on by default; pass `--no-ingest` to turn it off, `--no-web` to run the API headless (no dashboard), and `--port` / `--host` to bind elsewhere. If no transcripts have been ingested yet, the analytics pages show how to ingest instead of empty charts.

## Privacy

The ingest reads files **only from your local `~/.claude/projects/`**. Nothing is uploaded. Nothing is sent to any service — no API key, no telemetry, no analytics callback.

The data lives in whichever project's `.specship/specship.db` is hosting the analytics (called the "primary project"). Delete that DB and you delete the ingested data. Re-run the watcher and it re-ingests from the JSONL source of truth.

## Beyond the dashboard

SpecShip also shapes the Claude Code session itself:

- **[Steering & session start](/claude-code/steering/)** — the per-prompt nudge, the search reminder, the session-start cheatsheet, and status-line tips.
- **[Low-end models](/claude-code/low-end-models/)** — compact output, guidance, and tool menu for Haiku and Gemini Flash sessions.
- **[Self-improvement](/claude-code/improvements/)** — proposals mined from your sessions, including learned code-style conventions and domain facts.

→ Read [Sessions](/claude-code/sessions/) next — the per-session deep dive.
