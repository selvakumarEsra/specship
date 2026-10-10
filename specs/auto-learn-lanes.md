---
id: ALEARN-DOC
title: Auto-learn lanes — style conventions + business/domain facts from real sessions
owner: specship-core
priority: high
version: 1
depends_on: REFLECT-DOC
---

<!-- id: ALEARN-DOC -->
# Auto-learn lanes

Port of the autoharness idea (self-learning layer: sessions → propose → validate
→ land → surface at session start) onto SpecShip's existing reflection engine
(REFLECT-DOC), scoped to the two lanes the user asked for: **code-style
conventions** and **business/product (domain) knowledge**. The reflection
engine already has the architecture autoharness proves out — deterministic
miners propose, a human gates (preview → apply), deterministic code writes,
undo exists — so these lanes are new proposal types and targets, not a new
system.

Ratified design decisions (2026-10-11): conventions land in a
**SpecShip-managed file** (`.specship/conventions.md`) injected at session
start — CLAUDE.md is never edited; distillation is **deterministic miners +
explicit `/specship:learn` capture** — no LLM on the automatic path; the
automatic sweep is **on by default**, guarded and cheap, opt-out in config.

Non-goals: an LLM reflector subagent (future lane, not v1); autoharness's
skill-library lifecycle (usage counters, archiving, curator) — SpecShip's
proposal states + dismiss cover retirement; a global (cross-project) layer;
editing CLAUDE.md, user skills, or anything SpecShip did not write itself;
auto-landing domain facts (DOM-SPECSHIP-003 stands: the human's preview→apply
IS the confirmation, and nothing reaches `specs/domain/` without it).

<!-- id: REQ-ALEARN-001 -->
## The reflection engine MUST learn code-style conventions as a dedicated proposal lane

A recurring style correction in real sessions ("stop using default exports",
"use our logger, not console.log", "match the repo's comment density") is a
durable convention the next session should start already knowing. The engine
MUST support a `style_rule` proposal type with a `conventions` target:

- **Mined**: a deterministic detector over ingested transcripts flags
  recurring user corrections whose text matches style vocabulary (naming,
  imports, formatting, comments, logging, error-handling phrasing) — same
  shape as the existing recurring-correction detector, classified into the
  style lane. Below the recurrence threshold, silence (silent beats wrong).
- **Captured**: `/specship:learn style <rule>` stages one explicitly, same
  store, same human gate.
- **Applied**: the human's preview→apply appends the rule to
  `.specship/conventions.md` — a file SpecShip owns outright. Apply is
  idempotent and undo removes exactly the applied block, like every other
  reflect target. CLAUDE.md and user files are never touched.

## Acceptance
<!-- id: REQ-ALEARN-001.A1 -->
- A transcript corpus with the same style correction recurring in 2+ sessions
  yields exactly one open `style_rule` proposal naming the rule and carrying
  the session ids as evidence; a corpus without recurring style corrections
  yields none.
<!-- id: REQ-ALEARN-001.A2 -->
- Applying a `style_rule` proposal writes the rule into
  `.specship/conventions.md` under a managed marker block; applying twice is
  `unchanged`; undo removes the block and restores the prior content
  byte-for-byte.
<!-- id: REQ-ALEARN-001.A3 -->
- No code path in the lane writes to CLAUDE.md or to any file outside
  `.specship/` for a `style_rule` proposal.

<!-- id: REQ-ALEARN-002 -->
## Confirmed conventions MUST be injected at session start

A convention nobody re-reads is dead. The `specship cheatsheet` SessionStart
surface MUST append the project's confirmed conventions (the rules in
`.specship/conventions.md`) so every session opens already steering by them —
autoharness's session-start index, scoped to this one file.

Budget-bounded: at most a configurable number of lines/characters (sane
default), oldest truncated last with an explicit "+N more — see
.specship/conventions.md" line. Absent or empty file → nothing is injected
and the cheatsheet is byte-identical to today. `SPECSHIP_NO_CHEATSHEET`
suppresses it along with the rest of the cheatsheet.

## Acceptance
<!-- id: REQ-ALEARN-002.A1 -->
- With `.specship/conventions.md` present, the cheatsheet output contains a
  conventions section listing each rule; with the file absent or empty, the
  output is byte-identical to the current cheatsheet.
<!-- id: REQ-ALEARN-002.A2 -->
- With more rules than the budget, the section shows the budgeted subset plus
  a "+N more" pointer line — never an unbounded dump.

<!-- id: REQ-ALEARN-003 -->
## The reflection engine MUST draft business/domain facts as a human-gated lane

The domain layer already detects undocumented entities (`specship
domain-gaps`), and DOM-SPECSHIP-003 ratifies the model-proposes/human-approves
queue. This lane wires the two together with a `domain_fact` proposal type:

- **Mined**: a deterministic detector cross-references the domain-gap seed
  (undocumented high-traffic entities) with session evidence (the entity's
  name recurring in this project's prompts), staging a DRAFT fact proposal
  whose content is a well-formed `specs/domain/` fact skeleton (frontmatter
  `id: DOM-<AREA>-NNN`, `type:`, body) for the human to review and edit.
- **Captured**: `/specship:learn domain <fact>` stages one explicitly — the
  business/product knowledge the user just explained in-session.
- **Applied**: the human's preview→apply writes the fact file under
  `specs/domain/` and triggers a spec sync — apply IS the DOM-SPECSHIP-003
  confirmation. No code path lands a domain fact without it. Undo removes the
  file.

## Acceptance
<!-- id: REQ-ALEARN-003.A1 -->
- An undocumented entity that appears in the domain-gap seed AND recurs in the
  project's session prompts yields one open `domain_fact` proposal whose
  content parses as a valid domain fact file; entities failing either
  condition yield none.
<!-- id: REQ-ALEARN-003.A2 -->
- Applying a `domain_fact` proposal creates the fact file under `specs/domain/`
  with a collision-checked `DOM-` id; the fact indexes on the next sync; undo
  deletes the file. Dismiss leaves the filesystem untouched.
<!-- id: REQ-ALEARN-003.A3 -->
- There is no code path that writes under `specs/domain/` from mining, sweep,
  or sync — only the apply of a human-previewed proposal does.

<!-- id: REQ-ALEARN-004 -->
## The learning sweep MUST run automatically, bounded and opt-out

Autoharness's defining trait is firing on its own. SpecShip's sweep
(`reflectSweep`) currently runs on demand. It MUST additionally run as part of
`specship sync`, guarded so it stays invisible: at most once per cooldown
window (default 6 h, persisted timestamp), skipped entirely when transcript
ingest is disabled or the analytics tables are absent, and opt-out via
`specship.config.json` → `reflect.autoSweep: false`.

When open learned proposals exist, the session-start cheatsheet MUST say so in
one line ("N learned proposals awaiting review — specship reflect / dashboard
Improvements") so the queue is discovered without the dashboard open. Zero
open proposals → no line.

## Acceptance
<!-- id: REQ-ALEARN-004.A1 -->
- Two syncs inside the cooldown window run the sweep at most once; a sync
  after the window runs it again. With `reflect.autoSweep: false`, sync never
  sweeps.
<!-- id: REQ-ALEARN-004.A2 -->
- The cheatsheet shows the open-proposal count line when the count is > 0 and
  omits it (byte-identical output) when it is 0 or the store is unavailable.
<!-- id: REQ-ALEARN-004.A3 -->
- The auto-sweep never blocks or fails a sync: any sweep error is swallowed
  into a debug-level note and the sync result is unchanged.
