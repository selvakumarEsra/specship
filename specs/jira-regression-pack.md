---
id: JIRA-REGRESSION-DOC
title: Domain-organised regression test pack in JIRA
owner: core
priority: high
version: 1
---

<!-- id: JIRA-REGRESSION-DOC -->
# Domain-organised regression test pack in JIRA

The durable, re-runnable half of verification. The existing chain proves a
feature at the moment it ships (criterion evidence, milestone comments,
coverage); nothing accumulates those proofs into an asset a tester can
re-execute before a release. This document adds one: a **regression pack**
maintained by SpecShip inside the bound JIRA project, derived from the
acceptance criteria of every implemented requirement across all epics, and
organised by the project's **domain knowledge** — business-language areas,
not epics or file paths — so it reads and runs as black-box testing by
someone who never saw the code.

Design decisions (settled 2026-08-02):

- **Plain JIRA issues, no test plugin.** One *Regression Pack* epic per
  bound project; one Story per domain area; one Sub-task per regression
  case. Works on Cloud and Data Center without Xray/Zephyr; a test-entity
  adapter MAY come later.
- **Human-first, agent-optional.** Cases are written in user-visible
  Given/When/Then so any tester executes them in JIRA; where the behaviour
  harness has a matching E2E test the agent can run it and record the result
  on the same case.
- **Implemented+ scope, gap-prompted.** Only criteria of implemented or
  verified requirements enter the pack. A requirement with no domain-fact
  link lands in an *Uncategorised* area and surfaces as a domain gap — the
  pack drives domain capture instead of hiding its absence.
- **Reuses existing machinery.** Issue creation/upsert, watermarked
  edit-in-place comments, fingerprints, milestone discipline, the behaviour
  surface, and the `validates` link kind — no parallel state machine.

