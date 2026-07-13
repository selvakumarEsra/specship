---
id: LEARN-DOC
title: Learning loop — crystallize success, recall experience
owner: specship
priority: medium
---

<!-- id: LEARN-DOC -->
# Learning loop — crystallize success, recall experience

The reflection engine (REFLECT-DOC) mines transcripts for **anti-patterns**
(waste) and proposes fixes; nothing yet crystallizes a **successful**
trajectory into a reusable artifact, and the ingested task history —
tier 3 of SpecShip's memory (graph → specs → history → crystallized
behavior) — is write-only from the agent's perspective. This document closes
both gaps, informed by a review of Hermes Agent's memory/skills architecture
(their success-triggered `skill_manage`, `/learn` command, and FTS session
search are the adopted ideas; their LLM-summarized memory and user modeling
are deliberately not).

House constraints carried over unchanged:

- **Human-gated, always.** Every learned artifact flows through the existing
  proposal lifecycle (preview → apply → undo); nothing interpretive lands
  without confirmation (DOM-SPECSHIP-003). Hermes gates writes optionally;
  SpecShip gates them mandatorily.
- **Deterministic first.** Recall and outcome records are computed joins over
  ingested data — never LLM summaries presented as fact.
- **No new MCP tools** for recall — agents under-pick new tools (measured);
  recall rides inline in `specship_explore`, exactly as domain facts do.
- **Honest signals only.** Transcripts store tool-call metadata and result
  LENGTH, not exit codes — so "success" must be inferred from workflow-run
  statuses and structural patterns, never fabricated from unavailable data.

<!-- id: REQ-LEARN-001 -->
## The miner MUST crystallize successful trajectories, not only waste

Three success-pattern detectors join the existing mining rules, each
producing a normal human-gated proposal:

- **Completed-run recipe:** a workflow run with `status: completed` whose
  step count ≥5 proposes a `skill` capturing the recipe — the workflow name,
  inputs, and the per-step outline from its events — so the next same-shaped
  task starts from the crystallized routine.
- **Error→workaround pair:** the same normalized shell command failing-shaped
  in one turn (immediately re-run in altered form that then recurs across
  ≥2 sessions) proposes a `memory_rule` capturing the working variant as the
  preferred form. [needs review: without exit codes, "failing-shaped" =
  re-run-with-different-flags heuristic — threshold tuned from telemetry.]
- **Corrected approach:** extend the existing recurring-correction detector
  to capture the *corrected* approach as the rule content (today it only
  flags that correction happened).

implementations:
  - src/reflect/miner.ts:mineProposals

## Acceptance
<!-- id: REQ-LEARN-001.A1 -->
- A completed ≥5-step workflow run yields an open `skill` proposal whose
  preview shows the recipe (workflow, inputs, step outline) and cites the
  run id as evidence.
<!-- id: REQ-LEARN-001.A2 -->
- A command re-run in altered form in the same session, with the altered
  form recurring in later sessions, yields a `memory_rule` proposal naming
  the working variant.
<!-- id: REQ-LEARN-001.A3 -->
- Success proposals converge by content hash like every other proposal —
  re-mining the same run/pattern never duplicates a row.

<!-- id: REQ-LEARN-002 -->
## An explicit capture door MUST crystallize the current session on demand

`/specship:learn` (installed with the governance tier) instructs the agent
to distill the CURRENT session's workflow — the goal, the tool sequence that
worked, the pitfalls hit — and submit it as a `skill` proposal via a
`specship reflect capture` CLI entry (title + content on stdin/flags). The
proposal enters the same lifecycle as mined ones: nothing is written to
`commands/` or memory until the user applies it. The command's output tells
the user where to review (`/specship:check` or the dashboard's Improvements
surface).

implementations:
  - src/bin/specship.ts:main
  - commands/specship/learn.md

## Acceptance
<!-- id: REQ-LEARN-002.A1 -->
- `specship reflect capture --title T` with content on stdin creates an open
  `skill` proposal with provenance distinguishing it from mined ones.
<!-- id: REQ-LEARN-002.A2 -->
- The proposal previews and applies through the existing reflect surfaces,
  and `--yes`-free apply writes the same marker-delimited artifact shapes
  REFLECT-DOC already defines.
<!-- id: REQ-LEARN-002.A3 -->
- Capturing the same content twice converges to one proposal row.

<!-- id: REQ-LEARN-003 -->
## Explore MUST surface prior work on the same code inline

When an explore query's resolved symbols live in files that past sessions
edited (tier-3 task history), the response appends a compact **Prior work**
section — date, session id, the prompt's first line, files touched, and any
workflow run / spec link asserted in that session — capped small and
rendered only on a match, exactly like the Domain-facts section (additive +
silent on the hot path). Recall is a deterministic SQL join over ingested
tables; no summarization. Sessions from other projects never appear
(REQ-REFLECT-008's scoping predicate).

implementations:
  - src/mcp/tools.ts:ToolHandler.buildDomainFactsSection

## Acceptance
<!-- id: REQ-LEARN-003.A1 -->
- An explore naming a symbol whose file a past session edited shows that
  session's date, opening prompt, and touched files in a Prior-work section.
<!-- id: REQ-LEARN-003.A2 -->
- An explore over never-touched files renders no Prior-work section and adds
  zero cost to the hot path beyond one indexed query.
<!-- id: REQ-LEARN-003.A3 -->
- Another project's sessions never surface, in real or mangled path form.

<!-- id: REQ-LEARN-004 -->
## Each session MUST get a deterministic outcome record

At ingest, each session resolves to a computable outcome row: files edited
(Edit/Write targets), commands run, specship calls made, workflow runs
started/completed in-session, spec links asserted, total cost. Derived
purely from existing `claude_*` and `workflow_runs` rows (a view or derived
table — no new agent-facing write path), it feeds the Prior-work section
(REQ-LEARN-003) and a dashboard "recent work" view. Test outcomes are NOT
claimed unless a workflow run's verify step recorded them — transcripts
carry no exit codes, and the record never states what the data can't prove.

implementations:
  - server/src/ingest/ingestor.ts:ingestAll

## Acceptance
<!-- id: REQ-LEARN-004.A1 -->
- After ingesting a session with edits and a completed workflow run, its
  outcome record lists the edited files, the run and its status, and the
  session cost.
<!-- id: REQ-LEARN-004.A2 -->
- A session with no verify evidence shows no test-outcome claim.
