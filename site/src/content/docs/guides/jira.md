---
title: JIRA integration
description: Drive work straight from your JIRA board — list your issues, pick one, and let SpecShip implement, verify, and raise its PR.
---

SpecShip connects to your JIRA board so a solo developer can drive work without leaving the agent: list the issues assigned to you, pick one by its key, and let SpecShip turn it into a spec, run the implement-and-verify workflow, raise the pull request, and push the status back to the ticket — so the board stays the source of truth.

This is SpecShip's outbound integration, and it stays true to the local-first design: your token is stored at the user level (never in the project), every request is locked to the host you configured, and the token is never printed or logged.

For a team, the same integration scales up: commit a [shared repo binding](#share-a-binding-with-your-team) and every teammate and CI run publishes into the same project, specs [publish automatically on sync](#automatic-publish-on-sync), and SpecShip leaves a [comment trail](#lifecycle-comment-trail) of what actually happened in the repo.

## Turn it on

JIRA is an **opt-in integration** — the core install is 100% local and doesn't expose the JIRA tools. Enable them once:

```bash
specship install --with-jira
```

A later plain `specship install` keeps the opt-in. In an interactive install, SpecShip offers to run `specship jira configure` for you right away. The JIRA tools are never auto-allowed, so Claude Code asks before each call.

## How it works, end to end

1. **Connect** once with `specship jira configure`.
2. **List** the issues assigned to you (`specship_jira_issues`) — you never type your own name; "assigned to me" resolves from your token.
3. **Pick** one by key (`specship_jira_pick`). SpecShip drafts a well-formed spec from the issue under `specs/`.
4. **Start** it (`specship_jira_start`). This runs the same [spec-implement workflow](/workflows/bundled/) any spec runs — plan, approve, implement, verify, link — in an isolated git worktree, and pauses at the plan/approve gate.
5. **PR** — once you approve the plan and the implementation's tests pass, SpecShip raises a pull request with the issue key in the branch, title, and body.
6. **Track** — `specship_jira_track` shows each picked issue's SpecShip work-state next to its live JIRA status.

The issue becomes a real SpecShip spec — a contract with acceptance criteria and drift tracking — not raw ticket text handed to the model. Everything downstream of the pick reuses the pipeline SpecShip already uses for any spec.

## Connect to JIRA

SpecShip supports both deployments. The kind is inferred from the credentials you give, or set it explicitly with `--deployment`.

**JIRA Cloud** — your account email plus an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) (HTTP basic auth):

```bash
specship jira configure \
  --base-url https://your-org.atlassian.net \
  --email you@example.com \
  --api-token <atlassian-api-token>
```

**JIRA Data Center / Server** — a [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) (bearer auth):

```bash
specship jira configure \
  --base-url https://jira.your-company.com \
  --pat <personal-access-token>
```

:::note[Context path]
If your instance is served under a context path (common on Data Center, e.g. `https://jira.your-company.com:8443/jira`), include it in `--base-url` — SpecShip appends `/rest/api/2/...` to exactly what you configure.
:::

### Corporate or self-signed certificates (Data Center)

Enterprise Data Center instances often sit behind a certificate your machine doesn't trust, which fails with `Could not reach JIRA at <host>`. Two opt-ins fix it — preferred first:

```bash
# Preferred: trust your corporate CA bundle (PEM) for JIRA requests
specship jira configure --base-url https://jira.your-company.com:8443/jira \
  --pat <token> --ca-cert /path/to/corporate-ca.pem

# Last resort: disable certificate verification for JIRA requests only
specship jira configure --base-url https://jira.your-company.com:8443/jira \
  --pat <token> --insecure-tls
```

Both are scoped to SpecShip's JIRA requests only — they never change TLS verification for anything else. `--insecure-tls` prints a warning; use it only on trusted networks.

Then verify the connection at any time:

```bash
specship jira test
```

On success you see `connected as <your name>` — the token itself is never echoed back.

### Where credentials live

Credentials are written to `~/.specship/jira.json` with owner-only (`0600`) permissions. They are **never** written into your project tree or a committed file. There is nothing to add to `.gitignore` and nothing to keep in sync per project.

### Headless and CI setups

Every field can come from an environment variable instead of the stored file, so a secret manager can inject it:

| Variable | Purpose |
|---|---|
| `SPECSHIP_JIRA_BASE_URL` | Your JIRA base URL |
| `SPECSHIP_JIRA_EMAIL` | Account email (Cloud) |
| `SPECSHIP_JIRA_API_TOKEN` | Atlassian API token (Cloud) |
| `SPECSHIP_JIRA_PAT` | Personal Access Token (Data Center / Server) |
| `SPECSHIP_JIRA_DEPLOYMENT` | Force `cloud` or `datacenter` instead of inferring |
| `SPECSHIP_JIRA_CA_CERT` | Path to a PEM CA bundle for a corporate/self-signed certificate |
| `SPECSHIP_JIRA_INSECURE_TLS` | `1`/`true` disables certificate verification for JIRA requests only (last resort) |
| `SPECSHIP_JIRA_PROJECT` | Default project key for publishing a spec (skips the pick-list) |
| `SPECSHIP_JIRA_CONFIG` | Point at a config file other than `~/.specship/jira.json` |

