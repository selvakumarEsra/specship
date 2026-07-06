---
id: JIRA-DOC
title: JIRA integration for solo developers
owner: core
priority: medium
brief: integrate-jira-into-specship/brief.md
---

<!-- id: JIRA-DOC -->
# JIRA integration for solo developers

Let a solo developer drive work straight from their JIRA board without leaving
SpecShip: connect with a token, list the issues assigned to them, pick one by
id, and let SpecShip turn it into a spec, implement and verify it, raise a PR,
and push the status back to the issue so the board stays the source of truth.

This is SpecShip's first outbound integration — every requirement below assumes
the app is otherwise local-first, so credential handling and network-failure
behaviour are first-class concerns, not afterthoughts.

Design decisions (settled):

- **Spec-driven bridge.** A picked issue is authored into a SpecShip spec (a
  low-ceremony auto-draft from the issue), then the existing spec-implement
  pipeline runs on that spec. This keeps the spec-as-contract ethos, drift
  tracking, and acceptance criteria rather than implementing raw issue text.
- **Surface split.** The issue-driving flow — list, fetch, pick, start — is
  **agent-native MCP tools** (`specship_jira_issues` / `_issue` / `_pick` /
  `_start`) the agent calls in conversation ("list my JIRA issues",
  "start PROJ-123"). The **setup and tracking** surfaces ship as terminal
  **CLI subcommands** in v1 too — `specship jira configure` / `jira test`
  (connection) and `jira track` (status view) — because those are naturally
  terminal-and-script-friendly. CLI wrappers for list/pick/start are a
  follow-up, not v1.
- **Both deployments.** JIRA Cloud (email + API token, basic auth) and Data
  Center / Server (Personal Access Token, bearer) are both supported.

Non-goals for this document: team/multi-user features, board or sprint
administration, JIRA webhooks / live two-way sync, implementing more than one
picked issue at a time, and auto-merging the PR or closing the issue (a human
decides Done).

<!-- id: REQ-JIRA-001 -->
## SpecShip MUST connect to JIRA Cloud or Data Center with a securely-stored token

The user configures one JIRA connection: a base URL plus credentials — for
Cloud, their account email and an Atlassian API token (HTTP basic auth); for
Data Center / Server, a Personal Access Token (bearer auth). The deployment
kind is inferred from the credential shape or set explicitly. Configuration is
stored at the user level under `~/.specship/` (not in the project, never
committed), and an environment variable overrides the stored value so CI and
secret managers can inject it. A "test connection" path confirms the
credentials reach JIRA before any issue operation runs.

implementations:
  - src/jira/config.ts:resolveJiraCredentials
  - src/jira/auth.ts:buildAuthHeader
  - src/jira/client.ts:JiraClient

## Acceptance
<!-- id: REQ-JIRA-001.A1 -->
- A Cloud connection (base URL + email + API token) and a Data Center
  connection (base URL + PAT) each authenticate successfully against their
  respective auth scheme.
<!-- id: REQ-JIRA-001.A2 -->
- Credentials are read from the user-level config or an environment-variable
  override; the token is never written into the project tree or a committed
  file.
<!-- id: REQ-JIRA-001.A3 -->
- A missing, malformed, or unauthorized credential fails the "test connection"
  path with a clear, actionable message and does not proceed to any issue
  operation.

<!-- id: REQ-JIRA-002 -->
## SpecShip MUST list the JIRA issues assigned to the current user

The user asks (through an MCP tool the agent calls) to list the issues assigned
to them, optionally narrowed to a board or project. The result shows, per
issue, its key/id, summary, status, and issue type, ordered so the most
actionable items surface first. "Assigned to me" resolves to the authenticated
account, so the user never types their own name.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraIssues
  - src/mcp/jira-tools.ts:jiraToolDefinitions

## Acceptance
<!-- id: REQ-JIRA-002.A1 -->
- Listing returns exactly the issues assigned to the authenticated user, each
  with key, summary, status, and type.
<!-- id: REQ-JIRA-002.A2 -->
- An optional board/project filter narrows the list to that board/project.
<!-- id: REQ-JIRA-002.A3 -->
- A user with no assigned issues gets an explicit empty result, not an error.
<!-- id: REQ-JIRA-002.A4 -->
- An auth or network failure during listing is surfaced as such and returns no
  fabricated or partial list.

<!-- id: REQ-JIRA-003 -->
## SpecShip MUST fetch and present a single issue picked by its id

The user picks an issue by passing its key/id. SpecShip fetches that issue and
presents the detail needed to act on it: summary, full description, status,
type, and acceptance/subtask information when present. An id that does not
exist, or that the user cannot access, is reported clearly rather than silently
producing an empty spec.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraIssue

## Acceptance
<!-- id: REQ-JIRA-003.A1 -->
- Fetching a valid issue key returns its summary, description, status, and
  type.
<!-- id: REQ-JIRA-003.A2 -->
- An unknown or forbidden issue key returns a clear not-found / no-access
  message and no downstream work is started.

<!-- id: REQ-JIRA-004 -->
## Picking an issue MUST author a SpecShip spec from it

