---
id: THROUGHPUT-DOC
title: Throughput — parallel runs, fewer gates, less surface (0.31)
owner: specship-core
priority: medium
version: 1
jira_issue_REQ-THRU-001: SSHIP-434
jira_fingerprint_REQ-THRU-001: a9e0550adb32d4ee
jira_issue_REQ-THRU-002: SSHIP-438
jira_fingerprint_REQ-THRU-002: f2d697869491548b
jira_issue_REQ-THRU-003: SSHIP-443
jira_fingerprint_REQ-THRU-003: 78b4275a7b1dc945
jira_issue_REQ-THRU-004: SSHIP-448
jira_fingerprint_REQ-THRU-004: a9c074de75af0dce
jira_issue_REQ-THRU-005: SSHIP-452
jira_fingerprint_REQ-THRU-005: ec5e5641334faa60
jira_issue_REQ-THRU-006: SSHIP-456
jira_fingerprint_REQ-THRU-006: 536d23ddd86596bb
jira_issue_REQ-THRU-007: SSHIP-460
jira_fingerprint_REQ-THRU-007: 149ea3e3adc3e502
jira_issue_REQ-THRU-008: SSHIP-464
jira_fingerprint_REQ-THRU-008: ba664d3440547212
jira_issue_REQ-THRU-009: SSHIP-467
jira_fingerprint_REQ-THRU-009: 7e23c433eff7772b
jira_issue_REQ-THRU-010: SSHIP-471
jira_fingerprint_REQ-THRU-010: b2ec80bcbb5264b2
jira_issue_REQ-THRU-011: SSHIP-474
jira_fingerprint_REQ-THRU-011: 570634fb70a9272a
jira_issue_REQ-THRU-012: SSHIP-477
jira_fingerprint_REQ-THRU-012: 2182df356040399e
---

<!-- id: THROUGHPUT-DOC -->
# Throughput — parallel runs, fewer gates, less surface (0.31)

With 0.29 making each run trustworthy and 0.30 making knowledge persist, the
remaining cost is elapsed time and surface area. On 2026-10-26 three
independent Gemini requirements ran one after another, each pausing for a
plan approval; a config fix silently created ~80 JIRA issues through
auto-publish on `sync`; two workflow files duplicated the same bash; merged
run worktrees accumulated; and the adversarial reviewer graded criteria but
never tried to break them.

This document adds parallel runs with a merge queue, opt-in auto-approval of
small plans, one source for workflow variants, durable `link_assert`, an
explicit JIRA publish, worktree garbage collection, reviewer probes, a
two-way story↔criterion trace, the mutation gate in postcheck, host smoke
tests, and a measure-before-claim rule for Gemini parity. Gemini slash
commands are delivered by REQ-GEMINI-005 (GEMINI-TARGET-DOC), not respecified
here.

Non-goals: distributed or cloud execution of runs; changing the final human
review gate, which always stays.

<!-- id: REQ-THRU-001 -->
## Independent requirements MUST be implementable in parallel

`specship workflow run-batch <workflow> --specs <ID,ID,…>` MUST start one run
per requirement, each in its own worktree, with a concurrency limit
(`--concurrency`, default 3). Requirements whose `implementations:` files
overlap MUST NOT run concurrently with each other — the later one waits for
the earlier to finish. The command MUST print each run id and the
serialization it chose.

implementations:
  - src/workflows/batch.ts:planBatch
  - src/workflows/batch.ts:runBatch

verifies:
  - __tests__/workflow-batch.test.ts:disjointSpecsRunConcurrently
  - __tests__/workflow-batch.test.ts:overlappingSpecsAreSerialized
  - __tests__/workflow-batch.test.ts:concurrencyLimitIsRespected

## Acceptance
<!-- id: REQ-THRU-001.A1 -->
- Three requirements with disjoint `implementations:` files are scheduled in one wave when concurrency allows.
<!-- id: REQ-THRU-001.A2 -->
- Two requirements sharing an implementation file are placed in different waves, in the order given.
<!-- id: REQ-THRU-001.A3 -->
- No wave holds more runs than `--concurrency`.

