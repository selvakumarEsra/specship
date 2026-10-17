---
title: Costs & cache
description: Where the money's going — daily spend, by-model donut, cache analytics, and the most expensive prompts, plus a cross-project comparison. The financial view of your Claude Code activity.
---

The **Costs** page is for understanding **where your token budget went** and **what to do about it**. It reads the same SQLite as the Sessions and Heatmap pages and covers your ingested sessions across all projects.

Two controls sit at the top: a **model** filter that narrows every card to one model, and a range selector (Today / This week / This month — the default — / All time).

## Spend over time

A single big number — total cost for the range — with a **week-over-week delta**, above a daily spend line. Hover the line for a day's cost and prompt count.

If any sessions ran on a model with no pricing row, the total says **excludes N unpriced sessions** — their cost is unknown, not zero, and they're left out rather than counted as `$0`.

The line tells you **when** you spend: spikes line up with big refactors and "explored a new codebase" days; the flat baseline is your steady state.

## By model

A **donut** of spend share per model in the range, with each model's cost and percentage. Use it to check that the expensive model is doing the work that needs it:

| Pattern | Question to ask |
|---|---|
| Mostly the top-tier model | Are routine read/edit turns running on it too? A cheaper model may do them as well. |
| Significant small-model spend | Often a subagent. Check it's appropriate for the work — and see [Low-end models](/claude-code/low-end-models/) for how SpecShip adapts to it. |

## Most expensive prompts

The **top 8 prompts by cost** in the range. Each row shows the prompt text (subagent prompts are marked), a cost bar, the model, total tokens, the prompt's cache rate, and its cost. Click a row to open its session on the [Sessions](/claude-code/sessions/) page.

The pattern to look for isn't always one $5 prompt — sometimes it's five $1 prompts asking variations of the same thing because the agent didn't have enough context the first time.

## Cache analytics

One big number — your **cache read rate** for the range, with its week-over-week change — plus a 2×2 breakdown:

| Cell | What |
|---|---|
| **Creation tokens** | Tokens written into the cache. |
| **Read tokens** | Tokens served from cache, charged at roughly 10% of the normal input rate. |
| **Saved** | Estimated dollars saved versus no cache — labeled `est.` |
| **WoW** | Change in cache reuse versus the previous week. |

The cache read rate is one of the most controllable cost levers in Claude Code:

| Play | Effect |
|---|---|
| **Keep stable context stable** | Content that's identical at the start of every turn is served from cache after the first time. |
| **Put shared context in `CLAUDE.md`** | Every session in the project starts from the same memory, so it caches well. |
| **Prefer structural queries** | `specship_explore` returns just the relevant source instead of dumping whole files into context. |

## Compare projects

A sibling page — **Compare projects** — pivots the cost data across projects. Toggle projects on and off with the chips at the top. Each row shows total **cost**, **sessions**, **average cost per session**, **cache** hit rate, **drift** queue size, and the **top tools** used. Drift is measured only for the project whose index the dashboard opened; other projects show `—` rather than a guessed number.

A **Most efficient** callout highlights the project with the best balance of cache hit rate and average session cost, and a stacked bar chart breaks each project's cost down by model.

→ Next: [Tips engine](/claude-code/tips/) — pattern-matching over your transcripts.
