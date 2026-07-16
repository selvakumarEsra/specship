---
id: MEMLESSON-DOC
title: Capture lessons to memory, and review/manage memory items
owner: core
priority: medium
version: 1
---

<!-- id: MEMLESSON-DOC -->
# Capture lessons to memory, and review/manage memory items

SpecShip's reflection engine already mines transcripts into human-gated memory
rules, and the learn door crystallizes *successful* routines into skill
proposals — but there is no explicit door to capture a *mistake / anti-pattern*
on demand so the agent doesn't repeat it, and no way to review what's stored in
memory and remove or update it. This document adds a `specship memory` command
group (`capture` / `list` / `remove` / `edit`) that reuses the reflection
engine's proposal store, preview-diff, dedup, and reversible marker-based apply —
no parallel storage. Removes and updates are previewed before writing, and
SpecShip-applied items stay reversible through the engine's existing marker undo.

<!-- id: REQ-MEMLESSON-001 -->
## SpecShip MUST let a user capture a lesson on demand as a human-gated memory rule

`specship memory capture` takes a stated mistake and the rule to avoid repeating
it and produces a `memory_rule` proposal targeting either a Claude Code memory
note or a marked block in the project CLAUDE.md — user-chosen, defaulting to the
memory note. Nothing is written on capture: the proposal enters the same
human-gated lifecycle as mined proposals (preview → apply), reaching disk only on
apply, and is deduped by content hash. This is the anti-pattern analog of the
success-capture door (REQ-LEARN-002), which only produces skill proposals.

implementations:
  - src/index.ts:SpecShip.reflectCaptureLesson
  - src/reflect/sweep.ts:captureLesson
  - src/reflect/apply.ts:applyProposal

## Acceptance
<!-- id: REQ-MEMLESSON-001.A1 -->
- Capturing a lesson targeted at a memory note produces an open `memory_rule`
  proposal whose preview shows the note body plus the MEMORY.md index line apply
  would write — and writes nothing until applied.
<!-- id: REQ-MEMLESSON-001.A2 -->
- Capturing targeted at CLAUDE.md produces a `memory_rule` proposal whose preview
  shows the marked block apply would add to the project CLAUDE.md.
<!-- id: REQ-MEMLESSON-001.A3 -->
- Applying the proposal writes the rule to the chosen target so it loads next
  session, idempotently (a re-apply is unchanged).
<!-- id: REQ-MEMLESSON-001.A4 -->
- Re-capturing the same lesson converges to the same proposal, not a duplicate.
<!-- id: REQ-MEMLESSON-001.A5 -->
- Capturing with empty lesson content is refused with a usage message and writes
  nothing.

<!-- id: REQ-MEMLESSON-002 -->
## SpecShip MUST let a user review the stored memory items with their source

`specship memory list` lists the memory items in effect for the project — the
Claude Code memory notes and the SpecShip-applied marked rule blocks in
CLAUDE.md — each with its title/slug, a snippet, and its source (hand-authored
note vs SpecShip-applied rule). It is read-only and mutates nothing.

implementations:
  - server/src/routes/memory.ts:registerMemoryRoutes
  - src/index.ts:SpecShip.reflectList

## Acceptance
<!-- id: REQ-MEMLESSON-002.A1 -->
- The list shows each memory note (slug + one-line summary) and each
  SpecShip-applied CLAUDE.md rule block, labeled by source.
<!-- id: REQ-MEMLESSON-002.A2 -->
- An empty memory store is reported cleanly ("no memory items yet"), not an error.
<!-- id: REQ-MEMLESSON-002.A3 -->
- The list writes nothing.

<!-- id: REQ-MEMLESSON-003 -->
## SpecShip MUST let a user remove or update a stored memory item, previewed before writing

`specship memory remove` and `specship memory edit` remove a memory item (delete
a memory note and its MEMORY.md index line, or strip a SpecShip-applied marked
block from CLAUDE.md) or update its body, showing the exact before→after change
before writing. SpecShip-applied items reuse the engine's existing reversible
marker apply/undo; no separate trash store is introduced.

implementations:
  - src/index.ts:SpecShip.reflectUndo
  - src/reflect/apply.ts:undoProposal
  - src/reflect/apply.ts:applyProposal

## Acceptance
<!-- id: REQ-MEMLESSON-003.A1 -->
- Removing a SpecShip-applied memory rule strips exactly the marked block it added
  (and its index line for a note), leaving surrounding content intact.
<!-- id: REQ-MEMLESSON-003.A2 -->
- Updating a memory item shows a before→after diff and, on confirmation, writes
  only the changed body.
<!-- id: REQ-MEMLESSON-003.A3 -->
- Every remove/update previews the change before writing — nothing is mutated
  unseen.
<!-- id: REQ-MEMLESSON-003.A4 -->
- Removing or updating a non-existent item reports "not found" and writes nothing,
  never throws.
