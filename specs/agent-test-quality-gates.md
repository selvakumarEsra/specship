---
id: QGATE-DOC
title: Agent-test quality gates — property lane, mutation gate, contract fuzzing, disable-comment detection
owner: specship-core
priority: high
version: 1
---

<!-- id: QGATE-DOC -->
# Agent-test quality gates

Four gaps from the 2026-10 workflow review
(`docs/research/optimized-dev-workflow-2026-10.md`) that harden the answer to
"who tests the agent's tests." Research basis: GenAI test suites average ~85%
line coverage but only ~57% mutation kill rate; property-based + example tests
combined catch ~81% of injected bugs vs ~69% alone; agents silence lint rules
with disable comments instead of fixing code.

Non-goals: running mutation or fuzz tools inside SpecShip itself; changing the
spec format, link kinds, or promotion rules; model-tier routing (already
shipped as `spec-implement-mixed`, MIXMODEL-DOC); auto-detecting OpenAPI
schemas; cleaning up pre-existing suppression comments (the scan is a ratchet
on new ones only).

Scope guards (removal-lane discipline): every gate here is **opt-in** and
scales with change size — a trivial change keeps the fast path. Nothing in this
document changes the spec format or the existing evidence rules
(REQ-REVINT-005: test evidence stays file-derived; REQ-VEVID-002: no promotion
without evidence). G4 from the review (model-tier routing) is already shipped
as `spec-implement-mixed` (MIXMODEL-DOC) and is deliberately absent here.

<!-- id: REQ-QGATE-001 -->
## The behaviour lane MUST offer a property-test leg for invariant-phrased criteria

The behaviour harness (BEHAVIOUR-DOC) turns acceptance criteria into example
e2e tests. Criteria phrased as invariants — "for all", "never", "always",
"MUST NOT", round-trip phrasing — are strictly stronger when expressed as
property-based tests, because properties are independent of the implementation
and break the self-confirmation loop of agent-written example tests.

The behaviour-surface primitive MUST classify each acceptance criterion as
`example` or `invariant` (deterministic keyword/shape heuristic — no LLM call),
and the `/specship:spec behaviour` flow MUST offer a property-test template for
`invariant` criteria: Hypothesis (`@given`/strategies) when the project is
Python, fast-check when it is TypeScript/JavaScript. Generated property tests
link to their criterion through the existing file-derived evidence chain
(`verifies:` block or `@verifies` comment) — this lane adds no new link kind
and no new promotion path.

implementations:
  - src/behaviour/behaviour-surface.ts:classifyCriterionShape
  - src/behaviour/behaviour-surface.ts:propertyFramework
  - src/behaviour/behaviour-surface.ts:computeBehaviourSurface
  - commands/specship/spec.md

verifies:
  - __tests__/behaviour-surface.test.ts:classifiesInvariantPhrasing
  - __tests__/behaviour-surface.test.ts:classifiesExamplePhrasing
  - __tests__/behaviour-surface.test.ts:surfaceCarriesCriteriaWithShape
  - __tests__/behaviour-surface.test.ts:pickFrameworkFromLanguage

## Acceptance
<!-- id: REQ-QGATE-001.A1 -->
- `computeBehaviourSurface` output marks each acceptance criterion with
  `testShape: 'example' | 'invariant'`, derived deterministically from the
  criterion text; the classification is visible in the rendered surface.
<!-- id: REQ-QGATE-001.A2 -->
- For a criterion classified `invariant` in a Python project, the behaviour
  flow's generated test skeleton is a Hypothesis property (uses `@given`),
  not a single hard-coded example; for TypeScript projects it is a fast-check
  property.
<!-- id: REQ-QGATE-001.A3 -->
- A generated property test that is declared via the spec's `verifies:` block
  participates in verification exactly like any other test link — no new
  states, kinds, or promotion rules are introduced.

<!-- id: REQ-QGATE-002 -->
## `specship check` MUST support an opt-in mutation-score gate on test evidence

A `tests` link currently counts as verification evidence if the test exists and
the suite passes — nothing measures whether the test would notice the
implementation breaking. An opt-in mutation gate closes that: when enabled, the
check gate consumes a mutation report in the cross-tool
mutation-testing-report-schema JSON (produced by the project's own mutation
tool in CI — Stryker natively; mutmut ecosystems via conversion) and evaluates,
per spec, the mutant kill rate of its linked implementation files. Links whose
tests kill below the configured threshold are reported as weak evidence; the
gate fails only when the project config says so. SpecShip never executes the
mutation tool itself — `specship check` stays deterministic and fast.

Opt-in lives in `specship.config.json` → `enforce.mutation`
(`{ report, threshold }`, read by `loadEnforceConfig`); default is OFF. Silent
beats wrong: when the configured report is missing or unreadable, the gate
reports `skipped` explicitly — never `passed`.

implementations:
  - src/enforce/mutation.ts:parseMutationReport
  - src/enforce/mutation.ts:loadMutationDeps
  - src/enforce/enforce.ts:evaluateEnforcement

