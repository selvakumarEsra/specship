---
id: WORKFLOW-DOORS-DOC
title: Consolidate the command surface into a few progressive doors
owner: core
priority: medium
version: 1
---

<!-- id: WORKFLOW-DOORS-DOC -->
# Workflow doors

SpecShip ships ~17 `ss-*` slash commands. They clutter Claude Code's
autocomplete and force the user to remember which command to use when, and the
spec loop in particular is spread across many discrete ceremonies
(brainstorm → author → review → implement → behaviour → triage…). That breadth
is friction — especially for the solo dev the wedge targets.

This consolidates the surface into a small number of **progressive doors** —
one obvious entry per phase, with the full ceremony available as depth inside the
door rather than as separate commands — and adds a **fast-path** so recording
intent and implementing doesn't require the full interview. No capability is
removed; the existing flows become reachable through fewer, clearer doors. This
interacts with the install-tier split (see INSTALL-WEDGE-DOC): the doors are
classified into the retrieval tier vs the governance tier.

<!-- id: REQ-DOORS-001 -->
## The slash-command surface MUST consolidate into a few progressive doors

The command palette is reduced to a small set of doors — broadly one for reads
(explore/impact/trace), one for the intent loop (author → implement → verify),
and one for the gate/review — instead of a long flat list, with sub-behaviours
selected inside a door.

implementations:
- src/installer/targets/claude.ts:writeCommandsEntries

## Acceptance
<!-- id: REQ-DOORS-001.A1 -->
- The shipped command set is reduced to a small number of top-level doors; the
  prior discrete commands' capabilities are all reachable through them.
<!-- id: REQ-DOORS-001.A2 -->
- Each door states, on invocation with no/partial arguments, the sub-actions it
  offers — it is self-describing rather than relying on the user to recall flags.
<!-- id: REQ-DOORS-001.A3 -->
- No capability present in the prior command set is lost in the consolidation.

<!-- id: REQ-DOORS-002 -->
## The intent loop MUST offer a fast-path that skips the full interview

A solo developer can record intent and move to implementation without the
brainstorm and gap-question interview, while the full guided ceremony remains
available for those who want the rigor.

## Acceptance
<!-- id: REQ-DOORS-002.A1 -->
- A fast-path records a requirement and proceeds toward implementation in a
  single guided step, without the multi-question brainstorm/gap-fill interview.
<!-- id: REQ-DOORS-002.A2 -->
- The full ceremony (brainstorm → author → review) is still reachable for users
  who opt into it.
<!-- id: REQ-DOORS-002.A3 -->
- The fast-path still produces a well-formed spec that indexes cleanly and is
  ready for implementation and linking — speed does not sacrifice correctness.

<!-- id: REQ-DOORS-003 -->
## Consolidation MUST be backward-compatible for existing users

A user who already has the old commands installed is not broken by the
consolidation — the old invocations either continue to work or are cleanly
superseded with a pointer to the new door.

implementations:
- src/installer/targets/claude.ts:cleanupLegacyCommandsEntries

## Acceptance
<!-- id: REQ-DOORS-003.A1 -->
- On upgrade, an existing install's removed/renamed commands are cleaned up the
  way legacy commands already are, leaving no dangling duplicates in autocomplete.
<!-- id: REQ-DOORS-003.A2 -->
- The installer's command inventory and its install/uninstall tests are updated
  so the new door set is the contract under test.
