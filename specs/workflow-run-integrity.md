---
id: WFINTEG-DOC
title: Workflow runs finish and review the change they made
owner: workflows
priority: high
version: 1
epicKey: SSHIP-583
jira_issue_REQ-WFINTEG-001: SSHIP-632
jira_issue_REQ-WFINTEG-002: SSHIP-633
---

<!-- id: WFINTEG-DOC -->
# Workflow runs finish and review the change they made

Two defects in the bundled `spec-implement` workflow make every run need a
human to finish it, and make its automatic review meaningless:

- The `knowledge_publish` step fails on every run. Its shell script builds a
  file name with `$i.md`, and the engine reads that as a reference to the
  output of a step named `i`, which does not exist (SSHIP-632).
- The `diff` and `diff_stat` steps compare the worktree with `HEAD`. The
  implement step commits its work, so after that commit the comparison is
  empty. The adversarial reviewer and the human final gate both see an empty
  change (SSHIP-633).

**Non-goals.** A general escape syntax for workflow templates; changing how
the implement step decides whether to commit; reviewing changes the run did
not make (commits a person adds to the base branch while the run is open).

**Test plan.** Unit tests on the reference substitution cover
REQ-WFINTEG-001. Tests that run the real bash of the bundled `diff` /
`diff_stat` nodes against a throwaway git repo cover REQ-WFINTEG-002, the same
way `workflow-quality-baseline.test.ts` exercises the quality nodes.

<!-- id: REQ-WFINTEG-001 -->
## Shell text in a step MUST NOT be read as a reference to an unknown step

Substitution in a workflow step MUST treat `$name.field` as a step-output
reference only when `name` is a step of that workflow. Any other `$name.field`
(a shell variable followed by text, such as `$i.md` or `$f.txt`) MUST be left
as written. A reference to a real step with a wrong field (`$plan.outptu`)
MUST still fail the step with an error naming the reference, as it does today.

implementations:
  - src/workflows/condition-evaluator.ts:substituteRefs
  - src/workflows/condition-evaluator.ts:SubstitutionContext
  - src/workflows/executor.ts:WorkflowExecutor.makeSubstitutionContext
  - src/workflows/defaults/spec-implement.yaml
verifies:
  - __tests__/condition-evaluator.test.ts:reqWfinteg001A1
  - __tests__/condition-evaluator.test.ts:reqWfinteg001A2
  - __tests__/condition-evaluator.test.ts:reqWfinteg001A3

## Acceptance
<!-- id: REQ-WFINTEG-001.A1 -->
- A bash step containing `target="$DEST/${base%.md}-$i.md"` in a workflow
  with no step named `i` substitutes to exactly that text.
<!-- id: REQ-WFINTEG-001.A2 -->
- `$plan.outptu` in a workflow that has a `plan` step still fails with an
  `OutputRef` error naming `$plan.outptu`.
<!-- id: REQ-WFINTEG-001.A3 -->
- The bundled `knowledge_publish` step substitutes without error and, run
  against a proposals directory holding a name collision, copies the second
  proposal under a `-2` suffix.

<!-- id: REQ-WFINTEG-002 -->
## The run's diff MUST show the whole change since the run started

The `diff` and `diff_stat` steps MUST compare the worktree against the commit
the run started from (its base), recorded before the implement step edits
anything. The diff MUST include work the implement step committed, work it
left uncommitted, and new untracked files. When the diff is empty but the
worktree differs from the base, or the base was never recorded, the step MUST
fail with a `HALT_CAUSE` instead of handing an empty change to review.

implementations:
  - src/workflows/defaults/spec-implement.yaml
verifies:
  - __tests__/workflow-run-diff.test.ts:reqWfinteg002A1
  - __tests__/workflow-run-diff.test.ts:reqWfinteg002A2
  - __tests__/workflow-run-diff.test.ts:reqWfinteg002A3
  - __tests__/workflow-run-diff.test.ts:reqWfinteg002A4

## Acceptance
<!-- id: REQ-WFINTEG-002.A1 -->
- When the implement step commits a change to `a.ts`, the `diff` output
  contains that change and `diff_stat` lists `a.ts`.
<!-- id: REQ-WFINTEG-002.A2 -->
- Committed edits, uncommitted edits and a new untracked file made in the
  same run all appear in one `diff` output.
<!-- id: REQ-WFINTEG-002.A3 -->
- With no recorded base, `diff` exits non-zero and prints a `HALT_CAUSE`
  line.
<!-- id: REQ-WFINTEG-002.A4 -->
- When the worktree is identical to the base, `diff` succeeds and reports an
  empty change (a run that changed nothing is not an integrity failure).
