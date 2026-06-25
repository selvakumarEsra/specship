---
title: Claude Code — Overview
description: SpecShip ingests ~/.claude/projects/*.jsonl transcripts in the background and surfaces sessions, memory, heatmaps, costs, and tips in the desktop UI.
---

SpecShip ships with deep integration into Claude Code's native data — the JSONL transcripts that Claude Code writes to `~/.claude/projects/<project>/<sessionId>.jsonl` for every session.

A background ingest watcher (started in-process by `specship serve --ui`) tails those files, parses them, and writes per-session, per-prompt, and per-tool-call rows into SpecShip's SQLite. The desktop UI then exposes the data five ways:

| Surface | What it answers |
|---|---|
| **Sessions** | What did each session cost, how long did it run, what tools were used? Click in for a per-prompt timeline. |
| **Memory** | What does the agent remember? Across `CLAUDE.md` levels (managed / user / project / subdir), `@import` resolution, and `~/.claude/memory/*.md` notes. |
| **Heatmap** | Which files do my sessions touch most? Which tools are token-heavy? Which subagents eat the budget? |
| **Costs** | Where's the money going? Per-day line, by-model donut, top-prompt ranking. |
| **Tips** | Rule-based suggestions: _"You read auth.ts 17× last session — same answer via `specship_explore` in 1 call."_ |
| **SpecShip Impact** | How many tokens SpecShip's own tools spent, and an _estimate_ of how many they saved by answering from the graph instead of reading files — per prompt, session, project, and all-projects. |

Each of these reads the same SQLite. No external services, no API keys, no telemetry — Claude Code's own JSONL is the source.

## What gets ingested

For each session the ingest extracts:

- `session_id`, `project_path`, `started_at`, `ended_at`, `prompt_count`, `last_model`
- per-prompt: `text`, `cost_usd`, `input/output/cache_creation/cache_read` tokens, `is_sidechain` (is this a subagent's prompt?)
- per-tool-call: `tool_name`, `input_summary`, `result_length`, timestamp, link to its parent prompt

That's enough to drive every analytics surface — cost rollups, cache hit rates, tool-by-tool heatmaps, subagent attribution, "expensive prompt" detection.

## Why this matters

Claude Code is unusual among coding agents in that **every session leaves an audit trail on disk**. Most agents only persist the chat. Claude Code persists the chat + every tool call + token counts + cost. That's enough to:

- **Compute your real cache hit rate** — and discover your evening sessions are 91% misses because your system prompt drifts.
- **Spot expensive tools** — Read returning 396k tokens for a single file is a clear signal that a structural query would do better.
- **Attribute spend by subagent** — which Task-spawned subagent ate the most budget?
- **Compare projects** — your trading-bot project's cache rate is 38% lower than your CRM. Why?

Most teams running Claude Code at scale don't measure any of this. SpecShip surfaces it without you having to wire anything up.

## How the ingest watcher runs

When `specship serve --ui` starts, three things happen in parallel:

1. The Fastify HTTP server binds `127.0.0.1:4242` and serves both the API and the SPA.
2. The codegraph engine opens the project's SQLite (or the picker's selected project, if you boot projectless).
3. The **ingest watcher** does a one-shot reconciliation pass against `~/.claude/projects/`, then registers an `fs.watch` on that directory.

The reconciliation parses any new `.jsonl` files (and any new lines on existing files) and writes them into SpecShip's SQLite. The watcher then triggers incremental ingests on every file-mtime change with a debounce — so live sessions stream into the desktop UI within roughly a second of Claude Code writing them. (The Session Detail page also pushes new prompts and tool calls live over SSE — see [Sessions](/claude-code/sessions/).)

The watcher runs in-process; pass `--ingest` to be explicit, or `--no-web` to run the API headless (no SPA). The UI hits `127.0.0.1:4242` by default — change it with `--port` / `--host`.

## Offline mode

If the SpecShip server is down or unreachable, the desktop UI doesn't fall back to the browser's "this site can't be reached" page — it loads from a local cache and keeps showing the last data it loaded, each surface marked with how old it is (e.g. "Offline · 4m ago"). The connection indicator switches from **● Live** to **● Offline**, and actions that need the server (Refresh, saving a spec) are disabled with an offline notice. Data reloads automatically and the indicator returns to **● Live** once the server is back.

## SpecShip Impact

The **SpecShip Impact** page answers "is SpecShip earning its keep?" It separates two numbers:

- **Spend (measured):** the tokens SpecShip's own tool calls put into the conversation — exact, summed per prompt → session → project → all-projects.
- **Saved (estimated):** for each code-graph query (`specship_explore`, `specship_node`, `callers`/`callees`/`impact`, …), the size of the files those symbols live in — what a `Read` of them would have cost — minus what SpecShip actually returned, deduplicated per prompt.

**Saved is a deliberately conservative estimate.** A natural-language `explore` query, or any query whose symbols can't be resolved in the graph, contributes **zero** saved — so the number under-claims rather than over-claims. There's also a fixed per-session overhead line (the cost of SpecShip's tool definitions in the system prompt), and **net = saved − spend − overhead** (shown honestly, even when negative). Every estimated figure is marked `est.`; cost is priced at your model's input rate. Session Detail surfaces the same per-prompt and per-session numbers inline.

> v1 estimates savings for the **primary project** only; other projects show their spend exactly but their savings as unresolved.

## Privacy

The ingest reads files **only from your local `~/.claude/projects/`**. Nothing is uploaded. Nothing is sent to any service. SpecShip is 100% offline — no API key, no telemetry, no analytics callback.

The data lives in whichever project's `.specship/specship.db` is hosting the analytics (called the "primary project"). Delete that DB and you delete the ingested data. Re-run the watcher and it re-ingests from the JSONL source of truth.

→ Read [Sessions](/claude-code/sessions/) next — the per-session deep dive.
