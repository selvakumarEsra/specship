---
title: Heatmap
description: Which files do my sessions touch most? Which tools are token-heavy? Which subagents eat the budget? File / Tool / Subagent drill-downs, each with their own detail rail.
---

The **Heatmap** page is for spotting patterns in your Claude Code activity that you wouldn't notice prompt-by-prompt. It has three lanes:

| Lane | What |
|---|---|
| **Files** | A grid of cells, one per file touched in the range, color-intensity by tool-call count. |
| **Tools** | A horizontal bar chart, one bar per tool, length by total invocations, color by total result tokens. |
| **Subagents** | Same shape as Tools, but grouped by subagent name (attribution via `is_sidechain`). |

A range selector (Today / This week / This month / Custom) sits at the top and filters every lane.

## Files lane

One cell per file, sized roughly by path length so longer paths get more room to render their text. Color intensity is **calls per file** (linear, normalized to the page's max).

Hover any cell for the full path + call count. Click for a **detail rail** that slides in on the right with:

| Section | Content |
|---|---|
| **Header** | File path (with copy button) + 7-day trend sparkline of calls. |
| **Heavy-tool callout** | "_`Read` returned 396k tokens here — a structural query would cover it in a fraction._" — surfaces when a single tool on this file dominated the token budget. |
| **Tool breakdown** | Which tools touched this file, how many times each, total result tokens, with color-flagged bars when a tool's output was disproportionately large. |
| **Sessions that touched it** | Clickable rows that deep-link to the Sessions page for the specific session. |
| **Show in graph** | Routes to `/graph?focus=<symbol>` for the most-likely matching symbol in the file. |
| **Reveal in editor** | Opens the file in your default editor. |

The detail rail is where you'd realize that `auth.ts` is being read 17 times per session — and decide to replace those Reads with one `specship_explore`.

## Tools lane

Horizontal bars, one per tool (Read, Grep, Bash, Edit, Write, the `specship_*` family, etc.). The bar length is **invocation count**; the fill color encodes **average result tokens per invocation** — clay/peach for normal, deep red for the heavy ones.

Click any tool bar for a detail rail with:

- **Per-call stats** — total invocations, total result tokens, average tokens per call (color-flagged when high).
- **Token-waste tip** — _"`Bash(grep)` dumps whole matching lines; `specship_search` covers it in ~99% fewer tokens."_ — engine-style, with copyable replacement command.
- **Top files hit by this tool** — bar list. Tells you which targets this tool was used on most.
- **Sessions where this tool fired** — clickable session rows.

The Tools rail is where you'd realize that 60% of your token budget for the week went to `Bash(grep)` calls that could have been one `specship_search`.

## Subagents lane

Same shape as the Tools rail, but grouped by **subagent name** rather than tool. SpecShip extracts each subagent's name from the parent prompt's Task call (`subagent_type: ...`) and attributes the sidechain prompts' costs to it.

Click any subagent bar for:

- **Invocations**, total tokens, **total cost in $** for this subagent alone.
- **Avg per invocation** — useful for spotting subagents that consistently burn budget.
- **Plan-ref waste tip** when a subagent is heavy: _"Pass a `--plan-ref` so the subagent reads a stable plan from disk instead of re-reading every file every time."_
- **Sessions** where this subagent ran.
- **Related tips** — engine-generated suggestions for this subagent specifically.

The Subagents rail is the one that answers "which Task-spawned thing ate $30 of my budget last week?"

## Drill-down composition

All three rails share the same component, so:

- They all support **deep-linking** — every session row in any rail routes to the Sessions deep-dive.
- They all have a **"Show in graph"** affordance where it makes sense (file → first symbol in file).
- They all **persist their selection in the URL** — `/heatmap?file=src/auth.ts` is shareable.

Selecting a cell or bar **reflows the main grid** to make room for the detail rail; another click on the same cell closes it.

## Filtering across all lanes

The range selector at the top filters all three. The desktop UI also exposes a project picker — pick a project and the heatmap scopes to its sessions only. Pick nothing and you see all projects merged.

The heatmap lives in the desktop UI — start it with `specship serve --ui` and open the **Heatmap** page.

## What you'll do next

The heatmap surfaces the patterns. The fix is usually one of:

| Pattern | Fix |
|---|---|
| One file gets Read repeatedly | Add a `// @implements` pragma so the agent finds it via the graph. Or steer prompts to `specship_explore` for that file. |
| `Bash(grep)` dominates token budget | Replace grep with `specship_search` in your tips/prompts. |
| One subagent is 70% of the cost | Restructure your workflow to either inline the subagent's job or give it a stable plan reference. |
| Cache rate < 30% on certain prompts | Pin a stable system-prompt prefix in your project's CLAUDE.md. |

→ Next: [Costs & cache](/claude-code/costs/) — the financial view.
