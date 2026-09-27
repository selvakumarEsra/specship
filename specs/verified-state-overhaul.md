---
id: VSTATE-DOC
title: Review remediation Wave 2 — make `verified` real
owner: specship-core
priority: high
version: 1
---

<!-- id: VSTATE-DOC -->
# Review remediation Wave 2 — make `verified` real

Structural changes so the `verified` link state is durable, derived from real
test results, and computable per acceptance criterion. Depends on Wave 1
(REVINT-DOC) landing first for evidence persistence and assert-time baselines.

Non-goals: dashboard rendering of the new data (Wave 4), live test-run
status (deferred, needs a runner decision), CI wiring (Wave 3/4).

<!-- id: REQ-VSTATE-001 -->
## Re-extracting an edited spec file MUST NOT destroy its links

`indexSpecsInternal` deletes all specs for a changed file and `spec_links` is
`ON DELETE CASCADE`, so every non-file-declared link (including all
agent-asserted `tests` links) is destroyed on any spec edit, and the
sticky-verified and spec-axis-drift machinery is unreachable on the real edit
path.

implementations:
  - src/index.ts:SpecShip.replaceSpecsForFile
  - src/db/spec-queries.ts:SpecQueries.reconcileDeclaredLinks
  - src/index.ts:SpecShip.indexSpecsInternal

## Acceptance
<!-- id: REQ-VSTATE-001.A1 -->
- Editing a spec file's prose (same spec IDs) preserves existing links, including agent-asserted links with no file declaration.
<!-- id: REQ-VSTATE-001.A2 -->
- A preserved link on a spec whose content hash changed transitions per the spec-axis drift rule (verified → drifted(spec)), not back to a fresh `implemented`.
<!-- id: REQ-VSTATE-001.A3 -->
- Removing a spec ID from the file still removes that spec's links (mark-and-sweep of stale IDs — no orphan accumulation).
<!-- id: REQ-VSTATE-001.A4 -->
- A full `specship index` run preserves agent-asserted links for unchanged spec files.

<!-- id: REQ-VSTATE-002 -->
## Test evidence MUST be linkable at test-case granularity via spec IDs in test titles

The repo convention already writes `it('… (REQ-X.A1)', …)` in 141 of 206 test
files. The resolver MUST recognize a spec ID inside an `it(...)`/`test(...)`
title string and create a `tests`-kind link targeting that test case, removing
the hoisted-named-function boilerplate and fixture mis-attribution.

implementations:
  - src/resolution/test-title-links.ts:scanTestTitleRefs
  - src/resolution/test-title-links.ts:isRecognizedTestFile
  - src/resolution/spec-link-resolver.ts:nonTestEvidenceFlag