verifies:
  - __tests__/mutation-gate.test.ts:checkAbsentWhenNotConfigured
  - __tests__/mutation-gate.test.ts:weakEvidenceNamesSpecLinkRateThreshold
  - __tests__/mutation-gate.test.ts:skippedReportNeverFailsOrPasses
  - __tests__/mutation-gate.test.ts:loadsReportFromDiskAndScopesToConfig

## Acceptance
<!-- id: REQ-QGATE-002.A1 -->
- With the mutation gate disabled (the default), `specship check` output and
  exit code are byte-identical to today's behavior.
<!-- id: REQ-QGATE-002.A2 -->
- With the gate enabled on a project where a linked implementation survives
  mutants its linked tests should kill (kill rate below threshold), the check
  report names the spec ID, the link, the kill rate, and the threshold.
<!-- id: REQ-QGATE-002.A3 -->
- When the configured mutation tool is unavailable, the report states
  `mutation gate: skipped` with the reason; a skipped gate never fails the
  check and is never rendered as passed.

<!-- id: REQ-QGATE-003 -->
## The behaviour lane SHOULD offer a contract-fuzz leg for route-backed criteria

Requirements whose implementations link to `route`-kind nodes describe API
contracts. For those, hand-written example tests under-cover the input space;
an OpenAPI-driven fuzz run (Schemathesis) covers documented examples,
boundaries, and stateful sequences with zero hand-written tests.

When a spec in the behaviour flow has an `implements` link to a `route` node
and the project exposes an OpenAPI schema (the emitted command carries a
schema placeholder the behaviour flow fills in — no auto-detection in v1),
the flow SHOULD offer a contract-fuzz leg: a runnable Schemathesis invocation
scoped to the linked routes. Outcomes feed `specship_link_verify` as pass/fail
with the fuzz report as evidence; they do not mint `tests`-kind links
(REQ-REVINT-005 holds).

implementations:
  - src/behaviour/behaviour-surface.ts:renderContractFuzzCommand
  - src/behaviour/behaviour-surface.ts:renderBehaviourSurface

verifies:
  - __tests__/behaviour-surface.test.ts:surfaceMarksRouteBackedSpecsEligible
  - __tests__/behaviour-surface.test.ts:fuzzCommandScopedToLinkedRoutes
  - __tests__/behaviour-surface.test.ts:renderedSurfaceEmitsReviewableFuzzLeg

## Acceptance
<!-- id: REQ-QGATE-003.A1 -->
- For a spec whose `implements` links include at least one `route`-kind node,
  the behaviour surface names the route(s) and marks the spec as eligible for
  the contract-fuzz leg; specs with no route links are unaffected.
<!-- id: REQ-QGATE-003.A2 -->
- The generated fuzz invocation targets only the linked routes (not the whole
  API) and is emitted as a reviewable command/file, not executed silently.
<!-- id: REQ-QGATE-003.A3 -->
- A failing fuzz run recorded through link verification sets the link to
  `broken` with the failing case as the reason; a passing run is evidence for
  `verified` only under the existing evidence rules.

<!-- id: REQ-QGATE-004 -->
## The implement pipeline and check gate MUST detect new lint-suppression comments deterministically

The spec-implement quality gate tells the fixing agent "never silence or
disable a rule" — as a prompt instruction. Agents do exactly this under
pressure, so the rule MUST also be enforced in code: a deterministic scan that
flags lint/type-suppression markers (`noqa`, `eslint-disable`,
`@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `biome-ignore`)
**introduced by the change under review** (present in added lines, absent
before). Pre-existing suppressions are out of scope — this is a ratchet, not a
cleanup mandate.

The scan runs in the spec-implement workflows' quality gate (a finding halts
the run with a named cause) and in `specship check` as a `suppressions` check
(advisory by default, gateable). A suppression with an inline justification
(e.g. `eslint-disable-next-line foo -- reason`) is still flagged, labeled
justified — the label triages, it does not wave the finding through. Precision
rules: a marker counts only in a file type its linter reads, only in comment
position (not string literals or prose), and only when the directive starts
the comment.

implementations:
  - src/enforce/suppressions.ts:scanDisableComments
  - src/enforce/changed-files.ts:workingTreeDiffText

verifies:
  - __tests__/suppression-scan.test.ts:flagsAddedNoqaWithFileLineMarker
  - __tests__/suppression-scan.test.ts:ignoresMentionsOutsideLintableContext
  - __tests__/suppression-scan.test.ts:suppressionsCheckReportsFindings
  - __tests__/suppression-scan.test.ts:scansWorkingTreeIncludingUntracked

## Acceptance
<!-- id: REQ-QGATE-004.A1 -->
- A diff that adds a line containing any recognized suppression marker fails
  the quality gate with the file, line, and marker named; a diff that only
  moves or deletes existing suppressions passes.
<!-- id: REQ-QGATE-004.A2 -->
- The scan is pure (input: unified diff text; output: findings) and covered by
  unit tests for each marker family and for the moved-line non-finding case.
<!-- id: REQ-QGATE-004.A3 -->
- Both default implement workflows (`spec-implement`, `spec-implement-mixed`)
  run the scan between implement and final review, and its verdict appears in
  the final approval message.
