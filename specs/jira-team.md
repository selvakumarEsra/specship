---
id: JIRA-TEAM-DOC
title: JIRA team lane — shared binding, auto-tracked specs, coverage, reconcile
owner: core
priority: high
version: 1
---

<!-- id: JIRA-TEAM-DOC -->
# JIRA team lane — shared binding, auto-tracked specs, coverage, reconcile

The team lane for the JIRA integration. `JIRA-DOC` deliberately scoped itself
to a solo developer and named team features, two-way sync, and board
administration as non-goals; this document supersedes those non-goals for
teams while leaving the solo lane intact. The premise: an enterprise team
manages stories and tasks to and fro between SpecShip and JIRA — every spec is
tracked as a JIRA issue, the issue carries a comment trail of what Claude Code
actually did, a lead can see promise-vs-proof coverage for the sprint without
installing anything, and a JIRA-side edit is detected and proposed back into
the spec rather than silently diverging.

Design decisions (settled 2026-08-01):

- **Repo binding is committed; credentials are not.** The JIRA project
  binding (project key, issue types, board) lives in the repo's committed
  `specship.config.json` so every teammate resolves the same project.
  Credentials stay user-level in `~/.specship/jira.json` (REQ-JIRA-001 is
  unchanged) — the repo never carries a secret.
- **Auto-publish on sync.** With a binding present, every cleanly-indexed
  spec is published/refreshed to JIRA during sync — no per-spec prompt.
  Per-spec opt-out via frontmatter. The solo prompted flow
  (REQ-JIRAPUB-003) remains the unbound behavior.
- **Milestone comments, watermarked.** Claude Code comments the issue at
  lifecycle milestones only (published, plan approved, PR raised, verified,
  drift, release) — an audit trail, not a firehose.
- **Inbound is detect + propose.** A JIRA-side edit is surfaced as a
  proposed spec amendment the user confirms (triage's preview→confirm
  discipline); JIRA never silently rewrites a committed spec.
- **Coverage lands in JIRA + CLI/MCP.** The sprint coverage report is a
  watermarked, edited-in-place JIRA comment plus a CLI/MCP surface — no new
  mandatory UI.

Non-goals: board/sprint administration (creating sprints, ranking backlog),
JIRA webhooks (reconcile is poll-on-demand), auto-merging PRs or auto-closing
issues, and multi-JIRA-host bindings in one repo.

<!-- id: REQ-JIRATEAM-001 -->
## A repo MUST carry a committed, shared JIRA project binding

The JIRA project binding — project key, issue type for stories, sub-task
type, and optionally a board/sprint scope — lives in the repo's committed
`specship.config.json` under a `jira` section, so every teammate and CI run
resolves the same project without per-machine setup. User credentials remain
user-level and are never read from or written to the repo. Where a bound
value and a user-level value conflict, the repo binding wins for project
identity and the user level wins for credentials.

implementations:
  - src/jira/config.ts:resolveJiraCredentials
  - src/jira/repo-config.ts:loadRepoJiraBinding
  - src/jira/repo-config.ts:assertNoCredentialsInRepoConfig
  - src/jira/client.ts:JiraClient.verifyProjectAccess

verifies:
  - __tests__/jira/jira-repo-binding.test.ts

## Acceptance
<!-- id: REQ-JIRATEAM-001.A1 -->
- With a `jira` binding in `specship.config.json`, publish/pick/coverage
  operations resolve the project key from the repo with no per-user project
  configuration; two users on the same clone target the same project.
<!-- id: REQ-JIRATEAM-001.A2 -->
- No credential (token, email) is ever read from or persisted into
  `specship.config.json`; a binding containing a credential-shaped field is
  rejected with an explanatory error.
<!-- id: REQ-JIRATEAM-001.A3 -->
- With no repo binding, behavior is unchanged from the solo lane — the
  user-level publish project (REQ-JIRAPUB-009) is used and nothing new is
  required.
<!-- id: REQ-JIRATEAM-001.A4 -->
- A binding naming a project the authenticated user cannot access fails the
  operation with the project key and host named — never a silent fallback to
  another project.

<!-- id: REQ-JIRATEAM-002 -->
## With a binding present, every spec MUST be tracked in JIRA automatically

When the repo carries a binding, `specship sync` publishes every requirement
document that indexes cleanly and is not yet JIRA-backed, and refreshes
already-published ones whose content changed — reusing the existing
idempotent publish (Story + acceptance criteria as Sub-tasks, frontmatter
write-back, fingerprint). A spec opts out with `jira_publish: false`
frontmatter. Publish failures degrade to per-spec notes and never block the
sync.

