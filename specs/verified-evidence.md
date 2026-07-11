---
id: VERIFY-EVID-DOC
title: Evidence-based verified state
owner: specship
priority: high
---

<!-- id: VERIFY-EVID-DOC -->
# Evidence-based verified state

`verified` is the strongest word in the link-state machine, but the
spec-verify workflow currently promotes **every** `implemented` link when the
global test suite is green — a spec with zero tests touching it turns green
alongside everything else, and on a red suite the agent must guess which
specs the failures belong to. Decision (2026-07-11 product review, Q6): a
state may only render what it can prove. `verified` requires named, passing
test evidence linked to the spec. This is the test-side twin of
LINK-TRUTH-DOC's `implementations:` write-back.

<!-- id: REQ-VEVID-001 -->
## Test evidence MUST be declarable and indexed as links

A spec declares its evidence in a `verifies:` block (same syntax as
`implementations:` — `<test-file>:<test-symbol>`), and a test declares the
spec it evidences with an `@verifies REQ-X` comment on the test symbol.
Either form indexes as a test→spec link, rebuilt from files on every index
(reindex-proof per LINK-TRUTH-DOC).

implementations:
  - src/extraction/specs/markdown-spec-extractor.ts:MarkdownSpecExtractor.extractLinkRefBlock
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.applyCodeCommentLinks
  - src/extraction/tree-sitter-helpers.ts:getPrecedingDocstring

## Acceptance
<!-- id: REQ-VEVID-001.A1 -->
- A `verifies:` block bullet produces a queryable test-evidence link for the
  enclosing REQ.
<!-- id: REQ-VEVID-001.A2 -->
- An `@verifies REQ-X` comment on a test function produces the same link.
<!-- id: REQ-VEVID-001.A3 -->
- Evidence links survive a full reindex.

<!-- id: REQ-VEVID-002 -->
## Promotion to `verified` MUST require passing linked evidence

`link_verify(result: "pass")` promotes a link to `verified` only when the
spec has at least one evidence link whose test passed in the run being
reported. A spec with no evidence links caps at `implemented` and MUST NOT
be blanket-promoted by a green suite. The spec-verify workflow promotes
per-spec from evidence, not per-suite from exit code.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify
  - server/src/routes/spec.ts:registerSpecRoutes

## Acceptance
<!-- id: REQ-VEVID-002.A1 -->
- A green suite run promotes only specs with passing evidence links; an
  evidence-less `implemented` link keeps its state.
<!-- id: REQ-VEVID-002.A2 -->
- `link_verify(pass)` on an evidence-less spec is rejected with a reason
  naming the missing evidence, not silently applied.

<!-- id: REQ-VEVID-003 -->
## Evidence-less specs MUST be visibly flagged

Specs in `implemented` with zero evidence links carry a "no test evidence"
flag on every surface that shows link state (spec detail, drift queue —
as an additional lane or filter — and the CLI gate). [needs review: whether
`specship drifted --fail-on` grows an `unevidenced` value for CI.]

## Acceptance
<!-- id: REQ-VEVID-003.A1 -->
- The spec detail surface distinguishes "implemented, evidenced" from
  "implemented, no test evidence".

<!-- id: REQ-VEVID-004 -->
## A failing linked test MUST demote only its own specs

When a test with evidence links fails, the specs it evidences demote
(`verified` → `broken` per the existing fail path) — and no other spec's
state changes. The guessing step in the current spec-verify prompt is
removed: attribution comes from evidence links.

## Acceptance
<!-- id: REQ-VEVID-004.A1 -->
- A run with one failing evidenced test demotes exactly the specs linked to
  that test.
