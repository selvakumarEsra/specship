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

`specship jira track` is also available as a terminal command for a quick status view outside a session, as are `specship jira transition` and `specship jira release`.

## Publish a spec back to JIRA

`pick` pulls a ticket *in*; `specship_jira_publish` pushes an authored spec back *out* — the reverse direction. It creates a JIRA **Story** from the spec whose **Sub-tasks mirror the acceptance criteria**, then writes the created key into the spec's frontmatter so branches, PRs, commits, and `track` all carry it. Publishing is idempotent: re-publishing an already-keyed spec updates the Story and creates only the missing Sub-tasks — never a duplicate.

If you author a spec in the repo first (rather than starting from `pick`), the spec authoring flow offers to publish it when JIRA is configured. When no default project is set, SpecShip lists the projects your account can access and lets you choose — during `specship jira configure --project`, or as a pick-list at publish time.

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

The integration is deliberately scoped to a solo developer's loop. It does **not** cover team or multi-user features, board or sprint administration, JIRA webhooks or live two-way sync, implementing more than one picked issue at a time, or auto-merging the PR / closing the issue. A human decides Done.
