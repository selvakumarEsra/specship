---
slug: jira-transition-name-validation
created: 2026-07-16
spec: JIRATRANS-DOC
label: jira
---
# Surface configured JIRA transition-name mismatches instead of silently skipping

The configured lifecycle transitions (`SPECSHIP_JIRA_TRANSITION_IN_PROGRESS/
IN_REVIEW/DONE`, defaults In Progress/In Review/Done) are matched against the
issue's live workflow at push time; a name the workflow doesn't offer is skipped
silently-ish (only noted deep in a completion log). Proven live on TSHIP-2: the
project has no "In Review" state, so the completion push silently skipped and the
issue never advanced. Validate the configured transition names against the live
workflow at a visible moment (`jira configure` / `jira test`, and/or pick/start)
and warn the user which configured transitions won't fire, listing the states
the workflow actually offers — turning a silent skip into an actionable notice.

## Grounding
- src/jira/config.ts:resolveJiraCredentials
- src/jira/client.ts:JiraClient.transitionIssue
- src/jira/client.ts:JiraClient.listTransitions
- src/mcp/jira-tools.ts:pushJiraReviewStatus
