---
id: PIPETRUST-DOC
title: Pipeline trust — nothing silent, nothing by hand (0.29)
owner: specship-core
priority: high
version: 1
jira_issue_REQ-PIPETRUST-001: SSHIP-378
jira_fingerprint_REQ-PIPETRUST-001: fea2f2b998a98f22
jira_issue_REQ-PIPETRUST-002: SSHIP-382
jira_fingerprint_REQ-PIPETRUST-002: 8d88e07c9da28742
jira_issue_REQ-PIPETRUST-003: SSHIP-385
jira_fingerprint_REQ-PIPETRUST-003: 356d2ad48a8dbb78
jira_issue_REQ-PIPETRUST-004: SSHIP-388
jira_fingerprint_REQ-PIPETRUST-004: 5985fbd563f92121
jira_issue_REQ-PIPETRUST-005: SSHIP-392
jira_fingerprint_REQ-PIPETRUST-005: d24a3e404a4393c2
jira_issue_REQ-PIPETRUST-006: SSHIP-398
jira_fingerprint_REQ-PIPETRUST-006: 2ad3ef2d80b3e4c0
jira_issue_REQ-PIPETRUST-007: SSHIP-402
jira_fingerprint_REQ-PIPETRUST-007: 0d4156ce25a82c73
---

<!-- id: PIPETRUST-DOC -->
# Pipeline trust — nothing silent, nothing by hand (0.29)

On 2026-10-26 four of four `spec-implement` runs needed a human to finish
them: test evidence was linked by `it()` title strings (no edge), the
CHANGELOG and generated reference docs were missed, the headless
`link_assert` call was always denied, a failed step's output was lost, and
coverage counted "a test" without asking what kind. Separately, npm
publishing had failed for a month and JIRA auto-publish failed on 82
requirements every session start — both silently.

This document makes the pipeline's own checks mechanical and its failures
loud: every acceptance criterion carries a required kind of evidence, a spec
must be ready before implement starts, the agent's work is checked
mechanically before anyone reviews it, step evidence survives failure, and
pipeline health is surfaced instead of discovered.

Non-goals: knowledge capture (KNOWLEDGE-DOC, 0.30); parallel runs and host
parity (THROUGHPUT-DOC, 0.31); changing the spec link state machine.

<!-- id: REQ-PIPETRUST-001 -->
## Every acceptance criterion MUST resolve to a required evidence kind

Each acceptance criterion MUST resolve to exactly one required evidence kind
— `unit`, `property`, `e2e` or `contract`. An author MAY declare it inline
with an `(evidence: <kind>)` tag in the bullet; otherwise it is derived
deterministically: invariant-phrased criteria (the existing
`classifyCriterionShape`) require `property`; a requirement directly linked
to UI code requires `e2e`; one directly linked to a `route` requires
`contract`; everything else requires `unit`. An unknown declared kind is a
lint error.

implementations:
  - src/spec-quality/evidence-kind.ts:requiredEvidenceKind
  - src/spec-quality/evidence-kind.ts:parseDeclaredEvidenceKind
  - src/spec-lint/lint.ts:lintSpecSource

verifies:
  - __tests__/evidence-kind.test.ts:declaredKindWins
  - __tests__/evidence-kind.test.ts:derivedKindFollowsCriterionShape
  - __tests__/evidence-kind.test.ts:unknownDeclaredKindIsALintError

## Acceptance
<!-- id: REQ-PIPETRUST-001.A1 -->
- A criterion carrying `(evidence: e2e)` resolves to `e2e` regardless of its wording or links.
<!-- id: REQ-PIPETRUST-001.A2 -->
- Without a tag, an invariant-phrased criterion resolves to `property`, a criterion of a requirement linked to a UI file resolves to `e2e`, one linked to a route resolves to `contract`, and any other resolves to `unit`.
<!-- id: REQ-PIPETRUST-001.A3 -->
- `specship lint` reports an error for `(evidence: <kind>)` with a kind outside the four.

<!-- id: REQ-PIPETRUST-002 -->
## Test evidence MUST be classified by kind from the test itself

Each `tests` link's target MUST be classified as `unit`, `property`, `e2e`
or `contract` from the test file alone, deterministically: property-testing
library use (fast-check, Hypothesis, jqwik, proptest, …) → `property`;
Playwright/Cypress use or an e2e test path → `e2e`; Schemathesis/Pact use or
a contract test path → `contract`; anything else → `unit`.

implementations:
  - src/spec-quality/evidence-kind.ts:classifyTestEvidence

verifies:
  - __tests__/evidence-kind.test.ts:classifiesTestFilesByKind

