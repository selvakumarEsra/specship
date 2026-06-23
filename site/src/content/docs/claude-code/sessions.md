---
title: Sessions
description: Per-session deep dive — cost, prompt timeline, token breakdown, every tool call with its result-token weight.
---

A **session** is one uninterrupted Claude Code conversation — bracketed by the moment you opened Claude Code and the moment it exited (or compacted, or branched). Claude Code writes one `.jsonl` file per session under `~/.claude/projects/<project>/<sessionId>.jsonl`.

SpecShip ingests them into the `claude_sessions` table and surfaces them in the desktop UI's **Sessions** page.

## The list view

The list is scoped to the **active project** (the project picker already scopes it, so there's no separate project filter), and it sorts **newest-first** by default — Cost and Prompts are alternate sorts. It refetches every 10 s while the tab is visible (paused when you switch tabs, refetched the moment you tab back), and its own Refresh button triggers a global sync + transcript re-ingest. Each row carries:

| Column | Meaning |
|---|---|
| Session ID prefix | First 8 chars of the JSONL filename. |
| Started / ended | Wall-clock bracket. |
| Prompts | Count of user turns (not tool-result follow-ups). |
| Cost | Sum of every prompt's cost. |
| Cache hit % | `cache_read_tokens / (input + cache_creation + cache_read)`. |
| Model | The last model used in the session. |

Click a row → the **Session Detail** page (`/sessions/:id`).

## The Session Detail page

For one session the page shows the stat strip, a session-summary panel, and the prompt timeline.

### Stat strip

- Total cost
- Prompt count
- Cache hit rate (color-flagged: green ≥ 60%, amber 30–60%, red < 30%)
- Subagent spend $ (cost attributable to Task-spawned subagents)
- Window: start → end with elapsed time

### Session summary

A panel between the stat strip and the prompt list that rolls up what the session actually *did*, not just what it cost:

- **Top tools used**, with call counts color-coded by kind (Read / Edit / Bash / MCP).
- **Every slash command and skill** the agent invoked across the session (e.g. `/ss-spec`, `spec-author`).
- **The models that ran** — multi-model sessions are visible, so a sidechain to Haiku no longer hides behind the session-level last-model column.
- **Top files touched**, each with its last operation.

### Prompt timeline

Each prompt is a row with the user text, a token micro-bar (input / output / cache-write / cache-read), per-prompt cost, an end-to-end **duration** (millisecond-aware, so a 400 ms tool round-trip doesn't collapse to "0s"), a **slash-command pill** when one was used (e.g. `/ss-spec`), and an inline **tool-mix chip strip** for that turn (`Bash×3 Read×2 Edit×1`) so you can scan hundreds of prompts and tell heavy code work from heavy thinking.

Click a row → it expands inline:

- **Full prompt text** (no truncation).
- **The assistant's reply**, rendered as full markdown (code blocks, tables, lists).
- **Extended thinking**, inside a collapsed-by-default `<details>`.
- **Per-tool-call list** — tool name color-coded by kind, a one-line input summary, the result size (flagged when a single call returned a large token count), and a click-to-expand chevron that reveals the prettified raw tool-input JSON.
- **Every unique file** the prompt touched.

Prompts have Expand-all / Collapse-all controls, and subagent (sidechain) prompts are tagged so you can see which work the main agent delegated.

### Live capture

The page streams new prompts and tool calls over SSE, so a prompt you just sent in Claude Code shows up within about a second without clicking. A pill shows the connection state: **● Live** (SSE connected), amber **● Polling** (stream dropped, falling back to a visibility-gated poll), or grey **● Idle** (tab hidden).

## What you'll learn from it

Common findings teams have on first opening this page:

| Finding | Why it matters |
|---|---|
| _One prompt drove 60% of the session cost._ | Usually a "do everything in one turn" prompt that fanned out to a giant subagent. Split it. |
| _Read returned 396k tokens for `App.tsx`._ | The file is a god-file. A structural query (`specship_explore`) returns the same answer in 1/100 the tokens. |
| _Cache hit rate dropped from 75% to 15% mid-session._ | Something in the system prompt changed (a tool-call result, a new turn). Pinpoint via the per-prompt cache % column. |
| _Subagent spend is 70% of total._ | The agent is over-delegating — possibly to inappropriate subagents. Worth a workflow refactor. |

## How "subagent spend" is computed

Each prompt in the JSONL has an `is_sidechain` boolean. `is_sidechain: true` means it was spawned by a Task tool call from a parent prompt — a subagent's turn, not a top-level user turn.

SpecShip sums `cost_usd` separately for `is_sidechain: true` vs `false`. The subagent spend % is `sidechain_cost / total_cost`.

For **per-subagent-name** attribution (which specific subagent type ate the budget), SpecShip looks up the parent prompt's Task call and reads its `subagent_type` field, joining back to the sidechain prompt rows. This shows up in the Heatmap → Subagents lane.

→ Next: [Memory](/specship/claude-code/memory/) — the CLAUDE.md hierarchy.
