---
description: JIRA menu — interactive door for the board-first setup (REQ-JIRATEAM-008). Configure/verify the binding, choose a default epic, and route into pick→start. No arg = the menu; `status`/`configure`/`epic`/`pick` run the matching flow.
argument-hint: "(no arg = menu) | status | configure | epic | pick"
allowed-tools: Bash, AskUserQuestion, mcp__specship__specship_jira_anchor, mcp__specship__specship_jira_epics, mcp__specship__specship_jira_issues, mcp__specship__specship_jira_pick, mcp__specship__specship_jira_start
---

# SpecShip JIRA: `$ARGUMENTS`

The **JIRA door** — one guided path for the whole board-first setup. Each menu
action routes to the existing capability rather than duplicating it
(REQ-JIRATEAM-008.A3); this command is the guided surface, not a second
implementation.

## Dispatch

Route on the first token of `$ARGUMENTS`. When the token is missing, show the
status line (A1) and then present the menu.

- **(no argument)** → **Menu**. First call `mcp__specship__specship_jira_anchor`
  and relay the returned line verbatim (that is the status). Then present the
  four choices with `AskUserQuestion`:
  - `status` — show connection + binding
  - `configure` — configure or edit the repo binding
  - `epic` — choose the default epic for the bound project
  - `pick` — list open stories/tasks and start one
  Dispatch to the chosen branch below. With JIRA unconfigured the menu still
  opens (the anchor tool's own "not configured" pointer is what the user sees
  first) and `configure` is the natural next step (A4).

- **`status`** → call `mcp__specship__specship_jira_anchor` and relay the
  result verbatim. That single line answers "is there a binding, and does it
  resolve?". If the response is the not-configured pointer, follow up with a
  one-line prompt suggesting `/specship:jira configure`.

- **`configure`** → interactive binding write. First run
  `!specship jira test` in Bash to confirm credentials; if that fails, tell
  the user to run `/specship:jira` after `specship jira configure` (the
  credential path is user-level and lives outside this menu). If credentials
  are good, ask the user for the project key (and optionally an epic key)
  with `AskUserQuestion`, then call
  `!specship jira bind --project <KEY>` (and `--epic <KEY>` if given). The
  CLI writes `specship.config.json` through `updateRepoJiraBinding`, which
  refuses any credential-shaped field. Confirm by calling
  `mcp__specship__specship_jira_anchor` again — the new binding must be
  visible without restart.

- **`epic`** → epic picker. Call `mcp__specship__specship_jira_epics` (with
  no `project` — it reads the bound project). Present the returned table and
  ask the user with `AskUserQuestion` which epic to bind (options are the
  returned keys plus a "cancel" option). On confirmation, run
  `!specship jira bind --epic <KEY>`. Then re-call `specship_jira_anchor` so
  the user sees the new anchor state (A2 — visible without restart).

- **`pick`** → the same pipeline `/specship:day` uses (A3 — DO NOT reimplement
  pick or start).
  1. Call `mcp__specship__specship_jira_issues` (no explicit `project` — on
     a bound repo the tool already scopes to the bound project's epic).
  2. Present the returned table and ask the user (with `AskUserQuestion`)
     which key to pick.
  3. Call `mcp__specship__specship_jira_pick` with the chosen key (authors
     the spec under `specs/`).
  4. Call `mcp__specship__specship_jira_start` with the same key — it runs
     the bundled spec-implement workflow in a worktree and pauses at the
     plan/approve gate. Approve to proceed; a PR is raised on verify.

## Notes

- Credentials never enter the repo. `specship jira bind` writes only
  `projectKey`/`epicKey` (and the other non-credential binding fields) via
  `updateRepoJiraBinding`, which trips a hard error on any credential-shaped
  key. Set credentials once with `specship jira configure` (user-level).
- The menu is a routing surface: it never calls JIRA directly, never writes
  a spec, and never starts a workflow. All of that goes through the MCP
  tools above so the guided path and the direct path stay identical.
