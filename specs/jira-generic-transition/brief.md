---
slug: jira-generic-transition
created: 2026-07-16
label: jira
---
# Generic JIRA transition capability (MCP tool + CLI)

SpecShip can only move a JIRA issue as a side-effect of `jira_start` (→ In
Progress) and workflow completion (→ In Review). There is no way to transition a
tracked issue to an arbitrary available state — so a user can't move an issue
back to To Do, or reach Done without a full implementation run. The underlying
`JiraClient.transitionIssue` + `listTransitions` already exist and work (proven
live driving TSHIP-2 To Do → In Progress → Done → To Do). Expose a first-class
`specship_jira_transition` MCP tool and a `specship jira transition <key> <state>`
CLI that list/apply the issue's available transitions, degrading gracefully
(skip, never throw) when the target isn't offered.

## Grounding
- src/jira/client.ts:JiraClient.transitionIssue
- src/jira/client.ts:JiraClient.listTransitions
- src/mcp/jira-tools.ts:jiraToolDefinitions
- src/bin/specship.ts