implementations:
  - src/jira/publish.ts:publishSpecToJira
  - src/jira/publish.ts:writeBackJiraIdentity
  - src/jira/auto-publish.ts:autoPublishSpecsOnSync

verifies:
  - __tests__/jira/auto-publish-on-sync.test.ts

## Acceptance
<!-- id: REQ-JIRATEAM-002.A1 -->
- After sync on a bound repo, a newly-authored spec has a JIRA Story with one
  Sub-task per acceptance criterion and its `jira_issue:` key written back;
  a re-sync with no spec change performs no JIRA write.
<!-- id: REQ-JIRATEAM-002.A2 -->
- Editing a published spec's body and re-syncing refreshes the issue's
  summary/description and creates Sub-tasks only for criteria whose
  summaries are missing — never a duplicate Story or Sub-task.
<!-- id: REQ-JIRATEAM-002.A3 -->
- A spec with `jira_publish: false` in frontmatter is skipped by auto-publish
  and reported as opted out, not as a failure.
<!-- id: REQ-JIRATEAM-002.A4 -->
- A publish failure (auth, network, missing project) on one spec is reported
  as a note naming the spec and cause; the sync itself completes and other
  specs still publish.
<!-- id: REQ-JIRATEAM-002.A5 -->
- On an unbound repo, sync performs no JIRA call — auto-publish is strictly
  gated on the committed binding.

<!-- id: REQ-JIRATEAM-003 -->
## Lifecycle milestones MUST be commented on the issue by Claude Code, idempotently

A tracked issue carries a comment trail of what actually happened in the
repo: spec published/updated, implementation plan approved, PR raised,
acceptance criteria verified, drift detected, release shipped. Each comment
is watermarked as SpecShip/Claude Code-authored, states the milestone with
its repo-side evidence (spec id, PR link, verified criterion ids, version),
and is idempotent — re-running a step never duplicates a comment. Milestones
only: no per-command chatter.

implementations:
  - src/jira/client.ts:JiraClient.addComment
  - src/jira/client.ts:JiraClient.listComments
  - src/jira/milestone-comment.ts:postMilestoneComment
  - src/jira/milestone-comment.ts:milestoneMarker
  - src/jira/milestone-comment.ts:renderMilestoneBody
  - src/jira/milestone-comment.ts:isPublicEvidenceUrl
  - src/jira/publish.ts:commentSpecDrift
  - src/jira/publish.ts:commentDriftTransitionsOnJira
  - src/jira/publish.ts:releaseIssues
  - src/jira/auto-publish.ts:autoPublishSpecsOnSync

verifies:
  - __tests__/jira/milestone-comment.test.ts

## Acceptance
<!-- id: REQ-JIRATEAM-003.A1 -->
- Each of these events produces exactly one comment on the issue: first
  publish, plan approval, PR raised, a criterion's verification flipping to
  `verified`, a drift transition, release stamping. Re-running the same event
  adds no second comment.
<!-- id: REQ-JIRATEAM-003.A2 -->
- Every comment carries the SpecShip watermark and the concrete evidence for
  its milestone (at minimum the spec id; the PR URL, criterion ids, or
  version where applicable) — and never a credential or non-public URL.
<!-- id: REQ-JIRATEAM-003.A3 -->
- A comment-write failure degrades to a local note and never fails the
  operation that triggered it (publish, verify, release complete normally).
<!-- id: REQ-JIRATEAM-003.A4 -->
- No comment is produced for non-milestone activity (individual tool calls,
  intermediate workflow steps, failed attempts that were retried within the
  same run).

<!-- id: REQ-JIRATEAM-004 -->
## SpecShip MUST produce a sprint coverage report joining board issues to spec truth

Given the bound project's active sprint (or a named sprint), the coverage
report lists each issue with its repo-side state — spec present or absent,
implemented, verified, drifted — and closes with rollup totals (specced /
verified / drifted counts). It is available as a CLI command and an MCP tool,
and can be posted to JIRA as a single watermarked comment that is edited in
place on re-post rather than duplicated. The report is read-only over JIRA
issues: producing it never transitions, edits, or creates issues.

implementations:
  - src/jira/coverage.ts:buildCoverageReport
  - src/jira/coverage.ts:formatCoverageMarkdown
  - src/jira/coverage.ts:rollupCoverageState
  - src/jira/published-specs.ts:enumeratePublishedSpecs
  - src/jira/publish.ts:upsertWatermarkedComment
  - src/jira/client.ts:JiraClient.listSprintIssues
  - src/jira/client.ts:JiraClient.listCommentsDetailed
  - src/jira/client.ts:JiraClient.updateComment
  - src/mcp/jira-tools.ts:handleSpecshipJiraCoverage
  - src/mcp/jira-tools.ts:handleSpecshipJiraTrack

