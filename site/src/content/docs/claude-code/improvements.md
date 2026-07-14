---
title: Self-improvement (Reflection)
description: SpecShip observes your sessions, crystallizes what worked into reusable skills and rules, and recalls prior work — all human-gated, all local.
---

SpecShip runs a **learning loop** over your own Claude Code history: it
observes (the ingest watcher), detects patterns (deterministic mining rules —
never an LLM guessing), proposes durable fixes, and — only after you approve —
crystallizes them into rules, skills, and hooks that make every later session
better. Four principles govern it:

- **Human-gated, always.** Every learned artifact is a *proposal* with a
  preview diff; nothing touches disk until you apply it, and every apply is
  undoable.
- **Deterministic.** Proposals cite the actual rows that triggered them
  (sessions, prompts, runs). Recall is a SQL join, not a summary.
- **Local.** The whole loop runs over the SQLite tables in `.specship/` —
  nothing leaves your machine.
- **Honest.** Transcripts don't record exit codes, so "success" comes only
  from signals that prove it (a workflow run's own completed status) — never
  from inference the data can't support.

## The four-tier memory

| Tier | What | Written by |
|---|---|---|
| **1 · Graph** | Every symbol, edge, file — deterministic truth | tree-sitter extraction |
| **2 · Intent** | Specs, acceptance criteria, domain facts | you (human-confirmed) |
| **3 · Experience** | Every session: prompts, tool calls, costs, workflow runs, per-session outcome records | the ingest watcher |
| **4 · Crystallized behavior** | CLAUDE.md rules, memory notes, slash commands, hooks | reflection proposals **you applied** |

## What the miner detects

Run `specship reflect` (or open the dashboard's **Improvements** page). The
rule set covers both directions:

**Waste →** repeated re-reads of the same file, grep/find habits, repeated
prompts worth a slash command, repeated post-edit commands worth a hook,
destructive-command patterns, edit hotspots, sessions that never touched the
graph, oversized tool outputs, reference docs read every session.

**Success →** a **completed multi-step workflow run** becomes a reusable
recipe proposal (the steps that worked, the exact re-run command); a shell
command you kept correcting into a working form becomes a "use this form"
rule; a recurring correction is captured *with the context it followed* —
"when doing work like Y: do X" — instead of a context-free preference.

## Capture on demand: `/specship:learn`

After a session where a non-trivial workflow went well, run `/specship:learn`
in Claude Code. The agent distills what actually happened — goal, working
tool sequence, pitfalls avoided — and submits it via
`specship reflect --capture --title "…"` as a skill proposal. Hard rules
baked into the command: only what really happened, no invented steps, and it
never applies itself.

## Recall: "Prior work" in explore

When `specship_explore` resolves to files that past sessions edited, the
response includes a **Prior work** section — date, what was asked, files
touched, workflow runs in that window — so the agent (and you) start from
what was already done instead of rediscovering it. Deterministic, capped
small, silent when there's no match, and never showing another project's
sessions.

## Applying and undoing

Every proposal shows a **preview diff** of exactly what it would write
(a marker-delimited CLAUDE.md block, a `~/.claude/memory` note, a slash
command file, or a `settings.json` hook entry). Apply from the dashboard's
Improvements page; re-running the miner converges to the same proposal
(content-hashed) instead of duplicating it; undo removes exactly what apply
wrote. Dismissed proposals never resurface.