## Acceptance
<!-- id: REQ-VSTATE-002.A1 -->
- A test file containing `it('does X (REQ-FOO-001.A1)', …)` produces a `tests` link from `REQ-FOO-001.A1` to that test with provenance `code-comment` or a dedicated test-title provenance.
<!-- id: REQ-VSTATE-002.A2 -->
- A spec ID mentioned in a non-test string literal (e.g. a source file's message) does NOT create a tests link — recognition is limited to test files.
<!-- id: REQ-VSTATE-002.A3 -->
- The link survives re-index (it is file-derived, re-created on every extraction pass).
<!-- id: REQ-VSTATE-002.A4 -->
- A `tests`-kind link whose target does not resolve inside a recognized test file (`__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`) is flagged or downgraded — fixtures can no longer satisfy the evidence gate.

<!-- id: REQ-VSTATE-003 -->
## Acceptance bullets MUST be able to carry `verifies:` and `implementations:` blocks

The extractor calls link extraction only for heading-derived sections; a link
block under an id-marked acceptance bullet is absorbed as prose, leaving 1,176
of 1,179 criteria structurally unlinkable.

implementations:
  - src/extraction/specs/markdown-spec-extractor.ts:MarkdownSpecExtractor.extract
  - src/extraction/specs/markdown-spec-extractor.ts:isIndentedLinkBlockKeyword

## Acceptance
<!-- id: REQ-VSTATE-003.A1 -->
- An indented `verifies:` block immediately following an id-marked acceptance bullet creates `tests`-kind links owned by that bullet's spec ID.
<!-- id: REQ-VSTATE-003.A2 -->
- The same works for `implementations:` under a bullet (creating `implements` links).
<!-- id: REQ-VSTATE-003.A3 -->
- A bullet without a following link block parses exactly as before (no regression on the existing corpus).

<!-- id: REQ-VSTATE-004 -->
## Verification MUST be derivable from a real test report

Replace LLM-judged verification with deterministic ingestion: a command that
reads a vitest JSON (or JUnit XML) report, maps reported test cases to `tests`
links by file + test title, and promotes/demotes link states accordingly.

implementations:
  - src/verify/report-ingest.ts:ingestTestReport
  - src/verify/report-ingest.ts:parseVitestJsonReport
  - src/verify/report-ingest.ts:caseMatchesLink

## Acceptance
<!-- id: REQ-VSTATE-004.A1 -->
- `specship verify --report <file>` with a vitest JSON report promotes `tests` links whose test passed to `verified` and records run evidence (run id/timestamp/test name) in link metadata.
<!-- id: REQ-VSTATE-004.A2 -->
- A failing test demotes its link to `broken` with the failure recorded.
<!-- id: REQ-VSTATE-004.A3 -->
- Tests in the report with no matching link are reported as unmatched (count surfaced), not silently dropped.
<!-- id: REQ-VSTATE-004.A4 -->
- A malformed or empty report file exits non-zero with a parse error and changes no link state.

<!-- id: REQ-VSTATE-005 -->
## The workflow's verify→link→coverage contract MUST be deterministic code, not prompts

The `VERIFY_RESULT` router and the "N of M acceptance criteria have linked
tests" coverage count are currently produced by an LLM reading node output —
the one number the final human gate rests on is hallucinable.

implementations:
  - src/graph/spec-coverage.ts:formatCoverageLine

## Acceptance
<!-- id: REQ-VSTATE-005.A1 -->
- `VERIFY_RESULT` is parsed and routed by code (bash/script node or CLI subcommand), not by a prompt node.
<!-- id: REQ-VSTATE-005.A2 -->
- The coverage line in `final_review` is computed from the DB (spec children + their `tests` links), byte-identical to what `getSpecCoverage` (REQ-VSTATE-006) reports.
<!-- id: REQ-VSTATE-005.A3 -->
- A verify marker of `env-failed`/`build-failed` (REQ-REVINT-006) halts before link mutation with the environment cause named in the run output.

<!-- id: REQ-VSTATE-006 -->
## A coverage rollup MUST exist: per requirement and per criterion, code links, test links, verdict

No query today answers "which requirements/criteria have passing test
evidence". The rollup's verdict MUST derive only from `tests`-link states —
an `implements` link alone never counts as "met".

implementations:
  - src/graph/spec-coverage.ts:computeSpecCoverage
  - src/index.ts:SpecShip.getSpecCoverage
  - src/mcp/spec-tools.ts:renderCoverage

## Acceptance
<!-- id: REQ-VSTATE-006.A1 -->
- `SpecShip.getSpecCoverage(specId?)` returns, per requirement and per criterion: implements-link count/states, tests-link count/states, and a verdict in {untested, tested, verified, broken}.
<!-- id: REQ-VSTATE-006.A2 -->
- The rollup is exposed over MCP (extending `specship_spec`) and HTTP (`GET /api/spec/coverage` or equivalent).
<!-- id: REQ-VSTATE-006.A3 -->
- A criterion with only an `implements` link reports `untested` (fixes the dashboard's implemented-counted-as-met conflation).
<!-- id: REQ-VSTATE-006.A4 -->
- A spec ID with no children and no links returns an empty-but-valid rollup, not an error.
