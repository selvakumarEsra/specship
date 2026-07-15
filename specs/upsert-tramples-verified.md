---
id: STICKYLINK-DOC
title: Sticky link state survives spec re-extraction
owner: core
priority: high
version: 1
brief: upsert-tramples-verified/brief.md
---

<!-- id: STICKYLINK-DOC -->
# Sticky link state survives spec re-extraction

Editing any requirement in a spec file re-extracts the WHOLE file: every
requirement's `implementations:` declaration is re-applied, re-upserting each
link with `state: 'implemented'`. That silently tramples the sticky `verified`
/ `broken` state on sibling requirements whose own body never changed —
observed 2026-07-15 when adding REQ-JIRAPUB-009 to `specs/jira-publish.md`
demoted 13 verified links (verified count 22 → 11).

The re-upsert path (`applyDeclarationCandidates` → `upsertSpecLink`) has no
sticky-state awareness and no content-hash guard; the guard that does exist
(`markSpecDrifted`'s `STICKY_STATES` + unchanged-hash skip) runs AFTER the
trample and skips the already-reset links, so it never restores them.

The fix splits on the requirement's content hash: an UNCHANGED requirement must
keep its sticky link state across re-extraction, and a CHANGED requirement must
route its link through the normal spec-axis `drifted` transition rather than a
silent reset to `implemented`. This refines the sticky-state boundary — sticky
survives CODE-axis drift detection (DOM-SPECSHIP-001, unchanged) but a change to
the requirement's OWN text (spec axis) legitimately invalidates a human
verification.

<!-- id: REQ-STICKYLINK-001 -->
## Declaration re-upsert MUST preserve a sticky link state when the requirement is unchanged

When a spec file is re-extracted, re-applying a requirement's
`implementations:` declaration MUST NOT downgrade an existing `verified` or
`broken` link whose owning requirement's content hash is unchanged. The
re-upsert MAY still refresh the link's resolved node, provenance, confidence,
metadata, and `updated_at`, but its `state`, `drift_axis`, and
`spec_hash_at_link` are left untouched. The guard is scoped to sticky states —
a plain `implemented` link is not otherwise affected.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.applyDeclarationCandidates
  - src/db/spec-queries.ts:SpecQueries.upsertSpecLink

## Acceptance
<!-- id: REQ-STICKYLINK-001.A1 -->
- Given a file whose two requirements each carry a `verified` link, appending a
  third requirement and re-syncing leaves the first two links `verified` (the
  REQ-JIRAPUB-009 incident no longer reproduces).
<!-- id: REQ-STICKYLINK-001.A2 -->
- A `broken` link on an unchanged requirement likewise survives re-extraction
  as `broken`.
<!-- id: REQ-STICKYLINK-001.A3 -->
- After the preserving re-upsert the link's `resolved_node_id` and `updated_at`
  are still refreshed — only `state`, `drift_axis`, and `spec_hash_at_link`
  are protected.
<!-- id: REQ-STICKYLINK-001.A4 -->
- A plain `implemented` link on an unchanged requirement is unaffected: it
  stays `implemented` (the guard is not a blanket "never change state").

<!-- id: REQ-STICKYLINK-002 -->
## A changed requirement's sticky link MUST transition to drifted(spec), never a silent reset

When a requirement's own content hash HAS changed, its sticky link MUST NOT be
reset to `implemented`. It transitions directly to `drifted` with axis `spec`
— the normal spec-axis drift — and is recorded once as a drift transition for
the sync push notice. The link is never observed in an intermediate
`implemented` state during the re-extraction.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.markSpecDrifted
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.applyDeclarationCandidates

## Acceptance
<!-- id: REQ-STICKYLINK-002.A1 -->
- Editing a `verified` requirement's body transitions its link to `drifted`
  with axis `spec`, emitting exactly one drift transition.
<!-- id: REQ-STICKYLINK-002.A2 -->
- The changed link is never observed as `implemented`: it goes
  `verified → drifted(spec)` with no silent reset in between.
<!-- id: REQ-STICKYLINK-002.A3 -->
- A `broken` link whose requirement body changed likewise transitions to
  `drifted(spec)`.
<!-- id: REQ-STICKYLINK-002.A4 -->
- A link already `drifted` whose requirement changes again does not emit a
  second transition (existing drift-push once-only semantics hold).
<!-- id: REQ-STICKYLINK-002.A5 -->
- Code-axis drift detection during full resolution still preserves sticky
  states — this change is scoped to the spec axis and does not weaken
  DOM-SPECSHIP-001's code-axis guarantee.