Non-goals: test-management plugin entities (Xray/Zephyr) in v1, load or
performance testing, cross-project packs, and scheduling/CI orchestration of
pack runs (the pack is runnable by whoever opens it; when it runs is the
team's business).

<!-- id: REQ-JIRAREG-001 -->
## The regression pack MUST exist in JIRA as an epic → domain-area → case hierarchy

The bound project carries exactly one SpecShip-maintained *Regression Pack*
epic. Under it, one Story per domain area, and under each Story one Sub-task
per regression case. Each case is derived from one acceptance criterion of an
implemented (or verified) requirement and is traceable both ways: the case
names its `REQ-*.A<N>` source, and the criterion's spec records the case's
issue key.

implementations:
  - src/jira/regression-pack.ts:buildRegressionPack
  - src/jira/regression-pack.ts:upsertRegressionPack
  - src/jira/regression-pack.ts:renderCaseSteps
  - src/jira/spec-writer.ts:writeRegressionCaseKeys
  - src/jira/client.ts:JiraClient.searchIssuesByLabel
  - src/mcp/jira-tools.ts:handleSpecshipJiraRegressionPack

## Acceptance
<!-- id: REQ-JIRAREG-001.A1 -->
- Generating the pack on a bound project creates (or finds) exactly one
  watermarked Regression Pack epic; re-generating never creates a second.
<!-- id: REQ-JIRAREG-001.A2 -->
- Every implemented requirement's acceptance criterion yields exactly one
  case Sub-task under its domain-area Story, titled with its `REQ-*.A<N>` id
  and criterion summary.
<!-- id: REQ-JIRAREG-001.A3 -->
- A case's description names its source criterion id and spec; the spec side
  records the case's issue key, so trace works in both directions.
<!-- id: REQ-JIRAREG-001.A4 -->
- Criteria of authored-but-unimplemented requirements produce no case; they
  enter the pack only after the requirement reaches implemented.

<!-- id: REQ-JIRAREG-002 -->
## Cases MUST be organised by domain knowledge, with gaps surfaced not hidden

The pack's areas come from the project's domain facts: a requirement's cases
file under the domain area(s) its spec links to (directly or through the
spec-tier inheritance chain). A requirement with no domain linkage files
under a single *Uncategorised* area, and generating the pack reports those
requirements as domain gaps with the capture hand-off — organising the pack
is also how the domain vocabulary gets completed.

implementations:
  - src/jira/regression-pack.ts:buildRegressionPack
  - src/jira/regression-pack.ts:computeDomainAreasByReqId
  - src/jira/regression-pack.ts:groupCasesByDomain
  - src/jira/regression-pack.ts:renderCrossReferenceBody
  - src/jira/regression-pack.ts:renderDomainGapReport
  - src/jira/regression-pack.ts:upsertLabelledIssue
  - src/jira/client.ts:JiraClient.updateIssue
  - src/resolution/spec-link-resolver.ts:sourceSpecIds

verifies:
  - __tests__/jira/regression-pack.test.ts

## Acceptance
<!-- id: REQ-JIRAREG-002.A1 -->
- A requirement linked to a domain fact files its cases under that fact's
  area Story; a requirement linked to two facts files under both, with the
  duplicate marked as a cross-reference rather than a second executable case.
<!-- id: REQ-JIRAREG-002.A2 -->
- A requirement with no domain linkage files under *Uncategorised*, and the
  generation report lists it as a domain gap naming the capture flow
  (`/specship:spec domain`).
<!-- id: REQ-JIRAREG-002.A3 -->
- After a domain fact is captured and linked, the next pack update moves the
  affected cases from *Uncategorised* to the new area without duplicating
  them.

<!-- id: REQ-JIRAREG-003 -->
## Pack maintenance MUST be idempotent — create, update, obsolete, never lose history

The pack updates the same way specs publish: fingerprint-gated upsert. A new
criterion adds a case; a changed criterion updates its case in place; a
retired or superseded criterion marks its case obsolete (it is never
deleted, so past run history survives). Re-running maintenance with nothing
changed performs no JIRA write.

implementations:
  - src/jira/regression-pack.ts:upsertRegressionPack
  - src/jira/regression-pack.ts:findOrphanedCases
  - src/jira/regression-pack.ts:markCaseObsolete
  - src/jira/client.ts:JiraClient.addLabel
  - src/jira/publish.ts:issueContentFingerprint
  - src/jira/publish.ts:upsertWatermarkedComment

verifies:
  - __tests__/jira/regression-pack.test.ts

## Acceptance
<!-- id: REQ-JIRAREG-003.A1 -->
- Adding an acceptance criterion to an implemented requirement and updating
  the pack creates exactly one new case; nothing else changes.
<!-- id: REQ-JIRAREG-003.A2 -->
- Editing a criterion's text updates its existing case in place — same issue
  key, refreshed steps — never a duplicate case.
<!-- id: REQ-JIRAREG-003.A3 -->
- Removing a criterion (or superseding its spec) marks the case obsolete
  with the reason; the issue and its run history remain.
<!-- id: REQ-JIRAREG-003.A4 -->
- Running maintenance twice in a row performs zero JIRA writes on the second
  run.

<!-- id: REQ-JIRAREG-004 -->
## Cases MUST read as black-box tests a non-developer can execute

A case's steps are phrased in user-visible Given/When/Then derived from the
criterion text and its requirement's context — no file paths, symbol names,
or internal identifiers in the executable steps. Each case is tagged with its
tier from the behaviour surface (UI, or backend/API) so a tester knows where
to exercise it, and carries the observable expected outcome as the pass
condition.

implementations:
  - src/jira/regression-pack.ts:renderCaseSteps
  - src/behaviour/behaviour-surface.ts:computeBehaviourSurface

## Acceptance
<!-- id: REQ-JIRAREG-004.A1 -->
- A generated case's steps contain no source file path or code symbol; the
  traceability ids (`REQ-*.A<N>`) appear only in the reference section, not
  in the executable steps.
<!-- id: REQ-JIRAREG-004.A2 -->
- Every case carries a UI or backend/API tier tag derived from the
  requirement's behaviour surface; a requirement with no UI surface never
  yields a UI-tagged case.
<!-- id: REQ-JIRAREG-004.A3 -->
- Every case states an observable expected outcome as its pass condition —
  a case whose criterion yields no observable outcome is flagged for human
  rephrasing instead of being emitted vague.

<!-- id: REQ-JIRAREG-005 -->
## Pack runs MUST record results in JIRA and feed them back as validates evidence

A pack run — human or agent — records each executed case's pass/fail on the
case issue, and the result flows back into the graph as a `validates`-kind
link on the source criterion, so regression standing is queryable beside
implementation and test evidence. Where the behaviour harness has an E2E
test matching a case, the agent MAY execute it and record the result on the
same case; a failed case surfaces with a triage hand-off. A run closes with
one watermarked, edited-in-place summary comment on the pack epic (executed
/ passed / failed / obsolete counts).

implementations:
  - src/jira/regression-pack.ts:recordRunResult
  - src/jira/milestone-comment.ts:postMilestoneComment

## Acceptance
<!-- id: REQ-JIRAREG-005.A1 -->
- Recording a case pass or fail updates the case issue and produces a
  `validates`-kind link (or updates the existing one) on the source
  criterion, visible in the spec's linked code.
<!-- id: REQ-JIRAREG-005.A2 -->
- Where a case's criterion has a linked behaviour-harness test, the agent
  can execute it and record the outcome on the same case — one case, one
  result, regardless of who ran it.
<!-- id: REQ-JIRAREG-005.A3 -->
- A failed case names the triage hand-off (`/specship:spec triage`) with the
  criterion id; a suite that cannot run reports the case unexecuted and
  never records a failure.
<!-- id: REQ-JIRAREG-005.A4 -->
- A run produces exactly one summary comment on the pack epic, edited in
  place on the next run — executed, passed, failed, and obsolete counts.
