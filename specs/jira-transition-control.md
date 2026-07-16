---
id: JIRATRANS-DOC
title: First-class JIRA transition control and visibility
owner: core
priority: medium
version: 1
brief: jira-generic-transition/brief.md
---

<!-- id: JIRATRANS-DOC -->
# First-class JIRA transition control and visibility

Today SpecShip moves a JIRA issue only as a side-effect of `jira_start`
(→ In Progress) and workflow completion (→ In Review). There is no way to
transition a tracked issue to an arbitrary state, and a configured transition
the project's workflow doesn't offer is skipped almost silently. Both were
proven live on TSHIP-2: reaching Done required driving `JiraClient` directly,
and the completion push to "In Review" skipped with no visible notice because
that project's workflow has only To Do / In Progress / Done. This document adds
a first-class transition capability and makes unmatched configured transitions
visible. All JIRA writes reuse the existing credentialed seam and its guards,
and every transition keeps `transitionIssue`'s skip-tolerant contract
(REQ-JIRA-007.A3): a target the workflow doesn't offer is reported, never thrown.

<!-- id: REQ-JIRATRANS-001 -->
## SpecShip MUST expose a first-class capability to transition a tracked JIRA issue

A `specship_jira_transition` MCP tool and a `specship jira transition <key>
[state]` CLI accept an issue key and a target state name (or id), resolve it
against the issue's live available transitions, and apply it. With no target (or
a `--list` flag) they return the issue's currently available transition names so
the user can see what the workflow offers. A target the workflow doesn't offer is
reported as a skip naming the available states — it writes nothing and never
throws. Auth/host faults surface the client's existing credential-free error.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraTransition
  - src/jira/client.ts:JiraClient.transitionIssue
  - src/jira/client.ts:JiraClient.listTransitions

## Acceptance
<!-- id: REQ-JIRATRANS-001.A1 -->
- `specship jira transition PROJ-1 "In Progress"` applies the transition and
  reports the state it moved to.
<!-- id: REQ-JIRATRANS-001.A2 -->
- The `specship_jira_transition` MCP tool performs the same transition for an
  agent, returning the applied state.
<!-- id: REQ-JIRATRANS-001.A3 -->
- Invoked with no target state (or `--list`), it returns the issue's available
  transition names.
<!-- id: REQ-JIRATRANS-001.A4 -->
- A target the issue's workflow doesn't offer returns a skip that names the
  available states, writes nothing, and does not throw.
<!-- id: REQ-JIRATRANS-001.A5 -->
- An unreachable or unauthorized host surfaces the client's credential-free
  error and writes nothing.

<!-- id: REQ-JIRATRANS-002 -->
## SpecShip MUST surface a configured lifecycle transition its workflow can't fire, not skip it silently

When a configured lifecycle transition (`inProgress` / `inReview` / `done`)
cannot be matched on an issue's live workflow, SpecShip surfaces an actionable
notice — at `specship jira test` (validating each configured name against a
sampled issue's transitions) and in the completion/status-push output — that
names the unmatched transition and lists the states the workflow actually
offers. The graceful skip is preserved; only its visibility changes.

implementations:
  - src/mcp/jira-tools.ts:validateConfiguredTransitions
  - src/jira/config.ts:resolveJiraCredentials
  - src/mcp/jira-tools.ts:pushJiraReviewStatus

## Acceptance
<!-- id: REQ-JIRATRANS-002.A1 -->
- `specship jira test` reports, per configured transition, whether it exists on
  a sampled issue's workflow, listing the available states when a name is
  unmatched.
<!-- id: REQ-JIRATRANS-002.A2 -->
- A completion/status push that skips a transition names both the missing
  transition and the available states in its surfaced note, not only a buried
  log line.
<!-- id: REQ-JIRATRANS-002.A3 -->
- When every configured transition resolves, validation reports OK with no
  extra noise.
<!-- id: REQ-JIRATRANS-002.A4 -->
- Validation that cannot read any transitions (no accessible issue) reports
  "couldn't verify" rather than a false "missing", and never throws.