## Acceptance
<!-- id: REQ-PIPETRUST-002.A1 -->
- A test file importing `fast-check` classifies as `property`; one importing `@playwright/test` or living under an `e2e/` directory as `e2e`; one referencing Schemathesis or Pact or living under `contract(s)/` as `contract`; any other as `unit`.
<!-- id: REQ-PIPETRUST-002.A2 -->
- Classification never throws on an unreadable or missing file; it falls back to `unit`.

<!-- id: REQ-PIPETRUST-003 -->
## Coverage MUST report evidence kind per criterion against what is required

`specship coverage` MUST show, per acceptance criterion, the required
evidence kind and the kinds actually present among its `tests` links, and
flag a criterion whose tests do not include the required kind. A
`--require-kinds` flag MUST make the command exit non-zero when any
criterion in scope lacks its required kind, so it can gate CI and workflows.
The existing verdicts are unchanged.

implementations:
  - src/graph/spec-coverage.ts:computeSpecCoverage
  - src/graph/spec-coverage.ts:evidenceKindCoverage

verifies:
  - __tests__/evidence-kind.test.ts:coverageReportsRequiredAndPresentKinds
  - __tests__/evidence-kind.test.ts:requireKindsFailsOnMissingKind

## Acceptance
<!-- id: REQ-PIPETRUST-003.A1 -->
- A criterion requiring `property` whose only linked test is a plain unit test is reported as missing its required kind, while its verdict stays as before.
<!-- id: REQ-PIPETRUST-003.A2 -->
- With `--require-kinds`, the command exits non-zero when any in-scope criterion lacks its required kind, and zero when all have it.

<!-- id: REQ-PIPETRUST-004 -->
## Implement MUST NOT start on a spec that is not ready

A `specship ready <SPEC_ID>` command MUST report whether a requirement is
ready to implement and MUST exit non-zero when it is not: the spec file has
lint errors, the requirement has no acceptance criteria, or a criterion
still carries `[needs review]`. When ready, it MUST print an evidence plan —
one line per criterion with its required kind and a suggested named test
function. The bundled implement workflows MUST run it before planning and
halt when it fails, and pass the evidence plan to the plan and implement
steps.

implementations:
  - src/spec-quality/readiness.ts:assessReadiness
  - src/spec-quality/readiness.ts:formatEvidencePlan
  - src/workflows/defaults/spec-implement.yaml
  - src/workflows/defaults/spec-implement-mixed.yaml

verifies:
  - __tests__/spec-readiness.test.ts:readySpecPrintsEvidencePlan
  - __tests__/spec-readiness.test.ts:notReadyWhenCriterionNeedsReview
  - __tests__/spec-readiness.test.ts:notReadyWithoutCriteria
  - __tests__/workflow-discovery.test.ts:readinessGatesThePlan

## Acceptance
<!-- id: REQ-PIPETRUST-004.A1 -->
- For a ready requirement, `specship ready` exits zero and prints, per criterion, its id, required evidence kind, and a suggested test function name derived from the criterion id.
<!-- id: REQ-PIPETRUST-004.A2 -->
- A requirement with a `[needs review]` criterion, or with no criteria, makes `specship ready` exit non-zero naming the reason.
<!-- id: REQ-PIPETRUST-004.A3 -->
- Both bundled implement workflows run a readiness step before `plan`, `plan` depends on it, and the plan and implement prompts receive its output.

<!-- id: REQ-PIPETRUST-005 -->
## The agent's work MUST be checked mechanically before review

A `specship postcheck <SPEC_ID>` command MUST check, after implement: every
acceptance criterion of the requirement is covered by a `verifies:` bullet
that names a real symbol in a test file (a title string or a missing symbol
fails); when source files changed against the base ref, `CHANGELOG.md`'s
`## [Unreleased]` section changed too; and every project-configured check
command (`postcheck.commands` in `specship.config.json`) succeeds. With
`--fix` it MUST run each configured command's fix action first. The bundled
implement workflows MUST run postcheck with `--fix`, give remaining failures
to a fix step, and halt if a recheck still fails — the same shape as the
quality gate.

implementations:
  - src/spec-quality/postcheck.ts:runPostcheck
  - src/spec-quality/postcheck.ts:checkVerifiesCoverage
  - src/workflows/defaults/spec-implement.yaml
  - src/workflows/defaults/spec-implement-mixed.yaml

verifies:
  - __tests__/spec-postcheck.test.ts:titleStringVerifiesFails
  - __tests__/spec-postcheck.test.ts:uncoveredCriterionFails
  - __tests__/spec-postcheck.test.ts:sourceChangeWithoutChangelogFails
  - __tests__/spec-postcheck.test.ts:configuredCommandFixRunsFirst
  - __tests__/spec-postcheck.test.ts:allChecksPass
  - __tests__/workflow-discovery.test.ts:postcheckRunsAfterQualityAndHalts

