---
title: Heatmap
description: Where tool calls land — a file treemap, tools ranked by the tokens they return, and Task calls by subagent type, each with its own drill-down rail.
---

The **Heatmap** page is for spotting patterns in your Claude Code activity that you wouldn't notice prompt-by-prompt. It covers your ingested sessions across all projects, and a range selector (Today / This week / This month / All time) at the top filters everything on the page.

## Summary tiles

| Tile | What |
|---|---|
| **Tool calls** | Total tool calls in the range. |
| **Result tokens (est.)** | Tokens returned to context by those calls, estimated as characters ÷ 4. |
| **Busiest file** | The file with the most tool calls. |
| **Heaviest tool** | The tool that returned the most tokens. |

Token figures derive from recorded result sizes, so they're always labeled `est.`.

## Files

A **treemap** with one cell per file touched in the range. Toggle the metric between **Calls** and **Tokens**; hover a cell for its path, call count, estimated result tokens, and tokens per call.

Click a cell for the **file rail**:

| Section | Content |
|---|---|
| **Header** | File path, with a copy button. |
| **Tool calls** | Total calls, with a 7-day trend sparkline when there's activity. |
| **Heavy-tool callout** | When one tool returned a large result here — "_`Read` returned an estimated ~40k tokens here. A structural query would cover it in a fraction._" |
| **Tool breakdown** | Which tools touched the file, how many times each, and their estimated result tokens, color-flagged when large. |
| **Sessions** | Every session that touched it, with calls, estimated tokens, and model — each links to the session on the [Sessions](/claude-code/sessions/) page. |

This is where you'd notice `auth.ts` being read over and over — and decide to answer those questions with one `specship_explore`.

## Tools

Every tool ranked by **estimated result tokens**, with its call count, tokens per call, and total. Rows are color-coded by tokens per call — heavy, warm, or lean.

Click a tool for the **tool rail**:

- **Calls**, **Result tokens (est.)**, and **Sessions**, plus the average tokens per call (flagged when high).
- **Top inputs** — the inputs this tool was called with most, each with its call count and result size. Tells you exactly which files or patterns a `Read` or `Grep` kept hitting.
- **Used in** — the sessions where the tool ran, linking to each.

## Subagents lane

Task calls grouped by `subagent_type`. Click a subagent for its rail:

- **Invocations** and **Sessions** counts.
- **Recent invocations** — each Task's description (or the start of its prompt), linking to the session it ran in.
- **See related tips** — jumps to the [Tips](/claude-code/tips/) page.

## Closing a rail

Selecting a cell or bar opens its rail beside the page; clicking the same item again, or the rail's close button, closes it.

## What you'll do next

The heatmap surfaces the patterns. The fix is usually one of:

| Pattern | Fix |
|---|---|
| One file gets read repeatedly | Ask with `specship_explore` naming the file or its symbols — it returns the verbatim source in one call. |
| `Grep` / `Bash` grep returns huge results | Use `specship_search` to locate a symbol, or `specship_explore` to read the area. |
| One subagent type runs constantly | Check whether the work needs delegating at all, or give the subagent a narrower, stable brief. |

→ Next: [Costs & cache](/claude-code/costs/) — the financial view.
