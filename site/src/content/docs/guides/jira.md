---
title: JIRA integration
description: Drive work straight from your JIRA board — list your issues, pick one, and let SpecShip implement, verify, and raise its PR.
---

SpecShip connects to your JIRA board so a solo developer can drive work without leaving the agent: list the issues assigned to you, pick one by its key, and let SpecShip turn it into a spec, run the implement-and-verify workflow, raise the pull request, and push the status back to the ticket — so the board stays the source of truth.

This is SpecShip's first outbound integration, and it stays true to the local-first design: your token is stored at the user level (never in the project), every request is locked to the host you configured, and the token is never printed or logged.

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
| `SPECSHIP_JIRA_CONFIG` | Point at a config file other than `~/.specship/jira.json` |

An environment variable overrides the stored value.

## Drive work from the agent

The list → pick → start flow is agent-native — you ask Claude Code in conversation ("list my JIRA issues", "pick PROJ-123", "start it") and it calls these MCP tools:

| Tool | What it does |
|---|---|
| `specship_jira_issues` | Lists the issues assigned to you — key, summary, status, and type, most recently updated first. Pass an optional project key to narrow it. No assigned issues returns a clear empty result, not an error. |
| `specship_jira_issue` | Fetches a single issue by key — its summary, description, status, and type. An unknown or forbidden key is reported clearly. |
| `specship_jira_pick` | Fetches an issue and drafts a spec from it under `specs/`: summary → title, description → body, subtasks → acceptance criteria. Re-picking the same issue updates its spec in place rather than duplicating it, and records the source issue key. |
| `specship_jira_start` | Runs the spec-implement workflow on the generated spec and surfaces its plan/approve gate. |
| `specship_jira_track` | A read-only table of every issue you've brought into SpecShip, joining its SpecShip work-state with a live JIRA status read. Never re-picks or re-starts anything. |

`specship jira track` is also available as a terminal command for a quick status view outside a session.

## The pull request

When the plan is approved **and** the implementation completes **and** its tests pass, SpecShip raises a pull request with the GitHub CLI (`gh`). The issue key rides the branch name, the PR title, and the PR body, so JIRA's development panel links the PR back to the ticket.

- A run whose tests didn't pass raises **no** PR.
- The PR is **never** auto-merged or auto-closed — you decide when the work is done by merging it.
- If `gh` is missing or unauthenticated, or the push fails, SpecShip reports why and leaves the branch and worktree intact for a manual PR rather than losing the work.

## Status write-back

SpecShip moves the issue at the moments that matter, so your board stays in sync without you touching it:

- **On start** — assigns the issue to you and transitions it toward "In Progress".
- **On PR raised** — transitions the issue toward "In Review" and comments the PR link on the ticket.

Because JIRA workflows differ per project, the transition names are configurable — set `transitionInProgress` / `transitionInReview` in `~/.specship/jira.json`, or the `SPECSHIP_JIRA_TRANSITION_IN_PROGRESS` / `SPECSHIP_JIRA_TRANSITION_IN_REVIEW` environment variables. They default to `"In Progress"` and `"In Review"`.

SpecShip degrades gracefully: if a configured transition doesn't exist in your project's workflow, it still comments the PR link and tells you it skipped the move rather than erroring, and a JIRA hiccup on start never blocks your local work from beginning. SpecShip **never** performs the "Done"/close transition automatically — that stays your call.

## Security

- The token is never logged, printed, echoed into workflow logs or the graph, or written into your project tree — across the list, pick, PR, and status-write paths.
- Every credentialed request targets **only** the configured base URL. A redirect to another host is refused, so the token can't leak to a different origin.
- Configuration is user-level and file-permission-guarded (`0600`).

## What it doesn't do

The integration is deliberately scoped to a solo developer's loop. It does **not** cover team or multi-user features, board or sprint administration, JIRA webhooks or live two-way sync, implementing more than one picked issue at a time, or auto-merging the PR / closing the issue. A human decides Done.