<!-- id: REQ-THRU-002 -->
## Completed runs MUST merge through a queue that re-checks each merge

`specship workflow merge-queue <runId…>` MUST merge each completed run's
branch into the current branch in the given order, re-running the project's
quality command after each merge, and MUST stop at the first merge conflict
or failing check — leaving the tree at the last good merge and naming the
run that stopped it. Runs that are not completed are refused.

implementations:
  - src/workflows/merge-queue.ts:runMergeQueue

verifies:
  - __tests__/workflow-merge-queue.test.ts:cleanRunsMergeInOrder
  - __tests__/workflow-merge-queue.test.ts:conflictStopsAtLastGoodMerge
  - __tests__/workflow-merge-queue.test.ts:failingCheckStopsTheQueue
  - __tests__/workflow-merge-queue.test.ts:incompleteRunIsRefused

## Acceptance
<!-- id: REQ-THRU-002.A1 -->
- Two non-conflicting run branches are both merged, in order, with the quality command run after each.
<!-- id: REQ-THRU-002.A2 -->
- A conflicting second branch stops the queue with the first merge kept and no conflict markers left in the tree.
<!-- id: REQ-THRU-002.A3 -->
- A merge after which the quality command fails stops the queue and is undone.
<!-- id: REQ-THRU-002.A4 -->
- A run that is not completed is refused before any merge happens.

<!-- id: REQ-THRU-003 -->
## Small plans MAY be auto-approved when the project opts in

When `specship.config.json` sets `workflow.autoApproveSmallPlans: true`, the
implement workflows MUST skip the plan approval for a plan that touches only
files already named in the requirement's `implementations:` blocks and whose
requirement has at most `workflow.smallPlanMaxCriteria` (default 3)
criteria. Every other plan, and every final review, still waits for a human.
Without the setting, behaviour is unchanged.

implementations:
  - src/spec-quality/plan-scope.ts:assessPlanScope
  - src/workflows/defaults/spec-implement.yaml

verifies:
  - __tests__/plan-scope.test.ts:inScopeSmallPlanIsAutoApprovable
  - __tests__/plan-scope.test.ts:outOfScopeFileNeedsApproval
  - __tests__/plan-scope.test.ts:tooManyCriteriaNeedsApproval
  - __tests__/plan-scope.test.ts:withoutOptInAlwaysNeedsApproval
  - __tests__/workflow-discovery.test.ts:finalReviewIsNeverSkipped

## Acceptance
<!-- id: REQ-THRU-003.A1 -->
- With the opt-in, a plan naming only already-linked files for a requirement with ≤3 criteria is auto-approved.
<!-- id: REQ-THRU-003.A2 -->
- A plan naming any file outside the requirement's `implementations:` blocks still needs approval.
<!-- id: REQ-THRU-003.A3 -->
- A requirement with more criteria than the limit still needs approval.
<!-- id: REQ-THRU-003.A4 -->
- Without the opt-in every plan needs approval, and the final review is never skipped in either case.

<!-- id: REQ-THRU-004 -->
## Workflow variants MUST be generated from one source

A workflow file MAY declare `extends: <workflow>` plus `node_overrides`
(per-node field overrides such as `model`). The loader MUST resolve it into
a full workflow. The bundled `spec-implement-mixed` MUST be expressed this
way over `spec-implement`, so a change to a shared node is made once.

implementations:
  - src/workflows/discovery.ts:resolveExtends
  - src/workflows/defaults/spec-implement-mixed.yaml

verifies:
  - __tests__/workflow-extends.test.ts:extendsInheritsAndOverrides
  - __tests__/workflow-extends.test.ts:unknownBaseIsAnError
  - __tests__/workflow-extends.test.ts:mixedMatchesBaseExceptModels

