---
id: WORKFLOW-DOORS-DOC
title: Consolidate the command surface into a few progressive doors
owner: core
priority: medium
version: 3
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

<!-- id: REQ-DOORS-004 -->
## The intent door MUST offer a design sub-route for visually expressed intent

A design is intent expressed visually rather than as text, so it enters through
the intent door as a third authoring modality alongside `new` (interview) and
`fast` (no interview): `/specship:spec design <URL | intent>`. Routing is by
argument shape — a `claude.ai/design` URL takes the import path (snapshot →
tokens → draft spec → gap-fill gate → implement hand-off), a `figma.com` URL
takes the Figma import path via the remote Figma MCP, and no URL runs the taste
loop first and feeds its bundle into the same import path. The standalone
`design-implement` / `design-loop` commands are retired. The door's dispatch
entry stays thin by delegating to the bundled workflow and the `designer-loop`
skill rather than inlining either flow.

implementations:
- src/installer/targets/claude.ts:writeCommandsEntries
- src/installer/targets/claude.ts:cleanupLegacyCommandsEntries

## Acceptance
<!-- id: REQ-DOORS-004.A1 -->
- `/specship:spec design` with a `claude.ai/design` URL runs the import path
  end-to-end and hands off to `implement` — the same outcome the retired
  `design-implement` command produced.
<!-- id: REQ-DOORS-004.A2 -->
- With a `figma.com` URL it routes to the Figma import path; when the Figma MCP
  is not installed it instructs the user to run
  `claude mcp add --transport http figma https://mcp.figma.com/mcp` and stops —
  it never falls back to a blind fetch.
<!-- id: REQ-DOORS-004.A3 -->
- With no URL it runs the taste loop (designer MCP, human "that's it" gate)
  first, then feeds the handoff bundle into the same import path.
<!-- id: REQ-DOORS-004.A4 -->
- The `design-implement` and `design-loop` command files are retired via the
  legacy-command cleanup on upgrade, leaving no dangling autocomplete entries,
  and the dashboard's Intent tile lists `design` among its sub-routes.

<!-- id: REQ-DOORS-005 -->
## The intent door MUST disambiguate free-text input rather than fall through

Input that is not empty, not a spec ID, and not a known sub-route verb is
currently undefined. The door instead asks one clarifying question — new, fast,
or triage — leading with a recommendation inferred from the input's shape.

## Acceptance
<!-- id: REQ-DOORS-005.A1 -->
- Free text that is neither a spec ID nor a sub-route verb triggers a single
  clarifying question offering `new`, `fast`, and `triage` — never undefined
  behaviour.
<!-- id: REQ-DOORS-005.A2 -->
- The question leads with an inferred recommendation: error-log-shaped input
  recommends `triage`; feature-shaped input recommends `new` or `fast`.
<!-- id: REQ-DOORS-005.A3 -->
- The existing no-argument (lifecycle funnel) and bare-spec-ID (detail) dispatch
  behaviours are unchanged.

<!-- id: REQ-DOORS-006 -->
## No spec MUST reach disk unreviewed

Every authoring path through the intent door — `new`, `fast`, and `design` —
ends with the same machine rubric pass after the file is written and synced,
so the review backstop is a single uniform invariant rather than a per-path
policy. The standalone `review <SPEC_ID>` route remains for auditing existing
or hand-written specs.

## Acceptance
<!-- id: REQ-DOORS-006.A1 -->
- After any authoring path writes and syncs a spec, the same rubric pass
  (structural / quality / hygiene) runs automatically.
<!-- id: REQ-DOORS-006.A2 -->
- Structural findings are fixed automatically; quality findings that would
  change implementation behaviour surface as a single proceed/adjust prompt —
  no additional interview.
<!-- id: REQ-DOORS-006.A3 -->
- The fast-path keeps its single-guided-step feel with the pass included, so
  REQ-DOORS-002.A3's "speed does not sacrifice correctness" is enforced rather
  than aspirational.

<!-- id: REQ-DOORS-007 -->
## Door hand-offs MUST NOT leave plan mode gating the write or the implementation

In SpecShip's model the spec IS the plan: by the time the user reaches
`implement`, intent has been authored, reviewed, and human-gated, and the
`spec-implement` workflow carries its own plan → approve gate inside an
isolated worktree. Claude Code's plan mode stacked on top is a redundant third
planning layer — and a mechanical blocker: it refuses the mutating
`specship workflow run` launch and the authoring paths' final spec `Write`.
Plan mode remains appropriate for the authoring *conversation* (the diverge
phase is read-only exploration); the doors instruct the agent to exit it at
the confirmation boundary, not to avoid it wholesale.

## Acceptance
<!-- id: REQ-DOORS-007.A1 -->
- The `implement` dispatch instructs the agent: when the session is in plan
  mode, exit it first (presenting the spec plus the workflow's own gates as
  the plan) before running `specship workflow run spec-implement` — never
  attempt the launch while plan mode blocks Bash.
<!-- id: REQ-DOORS-007.A2 -->
- The authoring paths (`new`, `fast`, `design`) instruct the same at the
  confirmed-write step: exit plan mode before `Write`-ing the spec file,
  since the human's confirmation in the flow is the approval plan mode was
  waiting for.
<!-- id: REQ-DOORS-007.A3 -->
- The guidance does not forbid plan mode for the authoring conversation
  itself — the exit happens at the write/hand-off boundary only.

<!-- id: REQ-DOORS-008 -->
## The intent door MUST offer a `list` sub-route inventorying every spec

The no-argument funnel answers pipeline health with rollup counts; nothing at
the door answers "what specs do we have, and where does each stand".
`/specship:spec list` resolves the full inventory — idea briefs, then every
document's requirements, each with one derived lifecycle status
(`authored · in-progress · implemented · verified · needs-attention`) — in a
single list-mode `specship_spec` call. REQ-FUNNEL-007 owns the list surface
and the status derivation; the door's dispatch entry stays thin — one call,
render, no fallback exploration.

implementations:
  - packages/web-ng/src/app/pages/dashboard/dashboard.ts:Dashboard

## Acceptance
<!-- id: REQ-DOORS-008.A1 -->
- `/specship:spec list` is a dispatch route in the intent door: it produces
  the grouped inventory (idea briefs + documents with per-requirement
  statuses and closing totals) from a single list-mode `specship_spec` call —
  no per-spec follow-up calls, no file reading.
<!-- id: REQ-DOORS-008.A2 -->
- `list` is a known sub-route verb: the free-text disambiguation
  (REQ-DOORS-005) does not trigger on it, and the no-argument funnel and
  every other dispatch behaviour are unchanged.
<!-- id: REQ-DOORS-008.A3 -->
- The dashboard's Intent tile lists `list` among its sub-routes.