verifies:
  - __tests__/jira/jira-coverage.test.ts
  - __tests__/jira/jira-coverage-post.test.ts
  - __tests__/jira/jira-coverage-mcp.test.ts

## Acceptance
<!-- id: REQ-JIRATEAM-004.A1 -->
- The report lists every issue in the sprint scope — including issues with no
  spec, marked as unspecced — with one rolled-up repo-side state per issue
  and rollup totals at the end.
<!-- id: REQ-JIRATEAM-004.A2 -->
- An issue whose spec has a `broken` or `drifted` link, or no `verified`
  test evidence, is distinguishable in the report from one that is fully
  verified (states reuse the existing spec-link state machine, not a new one).
<!-- id: REQ-JIRATEAM-004.A3 -->
- Posting the report to JIRA creates one watermarked comment; posting again
  updates that comment in place, leaving exactly one report comment.
<!-- id: REQ-JIRATEAM-004.A4 -->
- Generating the report performs no JIRA write unless posting was explicitly
  requested, and never transitions or edits any issue.

<!-- id: REQ-JIRATEAM-005 -->
## JIRA-side edits MUST be detected and proposed back into the spec, never auto-applied

Reconciliation compares each tracked issue against its publish fingerprint
and its spec's criteria: an edited summary/description, or Sub-tasks
added/removed in JIRA, are reported as divergences with a proposed spec
amendment (new/changed requirement text, new acceptance criterion for a
JIRA-added Sub-task). The proposal follows the preview→confirm discipline —
the exact spec diff is shown and written only on explicit confirmation;
declining leaves both sides untouched and the divergence still reported.
Accepting re-publishes, refreshing the fingerprint.

implementations:
  - src/jira/publish.ts:issueContentFingerprint
  - src/jira/reconcile.ts:diffIssueVsSpec
  - src/jira/reconcile.ts:nextAcceptanceId
  - src/jira/reconcile.ts:proposeCriterionFromSubtask
  - src/jira/spec-amend.ts:applyContentAmendment
  - src/jira/spec-amend.ts:appendAcceptanceCriterion
  - src/jira/spec-amend.ts:amendSpecFile
  - src/mcp/jira-tools.ts:handleSpecshipJiraTrack
  - src/mcp/jira-tools.ts:handleSpecshipJiraReconcile

verifies:
  - __tests__/jira/jira-reconcile.test.ts
  - __tests__/jira/jira-spec-amend.test.ts
  - __tests__/jira/jira-mcp-reconcile-tool.test.ts

## Acceptance
<!-- id: REQ-JIRATEAM-005.A1 -->
- After an issue's summary or description is edited in JIRA, reconciliation
  reports the divergence naming the issue key and shows a proposed amendment
  to the spec's corresponding text.
<!-- id: REQ-JIRATEAM-005.A2 -->
- A Sub-task added in JIRA with no matching acceptance criterion is reported,
  with a proposed new `.A<N>` criterion derived from the Sub-task summary.
<!-- id: REQ-JIRATEAM-005.A3 -->
- No spec file is modified without explicit confirmation of the previewed
  diff; declining writes nothing and the divergence remains reported on the
  next reconcile.
<!-- id: REQ-JIRATEAM-005.A4 -->
- Confirming an amendment writes the spec, re-publishes the issue, and
  refreshes the fingerprint so the next reconcile reports no divergence.

<!-- id: REQ-JIRATEAM-006 -->
## On a bound repo, a new spec MUST be created in JIRA under an epic at authoring time

Board-first intake, outbound half (settled 2026-08-02): when the repo binding
is present, authoring a spec creates its JIRA issue **under an epic** as part
of spec creation — not later, not optionally. The binding gains an `epicKey`
as the default anchor; the authoring flow MAY offer a different epic from the
project's open epics, and the chosen epic lands in the spec's frontmatter.
The published Story is parented under that epic, and auto-publish
(REQ-JIRATEAM-002) honours the same epic anchor on refresh.

implementations:
  - src/jira/repo-config.ts:loadRepoJiraBinding
  - src/jira/repo-config.ts:updateRepoJiraBinding
  - src/jira/publish.ts:publishSpecToJira
  - src/jira/auto-publish.ts:autoPublishSpecsOnSync
  - src/jira/client.ts:JiraClient.listEpics
  - commands/specship/spec.md

