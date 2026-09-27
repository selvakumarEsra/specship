---
id: TVIZ-DOC
title: Review remediation Wave 4 — testing depth & dashboard traceability
owner: specship-core
priority: medium
version: 1
---

<!-- id: TVIZ-DOC -->
# Review remediation Wave 4 — testing depth & dashboard traceability

Property-based and contract testing for the engine; the dashboard build-out
that makes spec↔code↔test traceability visible. Depends on VSTATE-DOC for the
coverage rollup and durable test links.

Non-goals: live test-run status per criterion (needs its own spec and a
runner decision — deliberately deferred), new visual design language.

<!-- id: REQ-TVIZ-001 -->
## Core parsers and traversal MUST have property-based tests

The repo has zero property-based tests. Add `fast-check` suites for the pure
functions with the richest input spaces.

implementations:
  - __tests__/property/query-parser.property.test.ts:adversarialQuery
  - __tests__/property/spec-extractor.property.test.ts:specDocument
  - __tests__/property/graph-traversal.property.test.ts:graphSpec

## Acceptance
<!-- id: REQ-TVIZ-001.A1 -->
- FTS query parser: for arbitrary strings, `parseQuery` never throws; `boundedEditDistance` is symmetric, satisfies the triangle inequality on sampled triples, and never exceeds its bound.
<!-- id: REQ-TVIZ-001.A2 -->
- Markdown spec extractor: for generated spec documents (random headings/ids/bullets), extraction never throws and every emitted spec's ID appears in the source.
<!-- id: REQ-TVIZ-001.A3 -->
- Graph traversal: on random graphs (including cycles), BFS/DFS agree on the reachable node set at equal depth, `maxDepth` is respected, and impact radius terminates.
<!-- id: REQ-TVIZ-001.A4 -->
- The property suites run in the normal `npm test` run within a bounded time (fixed run counts, seeded).

<!-- id: REQ-TVIZ-002 -->
## The JIRA client MUST be covered by contract tests against a local HTTP stub

36 test files stub `globalThis.fetch`; nothing exercises real transport.

implementations:
  - __tests__/jira/fixtures/jira-stub-server.ts:startJiraStub
  - __tests__/jira/jira-contract.test.ts:expectTypedAndCredentialFree

## Acceptance
<!-- id: REQ-TVIZ-002.A1 -->
- A shared fixture starts a local HTTP server speaking JIRA response shapes; client tests for auth, issue read, publish, and reconcile run against it over real HTTP.
<!-- id: REQ-TVIZ-002.A2 -->
- Negative transport cases are covered: 401, 429 (with retry semantics if implemented), 5xx, and a non-JSON (HTML) error body — each surfacing a typed error, not a crash.

<!-- id: REQ-TVIZ-003 -->
## The link lifecycle MUST have an end-to-end test

implementations:
  - __tests__/integration/link-lifecycle.test.ts:writeProject
  - __tests__/integration/link-lifecycle.test.ts:assertAgentLink

## Acceptance
<!-- id: REQ-TVIZ-003.A1 -->
- An integration test asserts a link, runs a full index, and proves the link survives with state preserved (per REQ-VSTATE-001).
<!-- id: REQ-TVIZ-003.A2 -->
- The test then mutates the target symbol's signature, re-resolves, and proves the link lands in `drifted(code)`; repairing (re-verify) restores it.
<!-- id: REQ-TVIZ-003.A3 -->
- The `implementations:`-block variant and the agent-asserted variant are both covered.

<!-- id: REQ-TVIZ-004 -->
## The dashboard e2e suite MUST cover failure paths, and the server MUST have a route-inventory guard

implementations:
  - __tests__/server-route-inventory.test.ts:collectRoutes
  - __tests__/server-route-inventory.test.ts:readManifest

## Acceptance
<!-- id: REQ-TVIZ-004.A1 -->
- Playwright specs cover: an API route returning 500 (app shows an error state, not a blank screen or console error), and an empty/unindexed project (explicit empty states).
<!-- id: REQ-TVIZ-004.A2 -->
- The e2e fixture server supports fault injection (env-selected route → 500) without code changes per test.
<!-- id: REQ-TVIZ-004.A3 -->
- A test enumerates registered Fastify routes at boot and fails when a route is absent from a checked-in manifest (new routes must be listed — and thereby consciously tested or waived).

<!-- id: REQ-TVIZ-005 -->
## Retrieval evals and coverage MUST be wired into CI

