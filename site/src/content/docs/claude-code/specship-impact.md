---
title: SpecShip Impact (removed)
description: The SpecShip Impact page and its tokens-saved estimate were removed in 0.25.0. Here is why, and where to look instead.
---

Earlier releases planned a **SpecShip Impact** page that set the tokens
SpecShip's own tools spent against an *estimate* of the tokens they saved.
**It was removed in 0.25.0** and is not part of the dashboard.

## Why it was removed

The estimate never reached the screen, and it couldn't be made honest: it
credited only a single direct read of the files a query named, relied on a
hard-coded size for SpecShip's tool definitions that had gone stale, and a
single transcript can't see the real win — fewer turns over a smaller
context — which only a with-vs-without comparison measures. SpecShip promises
only what it can prove, so the engine, its API route, and its background
backfill were taken out rather than shown.

## Where to look instead

- **What SpecShip's tools cost in a session** — the
  [Sessions](/claude-code/sessions/) detail rail breaks each session's tools
  down by result tokens returned, `specship_*` calls included, and the
  [Heatmap](/claude-code/heatmap/) Tools lane ranks every tool by calls and
  result size.
- **Whether sessions use SpecShip at all** — the
  [MCP servers](/claude-code/mcp/) page shows the `specship` server's calls,
  per-tool call counts, and last use, from your own transcripts.
- **Whether SpecShip saves work** — that's an A/B question, answered by the
  benchmark harness that runs the same tasks with and without SpecShip and
  compares tool calls and wall-clock time. The README's performance numbers
  are rendered from those dated, version-stamped results.
