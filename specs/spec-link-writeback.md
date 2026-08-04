---
id: LINK-TRUTH-DOC
title: Spec-link write-back — the spec file is the source of truth
owner: specship
priority: high
---

<!-- id: LINK-TRUTH-DOC -->
# Spec-link write-back — the spec file is the source of truth

Links asserted via `specship_link_assert` live only in SQLite today and
vanish on a full `specship index` — the flagship traceability layer loses
state on a routine operation, and DB-only links are invisible to git (not
PR-reviewable, not clone-safe). Decision (2026-07-11 product review, Q5):
the assertion (spec ↔ symbol) belongs in the spec file; the DB holds only
derived state. Everything else in SpecShip already treats files as canonical
and SQLite as a projection — links stop being the exception.

<!-- id: REQ-LINKWB-001 -->
## `link_assert` MUST persist the assertion into the spec file

Asserting a link writes the target into the spec's `implementations:` block
(creating the block when absent), in the parser's `<path>:<qualified-symbol>`
form, idempotently — asserting an already-listed target changes nothing. The
DB row is created as today; the file write is what makes it durable.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkAssert
  - src/extraction/specs/spec-file-writeback.ts:addImplementationToSpecSource
  - src/extraction/specs/spec-file-writeback.ts:writeBackImplementation

## Acceptance
<!-- id: REQ-LINKWB-001.A1 -->
- After `link_assert(REQ-X, path:Symbol)`, the spec file's REQ-X section
  contains `- path:Symbol` under `implementations:`.
<!-- id: REQ-LINKWB-001.A2 -->
- Re-asserting the same link leaves the file byte-identical.
<!-- id: REQ-LINKWB-001.A3 -->
- Asserting into a REQ with no `implementations:` block creates the block
  in-place without disturbing surrounding content.

<!-- id: REQ-LINKWB-002 -->
## A full reindex MUST NOT lose any asserted link

Because every assertion lives in a spec file (or an `@implements` comment on
a symbol), rebuilding the index from scratch reconstructs the full link set.
Link identity is keyed on (spec id, target file, qualified name).

implementations:
  - src/extraction/specs/markdown-spec-extractor.ts:MarkdownSpecExtractor.extractLinkRefBlock

verifies:
  - __tests__/spec-extraction.test.ts

## Acceptance
<!-- id: REQ-LINKWB-002.A1 -->
- assert → full `specship index` → the link exists with the same identity
  and a resolvable target.
<!-- id: REQ-LINKWB-002.A2 -->
- Deleting the `implementations:` bullet and reindexing removes the link —
  the file edit is the way to retract an assertion.
<!-- id: REQ-LINKWB-002.A3 -->
- A non-`path:Symbol` bullet in the block — e.g. a bare-path pointer to a
  command markdown file — is skipped without terminating the block: every
  `path:Symbol` bullet after it still produces its link, regardless of
  bullet order.

<!-- id: REQ-LINKWB-003 -->
## Link state MUST remain derived, never authored in the file

`implemented` / `verified` / `drifted` / `broken` / `orphaned` and the
signature snapshots stay DB-only, recomputed against the current code on
sync. The file carries no state fields, so a reindex re-derives state
rather than trusting a stale claim. Sticky states (`verified`, `broken`)
surviving reindex is governed by their evidence, not by file text.
[needs review: exact recompute of `verified` across reindex interacts with
VERIFY-EVID-DOC — a verified link whose evidence still passes stays
verified.]

## Acceptance
<!-- id: REQ-LINKWB-003.A1 -->
- No state keyword written into a spec file changes a link's state.
