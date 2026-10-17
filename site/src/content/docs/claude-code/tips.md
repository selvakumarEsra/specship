---
title: Tips engine
description: Rule-based findings over your Claude Code transcripts — each with the evidence that triggered it and a concrete, copyable fix.
---

The **Tips** page is a rule-based pattern-matcher over the data the ingest watcher writes. Each rule is a query that looks for one specific anti-pattern; when it fires, a tip card surfaces with **evidence** (the session that triggered it) and a **concrete fix** you can copy.

> _You read `auth.ts` 12× in one session — specship_explore covers it._

Tips cite only the sessions of the project the dashboard opened, never another project's. The sidebar badge counts the tips still waiting on you.

## What's on a tip card

| | |
|---|---|
| **Severity** | A colored left edge and pill — error (red) or warn (amber). Errors sort first. |
| **Title** | One sentence naming the finding. |
| **Why** | A short paragraph on why it costs you. |
| **Evidence** | The session that triggered it, with the specific detail (file, tool, counts). Click to open that session. |
| **Impact** | A rough sense of the cost involved. |
| **Fix** | The next step — a tool to reach for, a setting, or a workflow to run — with a copy button. |
| **Apply / Dismiss** | **Apply** marks the tip as acted on; it stays in the list, dimmed, with an Applied badge. **Dismiss** removes it for good — it won't come back even when the rule matches again. |

Both states are saved by the dashboard server, so they survive a restart.

## The rules

### Repeated reads of one file — error

Fires when the same file is `Read` **10 or more times in one session** (the top five cases).

Re-reading the same file burns input tokens every turn. One `specship_explore` naming the file or its symbols returns the source, plus its connections, in a single call.

### Oversized tool result — error

Fires when a single tool call returned a very large result (the five largest above the threshold).

Tools that dump raw content into context are the dominant cost driver. The fix points at `specship_search` instead of a shell grep, or `specship_explore` on the symbol.

### Low cache read rate — warn

Fires for sessions of **10 or more prompts** whose cache read rate is **below 30%** (the worst three).

When the start of the context keeps changing, the cache can't absorb your input. Keeping the stable part of the context stable lets most of it be served from cache.

### Small model re-reading files — warn

Fires when a **Haiku or Sonnet session made 15 or more `Read` calls** — the re-read spiral smaller models fall into on plan-and-synthesize work.

The fix recommends a bigger model, or the same work packaged as the bundled `spec-implement-mixed` workflow: Sonnet plans, Haiku executes, and the tests and approval gates verify. Frontier-model sessions with the same read count don't trigger it. See [Low-end models](/claude-code/low-end-models/).

## Tips vs. self-improvement proposals

Tips are a quick, read-only lens on recent sessions. For durable fixes — a memory rule, a hook, a skill, a learned project convention — SpecShip's [reflection miner](/claude-code/improvements/) mines the same transcripts into human-gated proposals you can apply and undo.

→ Back to the desktop UI overview at [Claude Code — Overview](/claude-code/overview/).
