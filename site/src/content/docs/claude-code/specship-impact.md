---
title: SpecShip Impact
description: Is SpecShip earning its keep? Measured tokens its tools spent vs. a conservative estimate of tokens saved — per prompt, session, project, and all projects.
---

The **SpecShip Impact** page (in the desktop UI — `specship serve --ui`) answers one question: *is SpecShip earning its keep?* It keeps two numbers deliberately apart.

## The two numbers

- **Spend — measured (exact).** The tokens SpecShip's own tool calls put into the conversation. Summed per prompt → session → project → all-projects, straight from the ingested transcripts. Includes the code-graph tools, the spec tools, and the design tools.
- **Saved — estimated.** For each source-returning code-graph query (`specship_explore`, `specship_node`, `specship_callers`/`callees`/`impact`, `specship_search`, `specship_files`), SpecShip resolves the symbols the query named to the files they live in, and takes the **size of those files** — what a `Read` of them would have cost — minus what SpecShip actually returned. Files are de-duplicated **per prompt**, so a file two calls in the same turn both touch is counted once.

**Net = saved − spend − overhead**, shown honestly (it can be negative).

## "Saved" is a conservative lower bound

This is the most important thing to understand about the page:

> Saved credits only a **single direct read of the named files** — *not* the multi-call grep + read exploration (re-reads, dead-ends, and the extra agent **turns**) that SpecShip actually replaces.

The real end-to-end win — fewer turns over a much smaller accumulated context — is a **with-vs-without (A/B)** result, which a single transcript can't see. So **treat spend as exact and saved as a floor.** A negative net does *not* mean SpecShip was wasteful; it means the tool results cost more than reading those exact files once would have — which was never the real alternative.

A query whose symbols can't be resolved (a pure natural-language question with no symbol-shaped tokens, or a project whose index isn't available) contributes **zero** saved — the estimate under-claims rather than over-claims. The page shows how many calls were unresolved so the coverage is visible.

## What's on the page

- **Header tiles:** Spend (tokens · cost), **Est. saved** (tokens · cost, badged `est.`), **Net** (sign-coloured — green when positive), and a **Coverage** line (how many SpecShip calls resolved vs. were unresolved).
- **Trend:** spend vs. saved over the selected range.
- **By tool:** calls, spend, and est. saved per tool. (Per-tool *saved* is an approximation; the headline saved is the exact per-prompt-deduplicated figure.)
- **By project:** shown in all-projects mode (when no project is picked). Per-project net is `saved − spend` and does **not** include the per-session overhead, so the rows won't sum to the headline net.
- **Methodology** disclosure spelling out every assumption.

Session Detail carries the same numbers inline: a `SpecShip ~N tok` chip on each prompt row and a spent / saved / net line in the session summary.

## Estimate details & limits

- Tokens ≈ characters ÷ 4 (a proxy, not a tokenizer).
- A fixed per-session **overhead** line accounts for SpecShip's tool definitions in the system prompt.
- Cost is priced at your model's input rate; unknown models contribute tokens but no cost.
- v1 estimates **savings for the primary project only** — other projects show their spend exactly but their savings as unresolved. Per-workflow attribution is not yet broken out.

→ Back to the [Claude Code overview](/claude-code/overview/).