## Acceptance
<!-- id: REQ-TVIZ-005.A1 -->
- PRs touching `src/resolution/`, `src/search/`, or `src/mcp/` run `npm run test:eval`; results land in the job log/artifacts.
<!-- id: REQ-TVIZ-005.A2 -->
- The main test workflow collects v8 coverage and publishes the summary; a floor is set that can only be raised.

<!-- id: REQ-TVIZ-006 -->
## The spec detail page MUST distinguish test evidence from code links

implementations:
  - ui/src/components/spec-detail.tsx:isTestLink
  - ui/src/components/spec-detail.tsx:testVerdict
  - ui/src/components/spec-detail.tsx:criterionMet

## Acceptance
<!-- id: REQ-TVIZ-006.A1 -->
- Links are grouped by kind: implementation links under "Linked code", `tests` links under a "Proving tests" section, each row showing its kind.
<!-- id: REQ-TVIZ-006.A2 -->
- The spec headline shows a tested/untested fact derived from tests-link presence and state (per REQ-VSTATE-006 semantics).
<!-- id: REQ-TVIZ-006.A3 -->
- The criteria "met" rollup no longer counts an `implements`-only criterion as met.

<!-- id: REQ-TVIZ-007 -->
## The Specs page MUST show the funnel and per-requirement coverage badges

implementations:
  - ui/src/pages/specs.tsx:FunnelTiles
  - ui/src/pages/specs.tsx:CoverageChips
  - ui/src/pages/specs.tsx:IdeasBranch

## Acceptance
<!-- id: REQ-TVIZ-007.A1 -->
- The Specs page header renders funnel stat tiles from `GET /api/spec/funnel` (closing REQ-DASHUX-003.A2).
<!-- id: REQ-TVIZ-007.A2 -->
- Each requirement row shows compact code/test link indicators and its criteria N/M; document rows show a rollup.
<!-- id: REQ-TVIZ-007.A3 -->
- Idea-state briefs render in the tree as a visibly distinct branch (closing REQ-FUNNEL-006.A2/A3) instead of being dropped.

<!-- id: REQ-TVIZ-008 -->
## A traceability matrix view MUST exist

implementations:
  - ui/src/pages/traceability.tsx:TraceabilityPage
  - ui/src/pages/traceability.tsx:buildRows
  - server/src/routes/spec.ts:registerSpecRoutes

## Acceptance
<!-- id: REQ-TVIZ-008.A1 -->
- A dashboard page renders one row per requirement: code-link count, test-link count, criteria met N/M, rolled-up state, and drift age; sortable and filterable by document and state.
<!-- id: REQ-TVIZ-008.A2 -->
- The page is backed by the Wave 2 coverage rollup exposed over HTTP — the dashboard does not maintain its own third state-derivation.
<!-- id: REQ-TVIZ-008.A3 -->
- Row click navigates to the spec detail page for that requirement.

<!-- id: REQ-TVIZ-009 -->
## Verification and drift repair MUST be reachable from the dashboard

implementations:
  - ui/src/pages/drift.tsx:REPAIR
  - ui/src/components/spec-detail.tsx:persistedFields
  - ui/src/components/spec-detail.tsx:SpecEditor

## Acceptance
<!-- id: REQ-TVIZ-009.A1 -->
- The spec detail Verify action calls `POST /api/spec/link-verify`; a `no_test_evidence` refusal renders as actionable copy ("declare a proving test first").
<!-- id: REQ-TVIZ-009.A2 -->
- The drift queue's Fix / Re-verify / Re-attach actions launch their existing workflows via `POST /api/workflows/runs` and link to the created run.
<!-- id: REQ-TVIZ-009.A3 -->
- Editor fields that are not persisted (priority/kind/owner/rationale) are excluded from dirty-tracking or disabled — Save never promises a write that won't happen.

<!-- id: REQ-TVIZ-010 -->
## Spec traceability MUST survive in the whole-repo graph, and drift MUST read as heat on the artifact

implementations:
  - server/src/routes/graph.ts:registerGraphRoutes
  - ui/src/pages/specs.tsx:groupSpecs
  - ui/src/components/spec-detail.tsx:rollupState

## Acceptance
<!-- id: REQ-TVIZ-010.A1 -->
- The whole-repo graph view includes spec nodes and their link edges regardless of degree (union-in or a traceability mode), so spec↔code edges are not pruned by the top-N degree cut.
<!-- id: REQ-TVIZ-010.A2 -->
- Spec detail shows drift age per link (relative time), and the spec tree shades document rows by worst drift state.
