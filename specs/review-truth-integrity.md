---
id: REVINT-DOC
title: Review remediation Wave 1 — truth & integrity fixes
owner: specship-core
priority: high
version: 1
---

<!-- id: REVINT-DOC -->
# Review remediation Wave 1 — truth & integrity fixes

Small, independently shippable fixes from the 2026-09-25 six-surface review.
Theme: every number the product shows must be real, every silent failure must
produce a signal, and every state transition must be auditable.

Non-goals: no new features, no schema migrations, no UI build-out (Wave 4),
no changes to the verified-state model beyond evidence persistence (Wave 2).

<!-- id: REQ-REVINT-001 -->
## The `verifies:` block MUST be documented wherever `implementations:` is documented

The parser supports `verifies:` (creating `tests`-kind links that gate promotion
to `verified`), but no command or template mentions it, so 91% of specs cannot
reach the pipeline's terminal state.

`commands/specship/spec.md` (the `new` and `fast` draft steps and the
Post-write review rubric) MUST describe the `verifies:` block with the same
`path:Symbol` syntax shown for `implementations:`.

verifies:
  - __tests__/command-doc-truth.test.ts:newPathNamesVerifiesBlock
  - __tests__/command-doc-truth.test.ts:fastPathNamesVerifiesBlock
  - __tests__/command-doc-truth.test.ts:postWriteChecklistCoversTestEvidence

## Acceptance
<!-- id: REQ-REVINT-001.A1 -->
- The `new` and `fast` authoring paths in `commands/specship/spec.md` each name the `verifies:` block and its `path:Symbol` bullet syntax.
<!-- id: REQ-REVINT-001.A2 -->
- The Post-write review's structural checklist includes "test-evidence declared via `verifies:` or explicitly deferred".

<!-- id: REQ-REVINT-002 -->
## Bare-path link bullets MUST produce a warning, and sync MUST surface spec parse errors

`extractLinkRefBlock` silently skips a bullet that is not `path:Symbol` (87 of
609 implementation bullets today produce no edge with no signal). The sync
path (`indexSpecsInternal`) also drops extraction errors without counting or
returning them.

implementations:
  - src/extraction/specs/markdown-spec-extractor.ts:MarkdownSpecExtractor.extractLinkRefBlock
  - src/index.ts:SpecShip.indexSpecsInternal

