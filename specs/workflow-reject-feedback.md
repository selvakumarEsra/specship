---
id: WF-REJECT-DOC
title: Workflow reject is feedback, never disposal
owner: specship
priority: high
---

<!-- id: WF-REJECT-DOC -->
# Workflow reject is feedback, never disposal

Rejecting at an approval gate is the most valuable moment in a review loop —
it's where the feedback lives. Today `WorkflowExecutor.reject()` marks the
run `cancelled` and destroys the isolation worktree; the `on_reject` handler
that `ApprovalRunner` captures into the approval context is never invoked;
plan/diff artifacts of the work are gone. Experienced users route around the
Reject button by approving work they want rejected. Decision (2026-07-11
product review, Q7): reject parks, never destroys — and the run's verify
legs stop false-failing. These semantics live in the gate layer that
survives the Q8 orchestration migration.

<!-- id: REQ-WFREJ-001 -->
## Rejecting a gate MUST retain the worktree and artifacts

`reject(runId)` transitions the run to a `rejected` status with its
isolation worktree and artifacts directory intact. Nothing about expressing
an opinion at a gate deletes work product. Parked worktrees are reclaimed by
an explicit purge (REQ-WFREJ-004) or a retention sweep. [needs review:
retention window default — proposal 14 days.]

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.reject

## Acceptance
<!-- id: REQ-WFREJ-001.A1 -->
- After rejecting a paused run, its worktree path still exists and its
  artifacts (plan.md, diff.md, test outputs) remain readable.
<!-- id: REQ-WFREJ-001.A2 -->
- The run lists with status `rejected`, distinct from `cancelled` and
  `failed`.

<!-- id: REQ-WFREJ-002 -->
## `on_reject` MUST fire

When the gate's node declares `on_reject`, rejecting executes it (with the
reject reason available for substitution) before the run parks. The captured
`onReject` in the approval context stops being dead code.

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.reject
  - src/workflows/executor.ts:WorkflowExecutor.resume

## Acceptance
<!-- id: REQ-WFREJ-002.A1 -->
- A workflow whose gate declares `on_reject` runs that node on reject; its
  output lands in the run's artifacts.

<!-- id: REQ-WFREJ-003 -->
## Reject-with-comment MUST seed a revise loop

Reject accepts a comment (as approve already does). A rejected run can be
resumed into revision: the gate's upstream implementing step re-runs in the
same worktree with the reviewer's comment injected, then re-pauses at the
gate. Reviewer → feedback → revision → re-review without abandoning the run.

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.reject

## Acceptance
<!-- id: REQ-WFREJ-003.A1 -->
- Rejecting with a comment, then resuming, re-runs the implement step in the
  same worktree with the comment available to the prompt, and pauses again
  at the same gate.

<!-- id: REQ-WFREJ-004 -->
## Worktree destruction MUST happen only via explicit purge

No status transition (reject, cancel, fail) destroys a worktree as a side
effect. A dedicated purge action (CLI verb and/or run-page action) is the
single destruction path, and it states what it deletes before doing so.

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.purge
  - src/workflows/executor.ts:WorkflowExecutor.cancel

## Acceptance
<!-- id: REQ-WFREJ-004.A1 -->
- Cancelling or rejecting a run leaves its worktree; purging removes it.

<!-- id: REQ-WFREJ-005 -->
## Verify legs MUST NOT false-fail for environmental reasons

The three documented false-fail classes are eliminated at the source: verify
steps run the suite using the bundled Node runtime (never the host default
whose better-sqlite3/FTS5 bindings mismatch), the worktree gets a build
(`dist/`) before any step that needs it, and daemon/watchdog interference is
excluded from the verify environment. A verify failure means the tests
failed, not that the environment was wrong.

implementations:
  - src/workflows/runners/bash.ts:BashRunner.run

## Acceptance
<!-- id: REQ-WFREJ-005.A1 -->
- A spec-implement run against a project whose host Node lacks FTS5 passes
  its verify leg when the tests genuinely pass.
<!-- id: REQ-WFREJ-005.A2 -->
- The verify leg in a fresh worktree does not fail with MODULE_NOT_FOUND on
  the project's own build output.
