---
title: Sessions
description: Per-session deep dive — cost, cache hit rate, a prompt timeline with quality signals, token mix, and the tools, commands, skills, and files each session touched.
---

A **session** is one uninterrupted Claude Code conversation. Claude Code writes one `.jsonl` file per session under `~/.claude/projects/<project>/<sessionId>.jsonl`; SpecShip ingests them into the `claude_sessions` table and surfaces them on the dashboard's **Sessions** page.

## The list view

A range selector (Today / This week / This month / All time) sits at the top, with a **project** filter and a **model** filter beside it — the model options come from the sessions in range. Sort by **Cost** (default) or **Prompts**. Each row carries:

| Column | Meaning |
|---|---|
| Session | First 8 characters of the session id. |
| Project | The project the session ran in. |
| Window | Start → end time, plus the last model used. |
| Prompts | Count of user turns. |
| Cache | Cache hit rate: `cache_read / (input + cache_creation + cache_read)`, color-flagged. |
| Cost | Sum of every prompt's cost — or **unpriced ⚠** when the session's model has no pricing row, so an unknown cost never shows as `$0.00`. |

Click a row to open the session.

## The session detail

### Stat strip

- **Cost** (or **unpriced ⚠**)
- **Prompts**
- **Cache hit** — color-flagged
- **Subagent $** — cost attributable to Task-spawned subagents
- **Window** — start → end

### Prompt timeline

One row per prompt, in order: time, a **quality dot**, the prompt text (subagent prompts are tagged **subagent**), the number of tool calls, total tokens, the prompt's own cache rate, and its cost — highlighted when a single prompt is unusually expensive.

### Summary rail

The right-hand rail rolls up what the session actually *did*:

- **Token mix** — the input / output / cache-write / cache-read split, with each segment's share.
- **Cache effectiveness** — the share of input served from cache.
- **Avg prompt quality** — the session's mean quality score, graded, with a count of prompts that could be sharpened ("name a symbol, file or REQ id").
- **Commands & skills** — every slash command and skill invoked (e.g. `/specship:spec`, `spec-author`), with counts.
- **Tools used** — each tool ranked by the result tokens it returned to context, color-flagged when heavy.
- **Files touched** — up to ten files, with operation count and last operation.
- **Duration** — the session's wall-clock span.

## Prompt quality

The quality dot is a deterministic, rule-based read of how well a prompt was framed — no LLM. It scores the prompt out of 100 across four signals:

| Signal | What it checks |
|---|---|
| **Names a concrete target** | Does the prompt name a symbol, file, or `REQ-` id the agent can resolve directly? |
| **Scoped &amp; specific** | Is it a concrete ask rather than a short, open-ended "explain / look / why…"? |
| **Cache-friendly** | Was at least half the prompt's input served from cache? |
| **Structural over brute-force** | Did the turn use a SpecShip query, or did a `Read`/`Grep`/`Bash` call pull a large result into context? |

Scores grade as Excellent (85+), Good (70+), Fair (50+), or Needs work. Hover the dot for the score.

## What you'll learn from it

| Finding | Why it matters |
|---|---|
| _One prompt drove most of the session cost._ | Usually a "do everything in one turn" prompt that fanned out. Split it. |
| _`Read` dominates the Tools used rail._ | The agent is reading whole files. A structural query (`specship_explore`) returns the relevant source in one call. |
| _Cache hit rate is low across a long session._ | Something in the context keeps changing. Compare per-prompt cache rates on the timeline to find where it drops. |
| _Subagent $ is most of the total._ | The agent is over-delegating. Worth a workflow rethink. |

## How "subagent spend" is computed

Each prompt in the JSONL has an `is_sidechain` flag. `true` means it was spawned by a Task tool call from a parent prompt — a subagent's turn, not a top-level user turn. SpecShip sums `cost_usd` over the sidechain prompts for the **Subagent $** stat.

For per-subagent-type attribution, SpecShip reads the `subagent_type` of each Task call. That shows up in the [Heatmap](/claude-code/heatmap/#subagents-lane)'s Subagents lane.

→ Next: [MCP servers](/claude-code/mcp/) — every server your agent can reach.