## Acceptance
<!-- id: REQ-REVINT-002.A1 -->
- A `implementations:` or `verifies:` bullet that does not match `path:Symbol` emits a `warning`-severity extraction error (e.g. `spec_bare_path_ref`) naming the file and bullet text.
<!-- id: REQ-REVINT-002.A2 -->
- The sync spec pass accumulates and returns extraction error counts the same way `indexSpecs` does, and the CLI prints a non-zero error/warning count.
<!-- id: REQ-REVINT-002.A3 -->
- A spec whose bullets are all well-formed `path:Symbol` produces zero new warnings (no false positives on the existing corpus's valid bullets).

<!-- id: REQ-REVINT-003 -->
## `specship_link_assert` MUST validate the target symbol before recording `implemented`

Today the handler skips node lookup and inserts state `implemented` for any
`file:Symbol`, so a typo'd or invented target poisons the funnel until a later
resolver pass flips it to `orphaned`.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkAssert
  - src/mcp/spec-tools.ts:nearMissSuggestions
  - server/src/routes/spec.ts:registerSpecRoutes

## Acceptance
<!-- id: REQ-REVINT-003.A1 -->
- Asserting a link whose file+symbol resolves in the graph records the link with `resolved_node_id` populated and the node signature snapshotted as the drift baseline (`node_sig_at_link`).
<!-- id: REQ-REVINT-003.A2 -->
- Asserting a link whose target does not resolve is refused with an error that includes near-miss suggestions, OR recorded as `orphaned` (not `implemented`) — never as `implemented`.
<!-- id: REQ-REVINT-003.A3 -->
- The dashboard route `POST /api/spec/link-assert` applies the same validation.

<!-- id: REQ-REVINT-004 -->
## `specship_link_verify` MUST persist verification evidence

The tool accepts a `reason` and promises it lands in metadata, but calls
`updateSpecLinkState(linkId, state, null)` — the reason, timestamp, and any
test identity are dropped, making `verified` unauditable.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify
  - src/mcp/spec-tools.ts:verificationOf
  - src/mcp/spec-tools.ts:formatLink

## Acceptance
<!-- id: REQ-REVINT-004.A1 -->
- After a `pass` or `fail` verification, the link's `metadata` contains the reason, an ISO timestamp, and the caller-supplied evidence detail (test name(s) when provided).
<!-- id: REQ-REVINT-004.A2 -->
- The persisted evidence is visible when the link is rendered (drift queue detail / link formatting).
<!-- id: REQ-REVINT-004.A3 -->
- Verifying with no reason still records the timestamp (evidence is never silently absent).

<!-- id: REQ-REVINT-005 -->
## The spec-implement workflow MUST NOT be able to mint its own test evidence

The `link` node holds both `specship_link_assert` (which accepts
`kind: 'tests'`) and `specship_link_verify`, so the implementing agent can
create a DB-only tests link and then promote itself past the evidence gate.

implementations:
  - src/mcp/spec-tools.ts:isFileDerivedEvidence

verifies:
  - __tests__/workflow-discovery.test.ts:linkNodeCannotAssertTestsKind

## Acceptance
<!-- id: REQ-REVINT-005.A1 -->
- The `link` node in `spec-implement.yaml` (and the mixed variant) cannot assert `tests`-kind links (allowlist trim or kind restriction).
<!-- id: REQ-REVINT-005.A2 -->
- The evidence gate still accepts file-derived test evidence (`verifies:` block or `@verifies` comment provenance).
<!-- id: REQ-REVINT-005.A3 -->
- A workflow run whose spec has no file-derived test evidence leaves links at `implemented` with the gate's refusal message surfaced in the run output, not silently `verified`.

<!-- id: REQ-REVINT-006 -->
## The verify leg MUST attribute failures correctly, and spec-fix MUST carry the same integrity

The verify script has no fail-fast on install/build, so a build break reports
`ran-and-failed` (a test failure). `spec-fix.yaml` has no marker at all, no
bootstrap, and no post-apply human gate — a repo without a recognized runner
can drive links to `verified` having run zero tests.

verifies:
  - __tests__/workflow-discovery.test.ts:verifyEmitsDistinctEnvAndBuildMarkers
  - __tests__/workflow-discovery.test.ts:skippedSpecFixVerifyNeverPromotes
  - __tests__/workflow-discovery.test.ts:specFixGatesLinkStateOnHumanApproval

## Acceptance
<!-- id: REQ-REVINT-006.A1 -->
- Install and build failures in the spec-implement verify script emit distinct markers (`VERIFY_RESULT=env-failed` / `build-failed`) and are not reported as test failures.
<!-- id: REQ-REVINT-006.A2 -->
- `spec-fix.yaml` emits the same `VERIFY_RESULT` marker contract, including the bootstrap (install if `node_modules` missing, build before test).
<!-- id: REQ-REVINT-006.A3 -->
- A `spec-fix` run whose verify leg was skipped (no recognized runner) MUST NOT promote any link to `verified`.
<!-- id: REQ-REVINT-006.A4 -->
- `spec-fix` includes a human approval gate after the fix is applied, before links change state.

<!-- id: REQ-REVINT-007 -->
## The dashboard MUST NOT render fabricated or mislabeled numbers

Four instances violate the no-silently-wrong-number invariant (REQ-DASHINT-007):
the Settings "MCP server: running" literal, the dashboard drift tile's
hardcoded `delta: 0` rendered as a red `↑ +0`, Compare's fabricated per-project
drift of 0 asserted as ", no drifted links.", and byte counts labeled "tokens"
(~4× overstated) on the dashboard modules and heatmap.

implementations:
  - ui/src/components/ui.tsx:Delta
  - ui/src/pages/compare.tsx:driftPhrase
  - ui/src/components/dashboard-modules.tsx:estTokens

## Acceptance
<!-- id: REQ-REVINT-007.A1 -->
- The Settings MCP-server row shows a probed status or is removed; it never shows a hardcoded "running".
<!-- id: REQ-REVINT-007.A2 -->
- The drift stat tile shows no delta/trend when no prior-window delta is computed (and `Delta` renders a neutral zero case).
<!-- id: REQ-REVINT-007.A3 -->
- Compare shows an explicit "not measured" marker (e.g. `—`) for non-primary projects' drift instead of `0`, and the prose no longer claims "no drifted links" for unmeasured data.
<!-- id: REQ-REVINT-007.A4 -->
- Values derived from `resultBytes`/`result_length` are either converted to estimated tokens (chars/4, labeled as estimate) or relabeled as size — never labeled `tokens` while holding bytes.

<!-- id: REQ-REVINT-008 -->
## The graph's dead "tests" edge bucket MUST be fixed or removed

`graph.ts` buckets on `nodes.kind = 'test'`, a kind that does not exist in
`NODE_KINDS`, so the legend row, filter toggle, and edge coloring for "tests"
are permanently zero/unreachable.

implementations:
  - server/src/routes/graph.ts:registerGraphRoutes
  - ui/src/pages/graph.tsx:EDGE_CHIPS

## Acceptance
<!-- id: REQ-REVINT-008.A1 -->
- The health endpoint's `tests` edge bucket counts real test-evidence relationships (derived from `spec_links.kind = 'tests'` / the `validates` edge kind), verified non-zero on a fixture with a tests link.
<!-- id: REQ-REVINT-008.A2 -->
- The graph UI legend/filter for "tests" reflects the fixed bucket; if the bucket cannot be computed it is not rendered (no permanent hardcoded 0).

<!-- id: REQ-REVINT-009 -->
## The maintainability gate MUST use the high-precision verdict

`enforce.ts` gates on `m.clean` (dead-code/coupling flood ⇒ permanently red);
`highPrecisionClean` exists for exactly this and is ignored.

implementations:
  - src/enforce/enforce.ts:evaluateEnforcement
  - src/graph/maintainability.ts:highPrecisionClean

## Acceptance
<!-- id: REQ-REVINT-009.A1 -->
- With gating enabled, the maintainability check passes/fails on `highPrecisionClean`.
<!-- id: REQ-REVINT-009.A2 -->
- Below-gateway findings (dead code, coupling) still appear as advisory findings, not gate failures.
