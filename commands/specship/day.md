---
description: Your day — list the JIRA issues assigned to you on the active sprint, then pick and start one. The daily scrum/kanban entry point (TASKSHIP-BRIDGE-DOC).
argument-hint: "(no arg = my sprint board) | <PROJ> to narrow to a project"
allowed-tools: mcp__specship__specship_jira_issues, mcp__specship__specship_jira_pick, mcp__specship__specship_jira_start, mcp__specship__specship_jira_add_task
---

# SpecShip Day: `$ARGUMENTS`

The **daily door** — turn today's assigned work into implementation. Use this
after your team's scrum/kanban ceremony (in taskship or JIRA) has assigned you
issues for the sprint.

## Flow

1. **List my sprint board.** Call `mcp__specship__specship_jira_issues` with
   `sprint: "active"` (add `project: "<PROJ>"` if `$ARGUMENTS` names one) — this
   returns only the issues assigned to you on an open sprint, i.e. your work for
   the day, not every issue ever assigned. Present them as a short table.
2. **Pick one.** For the issue the user chooses, call
   `mcp__specship__specship_jira_pick` with its key — this authors a spec under
   `specs/` keyed on the issue.
3. **Start it.** Call `mcp__specship__specship_jira_start` with the same key —
   it runs the bundled spec-implement workflow in a worktree and pauses at the
   plan/approve gate. Approve to proceed; a PR is raised and the issue advances
   on verify.

## Discovered work

If, while implementing, you identify a NEW task that belongs under the epic or
story, capture it with `mcp__specship__specship_jira_add_task` (parent =
the story/epic, `title`, optional `type`/`parent_kind`). If taskship is
installed it routes through taskship so the plan stays canonical; otherwise it
creates a watermarked JIRA issue (Sub-task under a Story, Task under an Epic)
that taskship can adopt later. Don't hand-create JIRA issues for discovered
work — this keeps the plan and the board in sync.