## Acceptance
<!-- id: REQ-THRU-004.A1 -->
- A workflow extending another inherits all its nodes and applies `node_overrides` to the named nodes only.
<!-- id: REQ-THRU-004.A2 -->
- Extending an unknown workflow is a load error naming it.
<!-- id: REQ-THRU-004.A3 -->
- The resolved `spec-implement-mixed` equals `spec-implement` except for its declared model overrides.

<!-- id: REQ-THRU-005 -->
## `specship_link_assert` MUST persist links into the spec file

An `implements` or `tests` link asserted through `specship_link_assert` MUST
also be written into the requirement's `implementations:` / `verifies:` block
in its spec file (once, idempotently), so it survives a full reindex. A
target that is not a resolvable `path:Symbol` is refused without editing the
file.

implementations:
  - src/spec-quality/link-persist.ts:persistLinkToSpecFile

verifies:
  - __tests__/link-persist.test.ts:assertedLinkIsWrittenToSpecBlock
  - __tests__/link-persist.test.ts:repeatAssertIsIdempotent
  - __tests__/link-persist.test.ts:unresolvableTargetIsRefused

## Acceptance
<!-- id: REQ-THRU-005.A1 -->
- Asserting an implements link adds one `path:Symbol` bullet under the requirement's `implementations:` block, creating the block if absent.
<!-- id: REQ-THRU-005.A2 -->
- Asserting the same link again leaves the file byte-identical.
<!-- id: REQ-THRU-005.A3 -->
- A target with no symbol, or a symbol absent from the file, is refused and the spec file is untouched.

<!-- id: REQ-THRU-006 -->
## JIRA auto-publish on sync MUST be explicit opt-in

`specship sync` MUST NOT publish to JIRA unless `jira.autoPublish: true` is
set in `specship.config.json`. Without it, sync MUST report how many specs
are pending publication, and `specship jira publish --pending` MUST publish
them in one explicit batch.

implementations:
  - src/jira/auto-publish.ts:runAutoPublish
  - src/jira/repo-config.ts:readRepoJiraBinding

verifies:
  - __tests__/jira-auto-publish-optin.test.ts:boundRepoWithoutOptInDoesNotPublish
  - __tests__/jira-auto-publish-optin.test.ts:optInPublishesOnSync
  - __tests__/jira-auto-publish-optin.test.ts:pendingCountIsReported

## Acceptance
<!-- id: REQ-THRU-006.A1 -->
- A bound repo without `jira.autoPublish: true` makes no JIRA write during sync.
<!-- id: REQ-THRU-006.A2 -->
- With `jira.autoPublish: true`, sync publishes as before.
<!-- id: REQ-THRU-006.A3 -->
- Without the opt-in, sync reports the number of specs pending publication.

<!-- id: REQ-THRU-007 -->
## Worktrees of merged runs MUST be collectable

`specship workflow gc` MUST purge the worktree of every run whose branch is
merged into the default branch, keep run records and artifacts, and leave
unmerged runs untouched; `--dry-run` lists what it would remove.

implementations:
  - src/workflows/gc.ts:collectMergedRuns

verifies:
  - __tests__/workflow-gc.test.ts:mergedRunWorktreeIsPurged
  - __tests__/workflow-gc.test.ts:unmergedRunIsKept
  - __tests__/workflow-gc.test.ts:dryRunRemovesNothing

## Acceptance
<!-- id: REQ-THRU-007.A1 -->
- A run whose branch is merged into the default branch has its worktree removed and its record kept.
<!-- id: REQ-THRU-007.A2 -->
- A run whose branch is not merged keeps its worktree.
<!-- id: REQ-THRU-007.A3 -->
- `--dry-run` lists the candidates and removes nothing.

<!-- id: REQ-THRU-008 -->
## The adversarial reviewer MUST try to break the change, without touching it

The implement workflows' adversarial review MUST attempt at least one failing
probe per acceptance criterion — a small test written under
`.specship/review-probes/` and run — and report each probe as `held` or
`broke` in the final review. A bash step after the review MUST fail the run
if the review modified any tracked file.

