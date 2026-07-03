---
id: SPEC-FUNNEL-DOC
title: Spec lifecycle funnel
owner: core
priority: medium
brief: spec-lifecycle-funnel/brief.md
---

<!-- id: SPEC-FUNNEL-DOC -->
# Spec lifecycle funnel

The spec-driven pipeline runs **idea → spec → implemented**: `/ss-brainstorm`
writes a brainstorm brief (`specs/<slug>/brief.md`), `/ss-spec-author` turns it
into a spec, and `/ss-implement` links code to it. Today only the spec and
implemented stages are queryable — brainstormed ideas (briefs) live on disk and
are invisible to the graph, and there is no inventory or funnel view (only
`specship drifted`, which shows the problem queue).

This document makes briefs first-class graph citizens and exposes the full
funnel — how many ideas exist, how many became specs, and how many requirements
are implemented vs verified — across the CLI, the `specship_spec` MCP tool, and
the desktop specs page. Briefs are **read-only in the graph**: indexed for
query, never authored through it. The brief-writing format owned by
`/ss-brainstorm` is unchanged.

<!-- id: REQ-FUNNEL-001 -->
## The indexer MUST index brief files as first-class `brief` spec nodes

The indexer MUST discover brief files anywhere under the specs root — including
nested `specs/<slug>/` directories — and represent each as a first-class spec
entity of a new `brief` kind, addressable by a stable id derived from the brief.
The brief's full prose body MUST be stored and full-text searchable alongside
other specs. Indexing a brief MUST NOT require the requirement-marker structure
that real specs use, and MUST NOT change how document / requirement / acceptance
specs are extracted. A brief with absent or malformed frontmatter MUST be
skipped without failing the indexing of valid spec files.

## Acceptance
<!-- id: REQ-FUNNEL-001.A1 -->
- After indexing, a `specs/<slug>/brief.md` is present as a `brief`-kind spec, retrievable by id and included when listing all specs.
<!-- id: REQ-FUNNEL-001.A2 -->
- A term that appears only in the brief's prose body matches the brief via full-text spec search (the body is indexed, not just the title).
<!-- id: REQ-FUNNEL-001.A3 -->
- A brief file in a nested subdirectory under the specs root is discovered (discovery is not limited to top-level spec files).
<!-- id: REQ-FUNNEL-001.A4 -->
- A brief file with missing or invalid frontmatter is skipped, and indexing of the project's valid spec files still completes without error.
<!-- id: REQ-FUNNEL-001.A5 -->
- Extraction of existing document / requirement / acceptance specs is byte-for-byte unchanged by brief indexing (same spec ids and node projections as before this feature).

<!-- id: REQ-FUNNEL-002 -->
## A brief MUST be linked to its spec by reconciling both pointer directions

A brief MUST be linked to the spec it produced by reconciling pointers from BOTH
directions: the brief's own `spec:` reference (which MAY name a requirement, in
which case it resolves up to that requirement's parent document) and the spec
document's `brief:` reference. A link MUST be established when either direction
resolves. A brief with no resolvable spec in either direction MUST be treated as
an unlinked **idea**. When the two directions disagree — each points somewhere,
but not at each other — the discrepancy MUST surface as a drift-style warning
rather than a silent choice or a hard failure.

## Acceptance
<!-- id: REQ-FUNNEL-002.A1 -->
- A brief whose `spec:` resolves (directly, or via a requirement → parent-document walk) is linked to that spec, and the link is queryable from both the brief and the spec.
<!-- id: REQ-FUNNEL-002.A2 -->
- A spec document whose `brief:` resolves is linked to that brief even when the brief's own `spec:` is unset.
<!-- id: REQ-FUNNEL-002.A3 -->
- A brief with no resolvable spec in either direction is reported as an unlinked idea — not dropped, not an error.
<!-- id: REQ-FUNNEL-002.A4 -->
- When the brief's `spec:` and the spec's `brief:` resolve to different targets, a drift-style warning is surfaced; the link is not silently resolved to one side.
<!-- id: REQ-FUNNEL-002.A5 -->
- A brief linked to a requirement inside a multi-requirement document is attributed to that document without claiming its sibling requirements.

<!-- id: REQ-FUNNEL-003 -->
## Each brief MUST report a lifecycle state rolled up from its spec's links

Each brief MUST report a lifecycle state derived from its link state and the
implementation state of the spec it links to: an unlinked brief is `idea`; a
linked brief whose spec has no implemented requirement links is `specified`; and
a linked brief MUST further reflect the rolled-up implementation status of its
spec's requirements, reusing the existing spec → code link states. The rollup
MUST keep "implemented" (a declared link to existing code) distinct from
"verified" (a test-confirmed link).

The rollup walks the document → its requirements, so it MUST NOT count the
document itself among its requirements. [needs review] This depends on the
document-node projection fix: the extractor currently mis-types every document
as a `requirement` and self-parents it, so a naive doc→requirements walk returns
the document as its own child. Either land that fix first, or have this rollup
defensively exclude the parent document's own id from its requirement set. (Spec
for the extractor fix: ID TBD — link once authored.)

## Acceptance
<!-- id: REQ-FUNNEL-003.A1 -->
- An unlinked brief reports state `idea`.
<!-- id: REQ-FUNNEL-003.A2 -->
- A brief linked to a spec that has zero implemented requirement links reports state `specified`.
<!-- id: REQ-FUNNEL-003.A3 -->
- A brief linked to a spec reports a rollup of that spec's requirements by link-state (counts of implemented / verified / drifted).
<!-- id: REQ-FUNNEL-003.A4 -->
- The rollup reports "implemented" (declared) separately from "verified" (test-confirmed) — the two are not collapsed into a single count.
<!-- id: REQ-FUNNEL-003.A5 -->
- A brief linked to a spec whose code links are all drifted, broken, or orphaned does NOT report "implemented"; it surfaces the degraded link states so a stale or broken implementation is not mistaken for a working one.

