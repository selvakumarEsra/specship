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
