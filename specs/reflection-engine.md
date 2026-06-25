---
id: REFLECT-DOC
title: Reflection Engine (self-improving harness)
owner: core
priority: high
version: 1
brief: reflection-engine/brief.md
---

<!-- id: REFLECT-DOC -->
# Reflection Engine

SpecShip already ingests every Claude Code transcript into the knowledge graph
(`claude_prompts` / `claude_tool_calls` / `claude_sessions`) and surfaces a
static, rule-based tips list. This document specifies the **reflection engine**
that closes the self-improvement loop: it mines those transcripts for recurring,
actionable patterns and proposes **durable, human-gated changes** — memory /
`CLAUDE.md` rules, skills / commands, and hooks — that feed back into future
sessions.

The governing principle is **propose, never auto-apply**: the engine surfaces
typed, evidence-backed proposals, and a change reaches disk only when the user
confirms a specific proposal through a preview-diff gate. Proposals are persisted
so the engine can distinguish new findings from already-seen ones and the user
can dismiss noise.

<!-- id: REQ-REFLECT-001 -->
## Reflection MUST mine ingested transcripts into typed, evidence-backed proposals

A reflection pass reads the already-ingested transcript tables and detects
recurring, actionable patterns — repeated corrections, repeated friction,
confirmed decisions, and manual multi-step routines — and emits a set of
proposals. Each proposal carries a target artifact type (see REQ-REFLECT-002),
a severity drawn from the existing tips severity scale, and the evidence it was
derived from (the contributing session/prompt identifiers and any graph nodes),
so the user can judge it before applying. When the transcript history holds no
usable signal, the pass returns an empty proposal set together with an
explanatory empty state — never an error.

implementations:
  - src/reflect/miner.ts:mineProposals

## Acceptance
<!-- id: REQ-REFLECT-001.A1 -->
- A reflection pass over a corpus containing a recurring actionable pattern
  returns at least one proposal whose payload includes a severity and a
  non-empty evidence reference (≥1 contributing session or prompt id).
<!-- id: REQ-REFLECT-001.A2 -->
- A reflection pass over an empty or signal-free transcript corpus returns an
  empty proposal set and an explanatory empty-state indicator, and does not
  throw or return an error status.
<!-- id: REQ-REFLECT-001.A3 -->
- Every returned proposal declares exactly one target artifact type that is one
  of the types enumerated in REQ-REFLECT-002.

<!-- id: REQ-REFLECT-002 -->
## Each proposal MUST declare a target artifact type and a concrete, previewable change

A proposal is not advisory text — it resolves to a specific intended file change.
The engine MUST support these artifact types, each with a defined write target:

- **memory / rule** — when the learning is project-specific, a marker-delimited
  rule block in the project `CLAUDE.md`; when the learning is portable across
  projects, a `~/.claude/memory/<slug>.md` note plus a one-line pointer in
  `MEMORY.md`. The engine selects the target per the nature of the learning, and
  the preview states which target was chosen.
- **skill / command** — a new `commands/ss-<name>.md`, or a marker-bounded edit
  to an existing command file.
- **hook** — a merge into `.claude/settings.json` of a hook entry.

Each proposal MUST carry the exact intended content for its target so the
preview (REQ-REFLECT-003) can be rendered without recomputation.

implementations:
  - src/reflect/targets.ts:buildProposal

## Acceptance
<!-- id: REQ-REFLECT-002.A1 -->
- A memory/rule proposal whose learning is classified project-specific resolves
  its target to a marked block in the project `CLAUDE.md`; one classified
  portable resolves its target to a `~/.claude/memory/<slug>.md` note plus a
  `MEMORY.md` pointer line.
<!-- id: REQ-REFLECT-002.A2 -->
- A skill/command proposal resolves its target to a path under `commands/`
  matching `ss-<name>.md`.
<!-- id: REQ-REFLECT-002.A3 -->
- A hook proposal resolves its target to a hook entry within
  `.claude/settings.json`.
<!-- id: REQ-REFLECT-002.A4 -->
- Each proposal exposes the full intended file content (or marked-block body) for
  its target prior to any apply action.

<!-- id: REQ-REFLECT-003 -->
## Applying a proposal MUST render the exact diff before any write

When the user initiates apply on a proposal, the engine produces a diff of the
exact change it will make to the target file — the marked block to be inserted or
updated, the new file to be created, or the hook to be merged — and presents it
for confirmation. No bytes are written to disk during preview generation.

implementations:
  - src/reflect/apply.ts:previewProposal

## Acceptance
<!-- id: REQ-REFLECT-003.A1 -->
- Initiating apply on any proposal returns a diff representing the precise target
  file change, and leaves the target file unmodified on disk.
<!-- id: REQ-REFLECT-003.A2 -->
- The diff reflects the same content exposed by REQ-REFLECT-002.A4 for that
  proposal.

<!-- id: REQ-REFLECT-004 -->
## Confirming a proposal MUST write its target idempotently and reversibly