<!-- id: REQ-FUNNEL-004 -->
## The CLI MUST expose the lifecycle funnel

The CLI MUST provide a command that lists the spec inventory with the
idea → spec → implemented funnel: a summary of how many ideas exist, how many
became specs, and how many requirements are implemented vs verified, plus a
per-spec breakdown rolled up by link-state. It MUST offer machine-readable
output. Given a spec or brief id, it MUST show that single entity's detail.

## Acceptance
<!-- id: REQ-FUNNEL-004.A1 -->
- Run with no argument, the command prints a funnel summary (idea / specified / implemented / verified counts) and a per-spec listing.
<!-- id: REQ-FUNNEL-004.A2 -->
- The listing includes idea-state briefs (briefs not yet linked to a spec).
<!-- id: REQ-FUNNEL-004.A3 -->
- A machine-readable (`--json`) flag emits the same data structured for tooling.
<!-- id: REQ-FUNNEL-004.A4 -->
- Invoked with a spec or brief id, the command prints that entity's detail (its links and state).
<!-- id: REQ-FUNNEL-004.A5 -->
- Run in a project with no specs or briefs, the command reports an empty funnel cleanly — no error, no crash.

<!-- id: REQ-FUNNEL-005 -->
## `specship_spec` MUST return the funnel when called without an id

The `specship_spec` MCP tool, invoked WITHOUT a specific spec id, MUST return the
lifecycle funnel (idea-state briefs, specs, and the implementation rollup) so an
agent can survey the pipeline through a tool it already uses. Invoked WITH an id,
it MUST retain its current single-spec behavior unchanged.

## Acceptance
<!-- id: REQ-FUNNEL-005.A1 -->
- `specship_spec` with no id returns the funnel: idea-state briefs, specs, and the implementation rollup.
<!-- id: REQ-FUNNEL-005.A2 -->
- `specship_spec` with an id returns that spec's detail exactly as it does today (no behavior change for the id case).
<!-- id: REQ-FUNNEL-005.A3 -->
- With no id in a project that contains no specs, it returns an empty funnel rather than an error.

<!-- id: REQ-FUNNEL-006 -->
## The web specs page MUST show the funnel including idea-state briefs

The desktop dashboard's specs page MUST present the lifecycle funnel and MUST
render idea-state briefs (briefs not yet linked to a spec) alongside specs, so a
human can see brainstormed ideas that have not yet become specs and follow each
through to its implementation state.

## Acceptance
<!-- id: REQ-FUNNEL-006.A1 -->
- The specs page shows a funnel overview (ideas → specs → implemented / verified).
<!-- id: REQ-FUNNEL-006.A2 -->
- Idea-state briefs appear on the page, visibly distinguished from specs.
<!-- id: REQ-FUNNEL-006.A3 -->
- Selecting a brief shows its content and its linked spec, if any.
<!-- id: REQ-FUNNEL-006.A4 -->
- When the server is unreachable, the funnel degrades per OFFLINE-DOC — it is served from the shared client cache (marked stale, like every other surface) rather than crashing on the new funnel data.

<!-- id: REQ-FUNNEL-007 -->
## `specship_spec` MUST provide a list mode with one derived status per spec

The funnel answers "how healthy is the pipeline" with rollup counts; nothing
answers "what specs exist and where does each stand" in one call. Invoked with
`list: true`, `specship_spec` MUST return the full inventory — idea briefs,
then each document grouped with its requirements — where every requirement
carries exactly ONE derived lifecycle status, so the intent door's `list`
sub-route resolves in a single call. The status vocabulary is
`authored · in-progress · implemented · verified · needs-attention`, keeping
implemented distinct from verified (REQ-FUNNEL-003.A4's rule) and never letting
a degraded link read as done. A status is derived from the links attached to
the requirement and to its acceptance criteria.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipSpec

## Acceptance
<!-- id: REQ-FUNNEL-007.A1 -->
- Called with `list: true`, the tool returns every document grouped with its requirements — each requirement labelled with exactly one status from the vocabulary — and closes with per-status totals.
<!-- id: REQ-FUNNEL-007.A2 -->
- A requirement with any link in `drifted`, `broken`, or `orphaned` (on itself or an acceptance criterion) reports `needs-attention` with the degraded state named, regardless of its other links.
<!-- id: REQ-FUNNEL-007.A3 -->
- A requirement whose links are all `verified` (at least one) reports `verified`; a mix of `implemented` and `verified` links reports `implemented` — completion is never overstated.
<!-- id: REQ-FUNNEL-007.A4 -->
- A requirement with no links reports `authored`; one whose links are only `drafted`/`implementing` reports `in-progress`.
<!-- id: REQ-FUNNEL-007.A5 -->
- Unlinked briefs appear as `idea` entries, visibly distinct from documents and requirements.
<!-- id: REQ-FUNNEL-007.A6 -->
- In a project with no specs or briefs, list mode returns a clean empty listing — not an error.
<!-- id: REQ-FUNNEL-007.A7 -->
- The existing modes — the no-arg funnel, `spec_id` detail, `behaviour_surface`, and free-text `query` — are unchanged; list mode is additive.
