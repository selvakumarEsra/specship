---
id: TASKSHIP-BRIDGE-DOC
title: taskship bridge — daily pull and task creation over the JIRA bus
owner: specship
priority: medium
---

<!-- id: TASKSHIP-BRIDGE-DOC -->
# taskship bridge — daily pull and task creation over the JIRA bus

taskship is a sibling PM tool: a team plans epics → stories → tasks in its
`plan.yaml`, runs scrum/kanban ceremonies, and cascades the plan to JIRA
(assignee + sprint + `taskship:*` labels + an `external_id` per node), then
reconciles JIRA status back for standup/board. SpecShip is the implementation
half: it reads a developer's assigned JIRA issues, turns each into a spec,
implements it in a worktree, raises a PR, and advances the issue on verify.

The two tools already meet at JIRA — no direct coupling is required for the
execution loop. This document adds the two things that make the daily
scrum/kanban model flow through SpecShip: pulling *my* work for the day, and
pushing *new* tasks discovered mid-implementation back up under their
epic/story. The second is **capability-detected**: when taskship is present,
new tasks route through it so `plan.yaml` stays canonical; when it is not,
SpecShip creates the JIRA issue directly.

Two principles bound this feature:

- **JIRA is the bus; taskship is the plan's owner.** SpecShip never becomes a
  second planner. It reads assignments from JIRA and, when creating work, defers
  to taskship if taskship is installed — otherwise it writes JIRA directly,
  best-effort stamping taskship's identity convention so a later taskship
  adoption can reconcile the issue.
- **Detection is deterministic and injected.** Whether taskship is available is
  a pure probe (its MCP entry configured and/or the `taskship` binary on PATH),
  passed in so the routing decision is testable without a live taskship.

<!-- id: REQ-TASKSHIP-001 -->
## A developer MUST be able to pull their sprint's assigned issues

`listMyIssues` and `specship_jira_issues` take an optional sprint filter. When
requested, the JQL adds `AND sprint in openSprints()` so the result is the
current user's issues on the active sprint — "my tasks for today" — rather than
every issue ever assigned to them. Omitting the filter preserves today's
behavior (all of the user's issues, most-recently-updated first). A
`/specship:day` command surfaces this: it lists the sprint's assigned issues and
offers to `pick`/`start` one.

implementations:
  - src/jira/client.ts:JiraClient.listMyIssues
  - src/mcp/jira-tools.ts:handleSpecshipJiraIssues
  - commands/specship/day.md

## Acceptance
<!-- id: REQ-TASKSHIP-001.A1 -->
- `specship_jira_issues` with the sprint filter set to active builds JQL
  containing `assignee = currentUser()` and `sprint in openSprints()`, and
  returns only issues on an open sprint.
<!-- id: REQ-TASKSHIP-001.A2 -->
- `specship_jira_issues` with no sprint filter is byte-for-byte the current
  behavior (all assigned issues, `ORDER BY updated DESC`), with no sprint JQL.
<!-- id: REQ-TASKSHIP-001.A3 -->
- The project filter and the sprint filter compose (both clauses present when
  both are supplied), and the JQL stays injection-guarded (values escaped).
<!-- id: REQ-TASKSHIP-001.A4 -->
- The `/specship:day` command document instructs listing the sprint's
  assigned issues and offering pick→start on one.

<!-- id: REQ-TASKSHIP-002 -->
## taskship availability MUST be a pure, injected probe

A single function reports whether taskship is available for routing, decided
from injected inputs only: the `taskship` command resolving on PATH and/or a
`taskship` MCP server configured in the project's `.mcp.json`. It performs no
network or process work of its own beyond the injected probes, so the routing
decision (REQ-TASKSHIP-003) is deterministic and unit-testable without a live
taskship.

implementations:
  - src/taskship/detect.ts:detectTaskship

## Acceptance
<!-- id: REQ-TASKSHIP-002.A1 -->
- With an injected probe reporting the `taskship` binary on PATH, the detector
  reports available; with neither the binary nor an MCP entry, unavailable.
<!-- id: REQ-TASKSHIP-002.A2 -->
- The detector never throws and never shells out or opens a socket itself —
  every external signal arrives through an injected probe.

<!-- id: REQ-TASKSHIP-003 -->
## A discovered task MUST be creatable under its epic/story, routed by availability

A new code-graph tool (`specship_jira_add_task`) creates a task a developer
identifies mid-implementation, under a named epic or story. Routing is decided
by REQ-TASKSHIP-002:

- **taskship available** → route through taskship's `add_task` (its MCP tool or
  `taskship raise` CLI), passing the epic/story id, type, and title, so taskship
  stamps identity/labels, writes `plan.yaml`, and cascades to JIRA. taskship is
  the canonical owner: if its `add_task` fails, the tool surfaces that error and
  does NOT also write JIRA — a silent direct-JIRA write would create an issue
  taskship cannot reconcile.
- **taskship unavailable** → create the JIRA issue directly under the given
  parent key. A task under a **Story** becomes a **Sub-task** of it; a task
  under an **Epic** becomes a **Task** linked to the epic. The issue is
  best-effort stamped with taskship's `external_id` + `taskship:*` label
  convention so a later taskship adoption can reconcile it.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraAddTask
  - src/taskship/detect.ts:detectTaskship
  - src/jira/client.ts:JiraClient.createIssue

## Acceptance
<!-- id: REQ-TASKSHIP-003.A1 -->
- With taskship available, adding a task under a story invokes taskship's
  add_task with the story id, type, and title, and does not create a JIRA
  issue directly.
<!-- id: REQ-TASKSHIP-003.A2 -->
- With taskship available but its add_task failing, the tool returns an error
  naming the taskship failure and creates no JIRA issue.
<!-- id: REQ-TASKSHIP-003.A3 -->
- With taskship unavailable, adding a task under a Story creates a JIRA
  Sub-task of that story; under an Epic it creates a Task linked to the epic.
<!-- id: REQ-TASKSHIP-003.A4 -->
- A JIRA issue created via the fallback carries the taskship `external_id` and
  a `taskship:*` label so a later `taskship` reconcile can adopt it.
<!-- id: REQ-TASKSHIP-003.A5 -->
- The tool belongs to the `jira` integration group, so it is exposed only when
  the JIRA integration is enabled (same gating as the other `specship_jira_*`
  tools).