On confirmation, the engine writes the change via marker-delimited block upsert
(for `CLAUDE.md` rules, existing-command edits, and `MEMORY.md` pointers) or
new-file creation (for memory notes and new commands) or a structured merge (for
hooks). Re-confirming a proposal whose change is already present byte-identical
makes no further change and reports an unchanged outcome. An undo of a previously
applied proposal removes exactly what the apply added — stripping the marked
block, deleting the engine-created file, or removing the merged hook entry —
leaving surrounding user content intact. Writing a memory note or command that
would overwrite an existing non-marked file at that path MUST be refused as a
conflict rather than clobbering it.

implementations:
  - src/reflect/apply.ts:applyProposal
  - src/reflect/apply.ts:undoProposal

## Acceptance
<!-- id: REQ-REFLECT-004.A1 -->
- Confirming a proposal writes its change to the correct target file (CLAUDE.md
  marked block / `~/.claude/memory/<slug>.md` + `MEMORY.md` line /
  `commands/ss-<name>.md` / `.claude/settings.json` hook).
<!-- id: REQ-REFLECT-004.A2 -->
- Re-confirming the same proposal when its change is already present
  byte-identical writes nothing further and reports an `unchanged` outcome.
<!-- id: REQ-REFLECT-004.A3 -->
- Undoing an applied proposal removes exactly the bytes the apply added and
  leaves all surrounding content in the target file unchanged; undoing a
  never-applied proposal is a no-op.
<!-- id: REQ-REFLECT-004.A4 -->
- An apply whose new-file target path already exists as a non-marked file is
  refused with a conflict outcome and writes nothing.

<!-- id: REQ-REFLECT-005 -->
## Reflection MUST NOT write to disk without explicit per-proposal confirmation

Generating proposals, running a sweep, and rendering previews are all
non-mutating. The engine writes to any target file only as the direct result of a
per-proposal confirmation. A reflection or sweep run, with no confirmation issued,
modifies no file on disk.

implementations:
  - src/reflect/apply.ts:applyProposal

## Acceptance
<!-- id: REQ-REFLECT-005.A1 -->
- Running a reflection pass and a background sweep to completion, with no apply
  confirmation issued, results in zero modifications to any target file.
<!-- id: REQ-REFLECT-005.A2 -->
- Each disk write is attributable to exactly one confirmed proposal.

<!-- id: REQ-REFLECT-006 -->
## Reflection MUST be triggerable on demand and via a daily background sweep

The engine is invocable two ways: on demand — from a dashboard control and from a
`specship reflect` CLI subcommand for headless / CI use — and via a low-frequency
background sweep that runs approximately daily. The sweep notifies the user (via
the existing PWA notification channel) only when it surfaces **new**
high-severity proposals — proposals not previously seen, applied, or dismissed
per REQ-REFLECT-007. Lower-severity and already-seen proposals appear in the
dashboard list but raise no notification.

implementations:
  - src/reflect/sweep.ts:sweep
  - src/reflect/sweep.ts:analyze

## Acceptance
<!-- id: REQ-REFLECT-006.A1 -->
- `specship reflect` runs a reflection pass headlessly and reports the resulting
  proposals (or the empty state) without requiring the dashboard.
<!-- id: REQ-REFLECT-006.A2 -->
- A background sweep that surfaces a new high-severity proposal emits exactly one
  PWA notification for it.
<!-- id: REQ-REFLECT-006.A3 -->
- A background sweep that surfaces only low/medium-severity or already-seen
  proposals emits no notification.

<!-- id: REQ-REFLECT-007 -->
## Proposals MUST be persisted with state and surfaced as a reviewable Improvements list

Each proposal is persisted in the SpecShip database keyed by a stable content
hash, with a state of `open`, `applied`, `undone`, or `dismissed`. The dashboard
presents open proposals as an Improvements list showing each proposal's severity,
its evidence, a preview action, and per-proposal apply / undo / dismiss controls.
A dismissed proposal does not resurface on subsequent sweeps, and the "new"
determination of REQ-REFLECT-006 is computed against this persisted set so a
proposal already applied or dismissed is never re-notified.

implementations:
  - src/reflect/store.ts:ReflectStore

## Acceptance
<!-- id: REQ-REFLECT-007.A1 -->
- Two reflection runs over the same pattern produce the same content-hash key for
  the corresponding proposal (no duplicate persisted rows).
<!-- id: REQ-REFLECT-007.A2 -->
- Dismissing a proposal sets its state to `dismissed`, and a later sweep that
  re-derives the same proposal neither lists it as open nor notifies on it.
<!-- id: REQ-REFLECT-007.A3 -->
- Applying a proposal sets its state to `applied`; undoing it sets `undone`; the
  state is reflected in the dashboard Improvements list.
<!-- id: REQ-REFLECT-007.A4 -->
- The Improvements list renders, for each open proposal, its severity, a
  non-empty evidence reference, and apply / undo / dismiss controls.
