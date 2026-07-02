---
id: TRIAGE-DOC
title: Spec triage — route a change to the right existing spec
owner: core
priority: high
version: 2
brief: spec-triage/brief.md
---

<!-- id: TRIAGE-DOC -->
# Spec triage

A front door for small changes. When a user has a bug to fix, an error log, or a
one-line enhancement, this flow finds the **existing** spec the change belongs to
and **adds to it** — appending a new requirement or a new acceptance criterion —
rather than spawning a fresh spec, and only falls back to authoring a new spec
when nothing fits.

The shape is a deterministic **retrieval primitive** plus an orchestrating
**`/ss-triage` skill** (the agent matches + authors, the human gates). It reuses
the existing spec FTS index (`specs_fts`), the code→spec reverse path
(`specship_node` already surfaces a symbol's linked specs), the `spec-author`
append path, and `link_assert` for post-implement linking. It is distinct from
`/ss-fix`, which repairs a drifted/broken link for a known spec.

<!-- id: REQ-TRIAGE-001 -->
## specship_spec MUST support a query mode that returns scored, ranked existing specs

`specship_spec` gains a third mode: given a free-text `query`, it returns the
existing specs that best match it, scored and ranked over the spec full-text
index. Its existing modes are unchanged.

implementations:
- src/mcp/spec-tools.ts:buildSpecSearch
- src/mcp/spec-tools.ts:handleSpecshipSpec

## Acceptance
<!-- id: REQ-TRIAGE-001.A1 -->
- Called with a `query` argument, `specship_spec` returns candidate specs ranked
  by relevance, each with its id, title, kind, a relevance **score**, and a
  matched snippet — enough to act on without a follow-up fetch.
<!-- id: REQ-TRIAGE-001.A2 -->
- The existing modes are unchanged: no argument still returns the lifecycle
  funnel, and a `spec_id` still returns that spec's detail.
<!-- id: REQ-TRIAGE-001.A3 -->
- A query against an empty / spec-less index returns an explicit "no specs to
  search" result, not an error.

<!-- id: REQ-TRIAGE-002 -->
## The /ss-triage flow MUST classify a change prompt and present ranked candidate specs

`/ss-triage <prompt>` classifies the input as a bug, error log, or enhancement,
retrieves candidate specs by the appropriate path, and presents a ranked match
with a recommended action — before any write.

## Acceptance
<!-- id: REQ-TRIAGE-002.A1 -->
- A prose prompt (enhancement or bug description) retrieves candidates via the
  `specship_spec` query mode and presents them ranked with a recommended target.
<!-- id: REQ-TRIAGE-002.A2 -->
- An error-log prompt has its `file:line` / symbol extracted from the trace and
  is routed via the code→spec path (explore → the node's linked specs) to the
  owning requirement.
<!-- id: REQ-TRIAGE-002.A3 -->
- The flow states the detected input class (bug / error log / enhancement) and
  the recommended target (which document or requirement) before proposing any
  change.
<!-- id: REQ-TRIAGE-002.A4 -->
- When several candidates score closely, the flow presents the top N for the
  human to choose and never auto-selects among them.

<!-- id: REQ-TRIAGE-003 -->
## A matched change MUST be previewed and confirmed before it is appended

On a confident match the flow shows the exact change it will make and writes it
only after explicit confirmation, choosing a new requirement or a new acceptance
criterion by intent, with an auto-derived id.

## Acceptance
<!-- id: REQ-TRIAGE-003.A1 -->
- Before writing, the flow shows the exact diff — the target spec file and the
  new requirement or `.A<N>` criterion block to be inserted — and writes only
  after explicit confirmation; `edit`, `new spec instead`, and `cancel` are also
  offered.
<!-- id: REQ-TRIAGE-003.A2 -->
- A distinct new concern is appended as a new requirement under the matched
  document; a bug/regression an existing requirement should have covered is
  appended as a new acceptance criterion on that requirement, leaving that
  requirement's existing code links intact.
<!-- id: REQ-TRIAGE-003.A3 -->
- The id is auto-derived as the next in series and collision-checked against the
  index: a new requirement becomes the next `REQ-<AREA>-<NNN>`; a new criterion
  becomes the next `REQ-<ID>.A<N>`.
<!-- id: REQ-TRIAGE-003.A4 -->
- The appended requirement / criterion carries a valid, unique `<!-- id: -->`
  marker and indexes without a spec error (`specship sync` reports clean), ready
  for `/ss-implement` and `link_assert`.

<!-- id: REQ-TRIAGE-004 -->
## A no-confident-match MUST offer a new spec rather than auto-create one

When no candidate clears the match floor, the flow declines to extend a spec on
its own and offers the human a choice instead.

## Acceptance
<!-- id: REQ-TRIAGE-004.A1 -->
- When the top candidate's score is below the configured match floor, the flow
  states "no confident match" and shows the weak candidates with their scores.
<!-- id: REQ-TRIAGE-004.A2 -->
- It offers to route to `/ss-spec-author` (or `/ss-brainstorm`), to append anyway
  to the top weak candidate, or to cancel.
<!-- id: REQ-TRIAGE-004.A3 -->
- It never creates a new spec without an explicit human choice.

<!-- id: REQ-TRIAGE-005 -->
## Triage MUST be the single intake for failures and route drift to the gate door

The user standing at the doors cannot tell whether their failing behaviour is a
"bug" (intent-door taxonomy) or "drift" (gate-door taxonomy) — that distinction
is SpecShip's, not theirs. So triage becomes the universal intake: after
matching the owning spec it consults the drift queue, and when the match's
links are drifted or broken it routes to the gate door's fix flow instead of
appending a criterion to a spec whose real problem is a stale link. The gate
door reciprocates: free text that is not a spec ID routes back to triage. The
user-facing rule collapses to one sentence — anything broken goes in through
triage; triage decides if it's drift.

## Acceptance
<!-- id: REQ-TRIAGE-005.A1 -->
- After matching an owning spec, triage consults the drift queue; when the
  matched spec has links in the `drifted` or `broken` state, the recommended
  action is the gate door's fix flow for that spec ID, not an appended
  requirement or criterion.
<!-- id: REQ-TRIAGE-005.A2 -->
- The gate door invoked with a free-text argument that is not a spec ID routes
  the text to triage rather than failing or behaving undefined.
<!-- id: REQ-TRIAGE-005.A3 -->
- When the matched spec's links are healthy, the existing preview-and-confirm
  append flow (REQ-TRIAGE-003) is unchanged.