implementations:
  - src/workflows/defaults/spec-implement.yaml

verifies:
  - __tests__/workflow-discovery.test.ts:reviewWritesProbesNotTrackedFiles

## Acceptance
<!-- id: REQ-THRU-008.A1 -->
- The adversarial review prompt requires a probe per criterion under `.specship/review-probes/` and a held/broke verdict for each.
<!-- id: REQ-THRU-008.A2 -->
- A guard step after the review fails when tracked files differ from before the review.

<!-- id: REQ-THRU-009 -->
## The story↔criterion trace MUST be checked in both directions

The JIRA reconcile report MUST also list acceptance criteria with no matching
sub-task and criteria matched by more than one sub-task, in addition to
today's sub-tasks with no matching criterion.

implementations:
  - src/jira/reconcile.ts:diffIssueVsSpec

verifies:
  - __tests__/jira-trace.test.ts:criterionWithoutSubtaskIsReported
  - __tests__/jira-trace.test.ts:duplicateSubtasksAreReported
  - __tests__/jira-trace.test.ts:fullyMappedReportsNothingNew

## Acceptance
<!-- id: REQ-THRU-009.A1 -->
- A criterion with no sub-task of matching summary is reported as missing a sub-task.
<!-- id: REQ-THRU-009.A2 -->
- A criterion matched by two sub-tasks is reported as duplicated.
<!-- id: REQ-THRU-009.A3 -->
- A one-to-one mapped issue reports no missing or duplicate entries.

<!-- id: REQ-THRU-010 -->
## Postcheck MUST apply the mutation gate when the project configures it

When `enforce.mutation` is configured, `specship postcheck` MUST run the
existing mutation-score gate for the requirement and fail when its linked
implementation files score below the threshold; without the configuration
the check does not run.

implementations:
  - src/spec-quality/postcheck.ts:runPostcheck
  - src/enforce/mutation.ts

verifies:
  - __tests__/spec-postcheck.test.ts:lowMutationScoreFailsPostcheck
  - __tests__/spec-postcheck.test.ts:noMutationConfigSkipsTheCheck

## Acceptance
<!-- id: REQ-THRU-010.A1 -->
- With mutation configured and a report scoring the requirement's files below threshold, postcheck fails naming the score.
<!-- id: REQ-THRU-010.A2 -->
- Without mutation configuration, postcheck output has no mutation check.

<!-- id: REQ-THRU-011 -->
## Each agent target MUST have an install-and-hook smoke test

For each installer target, an integration test MUST install into a temporary
home, feed recorded hook payloads to the installed hook commands, and assert
the host-shaped output — so a target's wiring is exercised end to end without
a live model.

verifies:
  - __tests__/host-smoke.test.ts:claudeTargetSmoke
  - __tests__/host-smoke.test.ts:geminiTargetSmoke

## Acceptance
<!-- id: REQ-THRU-011.A1 -->
- The Claude target smoke test installs, runs the prompt and search hook commands with Claude payloads, and gets Claude-shaped output naming `mcp__specship__specship_explore`.
<!-- id: REQ-THRU-011.A2 -->
- The Gemini target smoke test installs, runs the BeforeAgent and BeforeTool hook commands with Gemini payloads, and gets Gemini-shaped output naming `specship_explore`, including a top-level deny under strict mode for `grep_search`.

<!-- id: REQ-THRU-012 -->
## Gemini retrieval parity MUST be measured before it is claimed

User-facing docs MUST NOT claim Gemini CLI retrieval parity with Claude Code
unless a Gemini agent-eval results file exists in the repository; a test MUST
enforce this. [needs review: the eval itself needs Gemini API access and is
run by the maintainer]

verifies:
  - __tests__/docs-claims.test.ts:noGeminiParityClaimWithoutResults

## Acceptance
<!-- id: REQ-THRU-012.A1 -->
- With no Gemini eval results file, README and site docs contain no Gemini parity claim, and the test fails if one is added.
