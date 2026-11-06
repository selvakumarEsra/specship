---
id: WFGATE-DOC
title: Workflow step timing and verify test reports
owner: workflows
priority: medium
version: 1
epicKey: SSHIP-847
jira_issue_REQ-WFGATE-001: SSHIP-848
jira_fingerprint_REQ-WFGATE-001: f265f4833e890060
jira_issue_REQ-WFGATE-002: SSHIP-854
jira_fingerprint_REQ-WFGATE-002: 1ff2f6c32dea4c19
---

<!-- id: WFGATE-DOC -->
# Workflow step timing and verify test reports

Workflow runs can pause or fail at individual steps, and the verify step
produces a test report. The run view (REQ-DESKTOP-023) already shows each
step's progression and the run's timestamped event stream. This document
covers what it still lacks: each step's own timing and an approval pause
shown on the step, plus access to the verify step's test report.

Terms: a **step** is any node of a workflow run. An **approval gate** is a
step that pauses the run for a human decision. The **verify step** is the
step that builds the project and runs its tests.

Step history and the verify report MUST stay visible for as long as the run
is listed. Rejecting a run parks it and keeps its artifacts, and purging a run
removes only its worktree. Neither removes the run's events or its artifacts.

Non-goals: no new run states, no change to how steps execute, no test-report
formats other than the vitest JSON report the verify step already writes, and
no ingest of the report into spec links (that stays `specship verify
--report`).

<!-- id: REQ-WFGATE-001 -->
## The run view MUST show each step's own timing and status, separate from the run's status

Building on REQ-DESKTOP-023, each step in the run view MUST show its own
status, its start time, and its finish time and duration once it has ended,
all taken from that run's recorded step events. An approval gate waiting for
a decision MUST show as paused on the step itself. The step's status MUST be
shown apart from the run's overall status, so a failed step in a run that was
later resumed, or a skipped step in a completed run, reads correctly.

implementations:
  - ui/src/components/run-detail.tsx:deriveNodeViews
  - ui/src/components/run-detail.tsx:RunDetail
  - ui/src/components/run-detail.tsx:StepTiming
  - ui/src/components/run-detail.tsx:fmtClock
  - ui/src/components/run-detail.tsx:NodeView
  - ui/src/App.tsx:App

verifies:
  - e2e/tests/run-step-timing.spec.ts:reqWfgate001A1
  - e2e/tests/run-step-timing.spec.ts:reqWfgate001A2
  - e2e/tests/run-step-timing.spec.ts:reqWfgate001A3
  - e2e/tests/run-step-timing.spec.ts:reqWfgate001A4
  - e2e/tests/run-step-timing.spec.ts:reqWfgate001A5

## Acceptance
<!-- id: REQ-WFGATE-001.A1 -->
- For a run with several steps, the run view lists the steps in execution
  order, and each step shows its own status.
<!-- id: REQ-WFGATE-001.A2 -->
- A step that has started shows its start time. A step that has ended also
  shows its finish time and duration, and both match that step's recorded
  events.
<!-- id: REQ-WFGATE-001.A3 -->
- With two runs of the same workflow in progress at once, each run's view
  shows only the step times and statuses from its own events.
<!-- id: REQ-WFGATE-001.A4 -->
- An approval gate awaiting a decision shows as paused, and a failed step and
  a skipped step each look different from a completed step.
<!-- id: REQ-WFGATE-001.A5 -->
- A step that has not started shows no start or finish time, not a time
  borrowed from the run or another step.

<!-- id: REQ-WFGATE-002 -->
## The run view MUST give access to the verify step's test report and its outcome

When the verify step writes a test report, the run view MUST offer that
report from the same run's verify step and show its outcome: passed or
failed, with the passed, failed and skipped test counts. When a run's verify
step has run more than once (the run was resumed), the view MUST show the
report from the latest attempt. A report that is missing or unreadable MUST be
shown as unavailable or unreadable, and MUST NOT be shown as passing. When the
report and the verify step's own result disagree, the view MUST show the
outcome as failed and say that the two disagree.

implementations:
  - server/src/routes/workflow.ts:registerWorkflowRoutes
  - ui/src/components/run-detail.tsx:RunDetail

## Acceptance
<!-- id: REQ-WFGATE-002.A1 -->
- A run whose verify step wrote a report shows that report, with its outcome
  and test counts, from that run's verify step.
<!-- id: REQ-WFGATE-002.A2 -->
- Two runs with different reports each show only their own report.
<!-- id: REQ-WFGATE-002.A3 -->
- A verify step that wrote no report shows an explicit unavailable state and
  no passing outcome. This covers a project that isn't a vitest project
  (cargo, pytest), no recognised test framework (tests skipped), and a build
  or environment failure before the tests ran.
<!-- id: REQ-WFGATE-002.A4 -->
- A report that is truncated or isn't valid JSON shows as unreadable, not as
  passing.
<!-- id: REQ-WFGATE-002.A5 -->
- The outcome shown matches the report, including when the suite fails. When
  the report shows every test passing but the verify step failed, the view
  shows failed and notes the disagreement.
<!-- id: REQ-WFGATE-002.A6 -->
- After a resumed run reruns its verify step, the view shows the latest
  attempt's report.
<!-- id: REQ-WFGATE-002.A7 -->
- After the run is purged, its report is still shown.

Test plan: REQ-WFGATE-001.A1–A5 are proven by the Playwright suite in
`e2e/tests/run-step-timing.spec.ts`, which stubs the workflow API with fixed
event timestamps. Fast unit cases for `deriveNodeViews` timing live in
`ui/src/__tests__/runs-detail.test.tsx` but don't count as e2e evidence.
REQ-WFGATE-002's tests don't exist yet: its UI criteria (A1–A6) need e2e
specs of the same kind, and the report route (A1–A4 and A7) belongs in a
server route test. Its `verifies:` block gets added when those are written.