## Acceptance
<!-- id: REQ-JIRATEAM-006.A1 -->
- On a bound repo with an `epicKey`, finishing spec authoring creates the JIRA
  Story under that epic before the flow reports done, and the spec frontmatter
  records both the issue key and the epic key.
<!-- id: REQ-JIRATEAM-006.A2 -->
- The authoring flow can list the bound project's open epics and accept a
  different epic than the binding default; the override is recorded in the
  spec frontmatter and used for the Story's parent.
<!-- id: REQ-JIRATEAM-006.A3 -->
- On a bound repo with no resolvable epic (no `epicKey`, none chosen), spec
  authoring refuses to complete, naming the fix — set `epicKey` in the binding
  or pick an epic — rather than creating an unanchored Story.
<!-- id: REQ-JIRATEAM-006.A4 -->
- Auto-publish and re-publish keep the Story under its recorded epic; a
  re-publish never detaches or re-parents the Story to a different epic
  without a frontmatter change.
<!-- id: REQ-JIRATEAM-006.A5 -->
- On an unbound repo, spec authoring is unchanged — no epic requirement, no
  JIRA call.

<!-- id: REQ-JIRATEAM-007 -->
## On a bound repo, starting work without a new spec MUST go through the board

Board-first intake, inbound half: on a bound repo, every work-creating flow —
implementing, fixing, starting an issue — is anchored to a JIRA issue. When
the user starts work without naming a new spec, SpecShip lists the open
stories and tasks from the bound project (scoped to the epic when one is
bound) so they pick one to drive the work; picking routes into the existing
issue-to-spec pipeline. A work-creating flow that can resolve no anchor —
no epic, no picked issue — refuses with the fix named. Read-only retrieval
(explore, search, status, coverage) is never blocked.

implementations:
  - src/mcp/jira-tools.ts:handleSpecshipJiraIssues
  - src/mcp/jira-tools.ts:handleSpecshipJiraAnchor
  - src/jira/board-first.ts:resolveWorkAnchor
  - src/jira/board-first.ts:formatRefusal
  - src/jira/client.ts:JiraClient.listMyIssues
  - commands/specship/spec.md

verifies:
  - __tests__/jira/board-first.test.ts
  - __tests__/jira/jira-issues-epic-scoping.test.ts

## Acceptance
<!-- id: REQ-JIRATEAM-007.A1 -->
- On a bound repo, starting implementation without a new spec presents the
  bound project's open stories/tasks (epic-scoped when an epic is bound) to
  pick from; the picked issue flows into the existing pick→spec→implement
  pipeline.
<!-- id: REQ-JIRATEAM-007.A2 -->
- A work-creating flow on a bound repo with no resolvable anchor (no epic
  binding, no picked issue) refuses and names the fix; it never silently
  proceeds unanchored.
<!-- id: REQ-JIRATEAM-007.A3 -->
- Read-only operations — explore, search, callers/callees, impact, status,
  coverage, track — are never gated on an anchor, bound or not.
<!-- id: REQ-JIRATEAM-007.A4 -->
- On an unbound repo, all flows behave exactly as before — board-first is
  strictly gated on the committed binding.

<!-- id: REQ-JIRATEAM-008 -->
## A JIRA menu MUST let the user configure the binding and choose their epic and issue interactively

One interactive door for the whole board-first setup: a menu command that
walks the user through the JIRA lifecycle — configure/verify the connection
and repo binding, choose the default epic from the project's open epics, and
browse the open stories/tasks to pick one and start work. Each menu action
routes to the existing capability (binding write, epic selection, issue
pick/start) rather than duplicating it; the menu is the guided path, not a
second implementation.

implementations:
  - commands/specship/jira.md
  - src/jira/client.ts:JiraClient.listEpics

## Acceptance
<!-- id: REQ-JIRATEAM-008.A1 -->
- The menu offers at least: connection/binding status, configure or edit the
  repo binding (project, epic), choose the default epic from the project's
  open epics, and list open stories/tasks to pick and start one.
<!-- id: REQ-JIRATEAM-008.A2 -->
- Choosing an epic from the menu persists it as the binding's `epicKey`
  (committed repo config), and the change is visible to the next authoring
  flow without restart.
<!-- id: REQ-JIRATEAM-008.A3 -->
- Picking a story/task from the menu routes into the existing pick→start
  pipeline — the same path REQ-JIRATEAM-007 uses — not a parallel one.
<!-- id: REQ-JIRATEAM-008.A4 -->
- With JIRA unconfigured, the menu still opens and leads with the configure
  path instead of erroring.