A picked issue is turned into a SpecShip spec: its summary becomes the title,
its description and acceptance content become the requirement body and
acceptance criteria, and the spec records the source issue key so the two stay
linked. The draft is low-ceremony — generated from the issue without a full
authoring interview — but still well-formed (id markers, RFC 2119 keywords,
acceptance bullets) so it indexes cleanly and the existing pipeline can run on
it.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraPick
  - src/jira/spec-generator.ts:generateSpecMarkdown
  - src/jira/spec-writer.ts:writeSpecFromIssue

## Acceptance
<!-- id: REQ-JIRA-004.A1 -->
- A picked issue produces a spec whose title, body, and acceptance criteria are
  derived from the issue and whose frontmatter records the issue key.
<!-- id: REQ-JIRA-004.A2 -->
- The generated spec indexes cleanly (embedded id markers, valid frontmatter,
  acceptance bullets) with no manual fix-up.
<!-- id: REQ-JIRA-004.A3 -->
- Re-picking the same issue updates the existing spec rather than creating a
  duplicate.

<!-- id: REQ-JIRA-005 -->
## SpecShip MUST run the implement-and-verify pipeline on the generated spec

Once the spec exists, SpecShip drives the existing spec-implement workflow on
it — plan, implement, verify, and link — in the isolated worktree the workflow
already uses. The JIRA flow reuses that pipeline rather than implementing raw
issue text, so the work carries acceptance-criteria verification and spec→code
links like any other SpecShip implementation.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraStart

## Acceptance
<!-- id: REQ-JIRA-005.A1 -->
- Starting an issue runs the spec-implement workflow against the generated
  spec and surfaces its plan/approve gate.
<!-- id: REQ-JIRA-005.A2 -->
- A failing or rejected implementation leaves the issue un-transitioned past
  "in progress" and does not raise a PR.

<!-- id: REQ-JIRA-006 -->
## SpecShip MUST raise a pull request linked to the source issue

When the implementation completes and verifies, SpecShip raises a pull request
for the work. The PR title and body are derived from the issue (including its
key) so the PR is traceable to the ticket, and the issue key is placed where
JIRA's development panel links it back. Raising the PR requires the repo's
existing PR tooling to be available and authenticated; if it is not, the flow
reports that clearly instead of failing silently.

## Acceptance
<!-- id: REQ-JIRA-006.A1 -->
- A completed, verified implementation raises a PR whose title/body reference
  the issue key.
<!-- id: REQ-JIRA-006.A2 -->
- The PR is discoverable from the issue (its key appears where JIRA links
  development work).
<!-- id: REQ-JIRA-006.A3 -->
- When PR tooling is missing or unauthenticated, the flow reports it and leaves
  the branch/worktree intact for a manual PR rather than losing the work.

<!-- id: REQ-JIRA-007 -->
## SpecShip MUST push status back to the issue at lifecycle moments, and MUST degrade gracefully

At the moments that matter, SpecShip moves the JIRA issue: on start it
transitions the issue toward "in progress" and assigns it to the user; on PR
raised it transitions the issue toward "in review" and comments the PR link on
the issue. Because JIRA workflows differ per project, the transition names/ids
are configurable, and when a configured transition is unavailable the flow
falls back to commenting the PR link on the issue rather than erroring. The
final "done" transition is left to the human (merging the PR), not automated.

## Acceptance
<!-- id: REQ-JIRA-007.A1 -->
- On start, the issue transitions toward "in progress" and is assigned to the
  authenticated user.
<!-- id: REQ-JIRA-007.A2 -->
- On PR raised, the issue transitions toward "in review" and carries a comment
  linking the PR.
<!-- id: REQ-JIRA-007.A3 -->
- When a configured transition does not exist for the issue's workflow, the
  flow comments the PR link and reports the skipped transition instead of
  failing.
<!-- id: REQ-JIRA-007.A4 -->
- SpecShip never performs the "done"/close transition automatically.

<!-- id: REQ-JIRA-008 -->
## SpecShip MUST let the user see the status of issues it is tracking

The user can see, for the issues SpecShip has picked, the SpecShip-side work
state (spec authored, implementing, PR raised, verified) alongside the JIRA
status, so the board and SpecShip agree at a glance. This tracking reads from
SpecShip's own record of picked issues plus a live JIRA status read; it does
not require re-picking.

## Acceptance
<!-- id: REQ-JIRA-008.A1 -->
- The tracking view lists each picked issue with both its SpecShip work state
  and its current JIRA status.
<!-- id: REQ-JIRA-008.A2 -->
- An issue whose JIRA status changed outside SpecShip shows the updated JIRA
  status on the next read.

<!-- id: REQ-JIRA-009 -->
## SpecShip MUST keep the JIRA token secret and talk only to the configured host

The token is never logged, printed, echoed into workflow logs or the graph, or
written into the project tree. All JIRA requests go only to the configured base
URL; SpecShip makes no other outbound calls with the credential. This holds
across the list, pick, PR, and status-write paths.

implementations:
  - src/jira/client.ts:JiraClient
  - src/jira/auth.ts:buildAuthHeader
  - src/jira/config.ts:resolveJiraCredentials

## Acceptance
<!-- id: REQ-JIRA-009.A1 -->
- No log, error message, workflow artifact, or committed file contains the
  token value.
<!-- id: REQ-JIRA-009.A2 -->
- Every credentialed request targets only the configured JIRA base URL; a
  redirect to another host is refused.
