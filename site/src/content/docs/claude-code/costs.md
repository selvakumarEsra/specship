---
title: Costs & cache
description: Where the money's going — per-prompt cost ranking, per-day line chart, by-model donut, and cache analytics. The financial view of your Claude Code activity.
---

The **Costs** page is for understanding **where your token budget went** and **what to do about it**. Three sections, all driven by the same SQLite the Sessions and Heatmap pages read.

## Headline

A single big number — total cost across the selected range — with a **week-over-week delta**.

```
$84.21          ↘ -12% from last week
This week · 47 sessions · 3,128 prompts · 71% cache read rate
```

Color-flagged: green if down, red if up. A small sparkline shows the trend across the range.

## Per-prompt cost ranking

A sortable list of the **top 50 most expensive prompts** in the range. Each row shows:

| Column | Meaning |
|---|---|
| Order | Rank in the list. |
| Prompt text | Truncated to ~120 chars. |
| Cost | This prompt's `cost_usd` (sortable column). |
| Tokens | Input / output / cache split (micro-bar). |
| Model | The model that handled it. |
| Cache hit % | This prompt alone. |
| Session | Clickable link to the Sessions deep-dive scrolled to this prompt. |

Click any row to expand inline — full prompt text, every tool call with its result-token cost, the token-breakdown table.

**The pattern you're looking for** isn't always "one prompt that cost $5" — sometimes it's "five prompts of $1 each, all asking variations of the same thing because the agent didn't have enough context the first time".

## Per-day line chart

A simple time series across the range (default 30 days), one point per day, hover for daily total + prompt count.

The line tells you **when** you spend. Spikes correlate with launch crunches, big refactors, the "explored a new codebase" day. The flat baseline tells you what your steady-state cost looks like.

## By-model breakdown

A **donut chart** showing total spend share between models:

- Opus 4.6 / 4.7 / 4.8
- Sonnet 4.5 / 4.6
- Haiku 4.5

For most teams, the donut tells the most actionable story:

| Pattern | Action |
|---|---|
| 80%+ Opus | Are you using Opus for read/edit-only turns? Route those to Sonnet — same outcome, ~5× cheaper. |
| 50/50 Opus/Sonnet | Healthy split for most workflows. |
| 80%+ Sonnet | Either you've optimized well, or you're not using Opus for the right things (planning, hard refactors). |
| Significant Haiku spend | Usually a hidden subagent — Haiku is the default for fast lookups. Check if it's appropriate. |

## Cache analytics

A dedicated card with one big number — your **cache read rate** for the range — plus a 2×2 breakdown:

| Cell | What |
|---|---|
| **Creation tokens** | Total tokens written into the cache. Split into 1-hour and 5-minute lanes (Claude's two cache TTLs). |
| **Read tokens** | Total tokens served from cache. Charged at ~10% of normal input rate. |
| **Saved this week** | Estimated dollars saved vs no cache. |
| **WoW delta** | Cache rate change versus last week. |

The cache read rate is the **single most controllable knob** for keeping Claude Code cheap. Three concrete plays:

| Play | Effect |
|---|---|
| **Pin a stable system-prompt prefix** | The first N tokens of every conversation hash the same → those tokens come from cache forever after. |
| **Use `CLAUDE.md` for shared context** | Same idea at the project level — every session in this project sees the same memory, so the cache prefix is huge. |
| **Avoid "tell me about" prompts** | Each one writes a unique prefix to cache that may never be read again. Use structural queries (`specship_explore`) that return reusable answers instead. |

A team running Claude Code 20+ hours a week typically sees the cache read rate move from ~40% to ~75% after adopting these — about a **2.5× reduction in real input-token cost**.

The Costs page lives in the desktop UI — start it with `specship serve --ui` and open **Costs**. It shows the per-day spend, the week-over-week change, a by-model breakdown, and the top prompts by cost. The **Compare** page breaks each project's cost down per model and lists its top tools.

## Compare projects

A sibling page — `Compare projects` — takes the cost data and **pivots it across projects**. Each row is a project; columns are `total cost`, `sessions`, `avg cost/session`, `cache hit rate`, top 3 tools used, drift queue size.

The "most efficient project" callout highlights the project with the best `cache_hit_rate` and lowest `avg_cost_per_session` — a target for the others to match.

This is the surface team leads use for **weekly cost reviews**.

→ Next: [Tips engine](/specship/claude-code/tips/) — pattern-matching over your transcripts.
