---
slug: reflection-engine
spec: REFLECT-DOC
created: 2026-06-25
---

# Brainstorm: SpecShip Reflection Engine (self-improving harness)

## Problem
SpecShip already *observes* how Claude Code works — it ingests every transcript
into `claude_prompts` / `claude_tool_calls` / `claude_sessions`, and surfaces a
static, rule-based "tips" engine in the dashboard. But the self-improvement loop
is **open**: observations never become durable, project-specific changes that
feed back into future sessions, and nothing measures whether a change helped.

A Hermes-style self-improving harness closes that loop:
**observe → reflect → write a durable change → measure → repeat.** The harness
should get measurably better at *this* codebase over time, while staying
human-gated (propose, never auto-apply).

## Code grounding
- **Observation layer (exists):** `packages/server/src/ingest/` — `ingestor.ts`
  (transcript tail-ingest into `claude_prompts` / `claude_tool_calls` /
  `claude_sessions`), `parser.ts` (extracts prompt text, tool name + file path /
  command / pattern / MCP tool), `watcher.ts` (fires on session activity),
  `pricing.ts`, `specship-classify.ts`, `impact-*.ts`.
- **Static tips engine (to evolve → "Improvements"):** `packages/server/src/routes/claude.ts`
  — `GET /api/claude/tips`, "each rule is a SQL query that finds a wasteful
  pattern" → emits `{severity, …}` tips, advisory-only, never acts.
- **Memory layer (apply target A):** `packages/server/src/routes/memory.ts`
  reads the CLAUDE.md hierarchy + `~/.claude/memory/*.md`; convention is one fact
  per `~/.claude/memory/<slug>.md` + a one-line pointer in `MEMORY.md`. The
  `auto-didact` skill already writes these.
- **Safe block writes (apply mechanism):** the installer's marked-section
  helpers in `src/installer/targets/shared.ts` (`upsertMarkedSection`,
  `removeMarkedSection`) + `instructions-template.ts` markers — idempotent,
  reversible block writes into config/markdown. `packages/server/src/routes/spec.ts`
  already does `atomicWriteFile` to the working tree, so the server can write
  apply targets.
- **Skill / command target (apply target B):** project ships `commands/ss-*.md`
  (see `package.json` `files`); a new skill = a new `commands/ss-<name>.md`.
- **Hook target:** `.claude/settings.json` (same shape the installer merges into).
- **Notifications (trigger):** the just-shipped PWA stack —
  `packages/server/src/routes/events.ts` (cross-project SSE),
  `packages/web-ng/src/app/pwa/{notifications,event-monitor}.ts` — gives the
  background-sweep its notification channel for free.

## Approaches considered
1. **Three separate features (memory / skills / tips), built independently** —
   simplest to scope each, but triplicates the transcript-mining + apply-write
   plumbing and yields three inconsistent surfaces.
2. **One reflection engine, three+ artifact types, one gated apply** — a single
   mining backbone produces *typed* proposals (memory-or-rule, skill/command,
   hook); the evolved Tips→Improvements surface lists them; one
   preview-diff→confirm→write pipeline writes the right file per type.
3. **Eval-driven self-tuning of the harness internals** (explore budget,
   tool-steering) — rejected as the primary axis: the codebase is explicit that
   low-salience channels don't reliably move the agent's *tool choice*, so this
   mostly won't land.

**Chosen: Approach 2** — one engine, shared mining + apply plumbing, three artifact
outputs under a single human-gated apply. It builds directly on the existing
observation + memory + tips substrate, and concentrates the self-improvement
value where it actually lands.

## Key decisions
- **Artifact types (all three + hooks):** A = memory note (`~/.claude/memory/<slug>.md`
  + `MEMORY.md` line) and/or a marker-delimited rule block in the project
  `CLAUDE.md`; B = new `commands/ss-<name>.md` (or marker-bounded edit to an
  existing one); plus a hook merge into `.claude/settings.json`. All surfaced as
  the evolved **Improvements** list (C).
- **Apply model = preview-diff → confirm → write.** Writes go through
  marked-section upsert + new-file creation, so apply is **idempotent**
  (re-apply = no-op) and **reversible** (undo strips the marked block / deletes
  the new file). One-click but never blind.
- **Trigger = both:** an on-demand **Analyze** button on the dashboard +
  a `specship reflect` CLI for headless/CI, **and** a low-frequency background
  sweep that fires a **PWA notification** when new high-severity proposals appear.
- **Propose, never auto-apply.** Every change is human-gated. The engine writes
  nothing until the user confirms a specific proposal.
- **Grounded proposals.** Each proposal cites its evidence (the sessions/prompts
  + graph nodes it was derived from) and carries a severity, so the user can
  judge it before applying.
- **Channel reality:** self-improvement that lands changes what the agent
  *knows* (durable facts/rules it reads — A and B), not what tools it *picks*;
  we deliberately do **not** try to retune tool-steering.

## Edge cases & non-goals
- **No transcripts / sparse history** → reflection returns an empty proposal list
  with a clear "not enough signal yet" state, not errors.
- **Re-applying / duplicate proposals** → idempotent; a proposal whose marked
  block already exists byte-identical reports "already applied / unchanged."
- **User-edited target file** → marked-section upsert touches only its own block;
  never clobbers surrounding user content. New files refuse to overwrite an
  existing non-marked file (surface a conflict instead).
- **Undo** → strips the marked block or deletes the engine-created file; an undo
  of a never-applied proposal is a no-op.
- **Background sweep cost** → low frequency; only *new* high-severity transitions
  notify (mirror the existing `events.ts` "emit only new transitions" rule).
- **Non-goals:** auto-applying without confirmation; eval-driven tool-steering
  self-tuning (Approach 3); cross-machine/cloud sync of learnings; non-Claude-Code
  agent targets (this fork is Claude-Code-only).

## Acceptance criteria
- Running reflection (button or `specship reflect`) over ingested transcripts
  produces a list of typed proposals (memory/rule, skill/command, hook), each with
  cited evidence and a severity; with no usable transcripts it returns an empty
  list and an explanatory empty-state, not an error.
- Each proposal renders a **preview diff** of the exact file change it will make
  before any write.
- Confirming a proposal **writes the real file** at the correct target (memory
  note + `MEMORY.md` line / `CLAUDE.md` marked block / `commands/ss-<name>.md` /
  `.claude/settings.json` hook).
- Apply is **idempotent** (re-applying an unchanged proposal reports
  unchanged/already-applied and writes nothing new) and **reversible** (undo
  removes exactly what apply added, leaving surrounding content intact).
- A background sweep surfaces new high-severity proposals via a PWA notification
  without the user opening the dashboard.
- No proposal is ever written to disk without an explicit per-proposal confirm.