The lifecycle transition names also have overrides — `SPECSHIP_JIRA_TRANSITION_IN_PROGRESS`, `SPECSHIP_JIRA_TRANSITION_IN_REVIEW`, `SPECSHIP_JIRA_TRANSITION_DONE` (see [Status write-back](#status-write-back)).

An environment variable overrides the stored value.

## Drive work from the agent

The list → pick → start flow is agent-native — you ask Claude Code in conversation ("list my JIRA issues", "pick PROJ-123", "start it") and it calls these MCP tools:

| Tool | What it does |
|---|---|
| `specship_jira_issues` | Lists the issues assigned to you — key, summary, status, and type, most recently updated first. Pass an optional project key to narrow it. No assigned issues returns a clear empty result, not an error. |
| `specship_jira_issue` | Fetches a single issue by key — its summary, description, status, and type. An unknown or forbidden key is reported clearly. |
| `specship_jira_pick` | Fetches an issue and drafts a spec from it under `specs/`: summary → title, description → body, subtasks → acceptance criteria. Re-picking the same issue updates its spec in place rather than duplicating it, and records the source issue key. |
| `specship_jira_start` | Runs the spec-implement workflow on the generated spec and surfaces its plan/approve gate. |
| `specship_jira_track` | A read-only table of every issue you've brought into SpecShip, joining its SpecShip work-state with a live JIRA status read. Also flags any published spec edited in JIRA after publishing. Never re-picks or re-starts anything. |
| `specship_jira_publish` | The reverse of `pick`: publishes an authored spec back to JIRA as a Story whose Sub-tasks mirror its acceptance criteria, and records the new key in the spec's frontmatter. Idempotent — re-publishing updates the Story and creates only missing Sub-tasks. |
| `specship_jira_transition` | Moves an issue to a target workflow state, or lists the states it currently offers. A target the workflow doesn't offer is reported with the available states, never applied. |
| `specship_jira_coverage` | The [sprint coverage report](#sprint-coverage-report) — every issue in the sprint joined to spec truth. Read-only unless you ask it to post. |
| `specship_jira_reconcile` | Detects issues edited in JIRA after publishing and proposes the matching [spec amendment](#reconcile-jira-side-edits). |
| `specship_jira_epics` | Lists the open epics in the bound project, most recently updated first. |
| `specship_jira_anchor` | Reports the repo's work anchor — unbound, the anchored issue, or the epic-scoped list to pick from. Read-only. |
| `specship_jira_add_task` | Files a task you spotted mid-implementation under its story or epic (a Sub-task under a Story, a Task under an Epic). If the taskship planning tool is installed it routes through taskship instead. |
| `specship_jira_regression_pack` | Generates or refreshes the [regression pack](#regression-pack). |
| `specship_jira_regression_record` | Records a regression case's result back into JIRA and the graph. |

Ask for `sprint: "active"` with `specship_jira_issues` — or run `/specship:day` — to pull just your issues on the open sprint, then pick and start one. `/specship:jira` is a guided menu for the board setup: connection status, configuring the repo binding, choosing a default epic, and picking work.

Terminal equivalents exist for the non-interactive parts: `specship jira track`, `transition`, `release`, `bind`, `coverage`, `reconcile`, `regression-pack`, and `regression-record`.

## Publish a spec back to JIRA

`pick` pulls a ticket *in*; `specship_jira_publish` pushes an authored spec back *out* — the reverse direction. It creates a JIRA **Story** from the spec whose **Sub-tasks mirror the acceptance criteria**, then writes the created key into the spec's frontmatter so branches, PRs, commits, and `track` all carry it. Publishing is idempotent: re-publishing an already-keyed spec updates the Story and creates only the missing Sub-tasks — never a duplicate.

A spec file that holds **several requirements** publishes each one as its own issue, tracked separately in the file's frontmatter (`jira_issue_<REQ-ID>`), so coverage and tracking attribute every issue to its own requirement.

If you author a spec in the repo first (rather than starting from `pick`), the spec authoring flow offers to publish it when JIRA is configured. When no default project is set, SpecShip lists the projects your account can access and lets you choose — during `specship jira configure --project`, or as a pick-list at publish time.

**Team-managed projects** often have `Task` and `Sub-task` issue types and no `Story`. Set `jira.storyIssueType` and `jira.subtaskIssueType` in the [repo binding](#share-a-binding-with-your-team) and every publish path — manual, automatic on sync, and reconcile — uses them. When JIRA rejects a publish, the error includes JIRA's own explanation (for example, which field was invalid).

## Share a binding with your team

Commit the JIRA **project identity** to the repo so every teammate and CI run targets the same project with zero per-machine setup. The binding lives under `jira` in `specship.config.json`:

```json
{
  "jira": {
    "projectKey": "PROJ",
    "storyIssueType": "Task",
    "subtaskIssueType": "Sub-task",
    "epicKey": "PROJ-42"
  }
}
```

Write it by hand, with `specship jira bind --project PROJ [--epic PROJ-42]`, or through `/specship:jira configure`. Optional `board` and `sprint` keys scope coverage and picking.

- **Credentials never go here.** They stay in each user's `~/.specship/jira.json` or `SPECSHIP_JIRA_*` environment. A credential-shaped field in the repo file (an email, token, password, or host URL) is rejected with an error naming the file and field.
- **The binding wins for project identity**, even over environment variables.
- **No silent fallback.** A binding pointing at a project you can't access fails loudly, naming the project and host.

### Epics at authoring time

On a bound repo, new work is created **under an epic** — no unanchored Stories drifting off the board. The epic comes from the spec's frontmatter `epicKey`, else the binding's `jira.epicKey`, else one you pick from the project's open epics. If none is set and none is picked, authoring refuses with a directed message rather than creating an orphan.

SpecShip never silently re-parents a live Story: if a published spec's frontmatter epic changes, it logs a `reparent_skipped` warning and leaves JIRA untouched so you can move the Story intentionally in the JIRA UI.

## Automatic publish on sync

With a binding committed, every `specship sync` publishes new specs and refreshes changed ones — no per-spec prompt:

- **Unchanged specs write nothing.** Each published spec carries a fingerprint; a match means zero JIRA calls for it.
- **Opt a spec out** with `jira_publish: false` in its frontmatter.
- **Failures are isolated.** One spec failing to publish never blocks the sync or the other specs.
- **Unbound repos are untouched.** Without a binding, sync behaves exactly as before and makes zero JIRA calls.

## Lifecycle comment trail

Issues tracked by SpecShip carry a comment trail of what actually happened in the repo — one watermarked comment per milestone, each stating its concrete evidence:

| Milestone | Evidence |
|---|---|
| Spec published | spec id |
| Implementation plan approved | spec id |
| PR raised | PR link |
| Acceptance criterion verified | criterion ids |
| Drift detected | the drifted spec |
| Release shipped | version |

Re-running a step updates its existing comment in place instead of duplicating it, and a JIRA hiccup while commenting never fails the operation that triggered it.

## Sprint coverage report

`specship_jira_coverage` (or `specship jira coverage`) joins every issue in the bound project's open sprint — or a named one with `--sprint` — to spec truth. Each issue gets one rolled-up state: **specced**, **implemented**, **verified**, **drifted**, or **broken** — and issues with no spec are listed as **unspecced** rather than hidden. Rollup totals close the report.

It is read-only by default. To share it, post it as a single watermarked comment on an anchor issue (for example the epic):

```bash
specship jira coverage --post PROJ-42
```

Re-posting edits that comment in place — never a duplicate, never a transition.

## Reconcile JIRA-side edits

People edit tickets. `specship_jira_reconcile` (or `specship jira reconcile`) detects issues changed in JIRA after publish — an edited summary or description, or Sub-tasks added on the board — and proposes the exact spec amendment, including a ready-to-accept acceptance criterion for each JIRA-added Sub-task.

Nothing is written until you've seen the diff and confirmed. Accepting updates the spec, re-publishes it, and clears the divergence. On the CLI, run it without flags to preview, then apply a confirmed diff per issue:

```bash
specship jira reconcile                                   # preview every divergence
specship jira reconcile --issue PROJ-142 --apply \
  --accept-content --accept-subtask PROJ-150 \
  --expected-fingerprint <fp-from-preview>
```

The fingerprint guard refuses the apply if the issue changed again after the preview you approved.

## Regression pack

`specship_jira_regression_pack` (or `specship jira regression-pack`) builds a **SpecShip Regression Pack** in the bound project from your implemented and verified requirements: one watermarked epic, a Story per area, and one case per acceptance criterion. It is idempotent — a re-run with nothing changed performs zero JIRA writes, and a criterion added, removed, or edited produces exactly the matching create or update. Use `--dry-run` (or `dry_run: true`) to preview the counts first.

- **UI vs. backend tiers.** Each case is labeled `specship-tier-ui` or `specship-tier-backend` — derived from the requirement's linked code — so testers can filter the board to one tier. The tier also heads the case body.
- **Black-box cases.** Case bodies contain no file paths, code symbols, or spec pointers.
- **Rephrase report.** Criteria that read as vague, or that echo code-shaped tokens, are still emitted but listed in a separate "criteria needing rephrase" report for a human pass.

Record a run's results back with `specship_jira_regression_record` or the CLI:

```bash
specship jira regression-record --case PROJ-210 --criterion REQ-AUTH-002.A1 \
  --result fail --run 2026-10-16 --error "token not refreshed"
```

| Result | Comment | Transition | Link on the criterion |
|---|---|---|---|
| pass | ✓ | → Done | `verified` |
| fail | ✓ (with a `/specship:spec triage <criterion>` hand-off) | → In Review | `broken` |
| unexecuted | ✓ | none | unchanged |

Re-recording the same case for the same run edits its comment in place. The pack epic gets one summary comment per run — executed, passed, failed, unexecuted, obsolete, and the criteria needing triage — also edited in place.

## The pull request

When the plan is approved **and** the implementation completes **and** its tests pass, SpecShip raises a pull request with the GitHub CLI (`gh`). The issue key rides the branch name, the PR title, and the PR body, so JIRA's development panel links the PR back to the ticket.

- A run whose tests didn't pass raises **no** PR.
- The PR is **never** auto-merged or auto-closed — you decide when the work is done by merging it.
- If `gh` is missing or unauthenticated, or the push fails, SpecShip reports why and leaves the branch and worktree intact for a manual PR rather than losing the work.

## Status write-back

SpecShip moves the issue at the moments that matter, so your board stays in sync without you touching it:

- **On start** — assigns the issue to you and transitions it toward "In Progress".
- **On PR raised** — transitions the issue toward "In Review" and comments the PR link on the ticket.
- **On verified acceptance evidence** — each proven criterion advances its published Sub-task toward Done, and the Story advances once every Sub-task is done. A spec that later drifts posts a one-time comment on its issue.

Because JIRA workflows differ per project, the transition names are configurable — set `transitionInProgress` / `transitionInReview` / `transitionDone` in `~/.specship/jira.json`, or the `SPECSHIP_JIRA_TRANSITION_IN_PROGRESS` / `SPECSHIP_JIRA_TRANSITION_IN_REVIEW` / `SPECSHIP_JIRA_TRANSITION_DONE` environment variables. They default to `"In Progress"`, `"In Review"`, and `"Done"`.

SpecShip degrades gracefully: if a configured transition doesn't exist in your project's workflow, it still comments the PR link and tells you it skipped the move rather than erroring, and a JIRA hiccup on start never blocks your local work from beginning. Raising and merging the PR stays your call — SpecShip never auto-merges.

## Transitions and workflow validation

Two commands make the workflow visible and controllable, since every project's states differ.

`specship jira transition` moves an issue to any state its workflow offers — or lists the options when you omit the target. A state the workflow can't reach is reported with the available states instead of applied, so nothing is written by mistake:

```bash
# list what an issue can transition to right now
specship jira transition PROJ-142 --list

# move it (a target the workflow lacks is reported, not applied)
specship jira transition PROJ-142 "Done"
```

`specship jira test` now also validates your configured lifecycle names against a real issue and flags any the workflow can't fire — so a board with no "In Review" state surfaces up front instead of silently skipping when a run completes:

```
$ specship jira test
✓ Connected to JIRA Cloud as Ada Lovelace.
ℹ Configured transitions (checked against PROJ-142; available: To Do, In Progress, Done):
ℹ   ✓ inProgress "In Progress"
⚠   ✗ inReview "In Review" — not offered from PROJ-142's current state
ℹ   ✓ done "Done"
```

If a name is unmatched, point it at a state your project actually has (or add the state in JIRA).

## Stamp a release onto the board

When the work ships, `specship jira release <version>` sets that version as the `fixVersion` on each issue — creating the project version if it doesn't exist — and adds a one-line "shipped in" comment. Re-running it is a no-op: no duplicate version, fixVersion, or comment.

```bash
# default: every published spec's issue key under specs/
specship jira release 1.4.0

# or an explicit set of keys / project
specship jira release 1.4.0 --keys PROJ-142,PROJ-143 --project PROJ
```

## Security

- The token is never logged, printed, echoed into workflow logs or the graph, or written into your project tree — across the list, pick, PR, and status-write paths.
- Every credentialed request targets **only** the configured base URL. A redirect to another host is refused, so the token can't leak to a different origin.
- Configuration is user-level and file-permission-guarded (`0600`).

## What it doesn't do

It does **not** administer boards or sprints, listen to JIRA webhooks (JIRA-side edits come back through [reconcile](#reconcile-jira-side-edits), on demand), implement more than one picked issue at a time, re-parent live Stories, or auto-merge a PR or close an issue. A human decides Done.
