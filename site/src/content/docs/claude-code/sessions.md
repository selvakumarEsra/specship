---
title: Sessions
description: Per-session deep dive — cost, prompt timeline, token breakdown, every tool call with its result-token weight.
---

A **session** is one uninterrupted Claude Code conversation — bracketed by the moment you opened Claude Code and the moment it exited (or compacted, or branched). Claude Code writes one `.jsonl` file per session under `~/.claude/projects/<project>/<sessionId>.jsonl`.

SpecShip ingests them into the `claude_sessions` table and surfaces them in the desktop UI's **Sessions** page.

## The list view

The list shows every session matching the filter bar — project (multi-select), date range, model. Each row carries:

| Column | Meaning |
|---|---|
| Session ID prefix | First 8 chars of the JSONL filename. |
| Project | The decoded project path (`~/.claude/projects/-Users-…` → real path). |
| Started / ended | Wall-clock bracket. |
| Prompts | Count of user turns. |
| Cost | Sum of every prompt's `total_cost_usd`. |
| Cache hit % | `cache_read_tokens / (input + cache_creation + cache_read)`. |
| Model | The last model used in the session. |

Click a row → the session deep-dive.

## The deep dive

For one session, the page shows:

### Header summary

- Total cost
- Prompt count
- Cache hit rate (color-flagged: green ≥ 60%, amber 30–60%, red < 30%)
- Subagent spend $ (cost attributable to Task-spawned subagents)
- Window: start → end with elapsed time

### Expandable prompt timeline

Each prompt is a row with:

| Column | Meaning |
|---|---|
| Order | Position in the session (1, 2, 3, …). |
| Text | The prompt's user message, truncated to ~80 chars. |
| Cost | This prompt's `cost_usd`. |
| Cache % | Cache read rate for this prompt alone. |
| Tokens | A micro-bar split: input / output / cache-write / cache-read. |

Click a row → it expands inline:

- **Full prompt text** (no truncation).
- **Per-tool-call list** for this prompt:
  - tool name
  - input summary (e.g. file path for Read, query for Grep)
  - `result_length` in tokens, **color-flagged red** when a single call returned ≥ 50k tokens
  - timestamp
- **Token breakdown table**: input | output | cache_creation_1h | cache_creation_5m | cache_read.
- **Cost breakdown**: by model, by token type.

### Right rail summary

- **Session token-mix bar** — visualises input vs output vs cache-creation vs cache-read for the whole session.
- **Cache effectiveness callout** — "$ saved this session vs no cache".
- **Tools used by result-token weight** — ranked. Tells you which tools dominated the token budget.
- **Per-prompt cost bars** — sparkline-style; the spike tells you where the budget went.

## What you'll learn from it

Common findings teams have on first opening this page:

| Finding | Why it matters |
|---|---|
| _One prompt drove 60% of the session cost._ | Usually a "do everything in one turn" prompt that fanned out to a giant subagent. Split it. |
| _Read returned 396k tokens for `App.tsx`._ | The file is a god-file. A structural query (`specship_explore`) returns the same answer in 1/100 the tokens. |
| _Cache hit rate dropped from 75% to 15% mid-session._ | Something in the system prompt changed (a tool-call result, a new turn). Pinpoint via the per-prompt cache % column. |
| _Subagent spend is 70% of total._ | The agent is over-delegating — possibly to inappropriate subagents. Worth a workflow refactor. |

## Cross-linking

Every session row in the heatmap, costs, and tips pages links here. The session detail surfaces a "Show in heatmap" link that filters the heatmap to just this session's tool calls — useful for understanding _why_ a particular file is hot in your global heatmap.

## CLI

The same data is queryable from the CLI:

```bash
specship claude sessions --range week
specship claude session <id> --json
specship claude session <id> --prompts
specship claude session <id> --tools
```

For programmatic access (CSV export, dashboarding, custom analysis):

```bash
specship claude sessions --range month --json > sessions.json
```

The JSON schema mirrors the `claude_sessions` table 1:1.

## How "subagent spend" is computed

Each prompt in the JSONL has an `is_sidechain` boolean. `is_sidechain: true` means it was spawned by a Task tool call from a parent prompt — a subagent's turn, not a top-level user turn.

SpecShip sums `cost_usd` separately for `is_sidechain: true` vs `false`. The subagent spend % is `sidechain_cost / total_cost`.

For **per-subagent-name** attribution (which specific subagent type ate the budget), SpecShip looks up the parent prompt's Task call and reads its `subagent_type` field, joining back to the sidechain prompt rows. This shows up in the Heatmap → Subagents lane.

→ Next: [Memory](/specship/claude-code/memory/) — the CLAUDE.md hierarchy.