## Acceptance
<!-- id: REQ-PIPETRUST-005.A1 -->
- A `verifies:` bullet whose symbol contains spaces, or names no symbol present in the test file, fails postcheck naming the bullet.
<!-- id: REQ-PIPETRUST-005.A2 -->
- An acceptance criterion with no `verifies:` coverage fails postcheck naming the criterion.
<!-- id: REQ-PIPETRUST-005.A3 -->
- A change touching `src/` with no change to `CHANGELOG.md`'s `[Unreleased]` section fails postcheck.
<!-- id: REQ-PIPETRUST-005.A4 -->
- With `--fix`, a configured command's fix action runs before its check, and a check that then passes does not fail postcheck.
<!-- id: REQ-PIPETRUST-005.A5 -->
- Both bundled implement workflows run postcheck after the quality recheck, route failures to a fix step, and halt when the recheck still fails.

<!-- id: REQ-PIPETRUST-006 -->
## Workflow step evidence MUST survive failure and links MUST be durable

When a bash step fails, its output MUST still be stored as the step's output
and artifact, and the recorded error MUST keep the END of the output (where
test runners print their summary), not the beginning. The implement
workflows' link step MUST NOT depend on headless `specship_link_assert`
calls: it MUST record links in the spec's `implementations:` / `verifies:`
blocks and run `specship sync`, and, when the verify step produced a test
report, ingest it with `specship verify --report`.

implementations:
  - src/workflows/runners/bash.ts:BashRunner.run
  - src/workflows/executor.ts:WorkflowExecutor
  - src/workflows/defaults/spec-implement.yaml
  - src/workflows/defaults/spec-implement-mixed.yaml

verifies:
  - __tests__/workflow-durable-evidence.test.ts:failedBashKeepsOutputTail
  - __tests__/workflow-durable-evidence.test.ts:failedStepOutputIsStored
  - __tests__/workflow-discovery.test.ts:linkStepUsesSpecBlocksNotLinkAssert

## Acceptance
<!-- id: REQ-PIPETRUST-006.A1 -->
- A bash step that prints a long log and exits non-zero records an error containing the log's last lines, and its full output is available as the step's output.
<!-- id: REQ-PIPETRUST-006.A2 -->
- A failed step's output is persisted in the run record and as an artifact, exactly as a completed step's is.
<!-- id: REQ-PIPETRUST-006.A3 -->
- The bundled implement workflows' link step lists no `specship_link_assert` tool, edits the spec's link blocks, runs `specship sync`, and runs `specship verify --report` when a report file exists.

<!-- id: REQ-PIPETRUST-007 -->
## Pipeline failures MUST be surfaced, not discovered

A `specship pulse` command MUST report pipeline health: the latest release
workflow run's conclusion and whether the published npm version lags the
latest GitHub release or `package.json` (when `gh`/`npm` are available),
failures in the last JIRA auto-publish, and worktrees of merged runs still
on disk. Results MUST be cached under `.specship/` with network checks
bounded in time and skipped offline. The SessionStart summary MUST print one
line per failing item from the cache and stay silent when everything is
healthy. JIRA auto-publish MUST persist its last report so the failure count
is readable without re-running it.

implementations:
  - src/pulse/pulse.ts:computePulse
  - src/pulse/pulse.ts:formatPulseLines
  - src/jira/auto-publish.ts:summarizeAutoPublishReport

verifies:
  - __tests__/pulse.test.ts:npmLaggingReleaseIsFlagged
  - __tests__/pulse.test.ts:failedReleaseRunIsFlagged
  - __tests__/pulse.test.ts:jiraPublishFailuresAreFlagged
  - __tests__/pulse.test.ts:mergedRunWorktreesAreFlagged
  - __tests__/pulse.test.ts:healthyPulseIsSilent
  - __tests__/pulse.test.ts:offlineSkipsNetworkChecks

## Acceptance
<!-- id: REQ-PIPETRUST-007.A1 -->
- When the latest GitHub release or `package.json` version is newer than the published npm version, pulse reports the lag with both versions.
<!-- id: REQ-PIPETRUST-007.A2 -->
- When the latest release workflow run failed, pulse reports it with the run's date and failing step if known.
<!-- id: REQ-PIPETRUST-007.A3 -->
- When the last JIRA auto-publish recorded failures, pulse reports the count.
<!-- id: REQ-PIPETRUST-007.A4 -->
- Worktrees whose run branch is merged into the default branch are reported with a purge hint.
<!-- id: REQ-PIPETRUST-007.A5 -->
- With every check healthy, pulse output and the SessionStart summary add no lines.
<!-- id: REQ-PIPETRUST-007.A6 -->
- When `gh` or `npm` is unavailable or the network check exceeds its time budget, those checks are reported as skipped and never fail or stall the session start.
