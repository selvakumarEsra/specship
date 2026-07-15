---
id: JIRAPUB-DOC
title: Spec→JIRA publishing and tracking
owner: core
priority: high
version: 1
---

<!-- id: JIRAPUB-DOC -->
# Spec→JIRA publishing and tracking

The existing JIRA integration is one-way: an issue can become a spec
(`specship_jira_pick`/`_start`), and a completed run transitions, comments,
and assigns the issue. This document adds the reverse direction and closes the
tracking loop: a spec authored in the repo can be published to JIRA as a Story
whose Sub-tasks mirror the acceptance criteria, the JIRA key becomes the
spec's tracking identity (frontmatter, filename, commits), verification and
drift push their state to the issue, and releases stamp a fix version.

All JIRA writes reuse the existing credentialed write seam and its guards
(host-lock, credential-free error messages — REQ-JIRA-009), and every
issue-state write is skip-tolerant the way `transitionIssue` already is: a
workflow that lacks the target transition reports a skip, never throws.

<!-- id: REQ-JIRAPUB-001 -->
## A spec MUST be publishable to JIRA as a Story with its acceptance criteria as Sub-tasks

Publishing a requirement spec creates one issue (type configurable, default
`Story`) in the configured project: summary = the spec's title, description =
the requirement body followed by the acceptance criteria and the spec's
repo-relative path. Each `.A<N>` acceptance criterion becomes a Sub-task of
that issue, in order. Publish is idempotent, keyed on the spec's `jira_issue:`
frontmatter: re-publishing a spec that already carries a key updates the
existing issue's summary/description and creates only the Sub-tasks that are
missing — it never creates a duplicate Story and never deletes an existing
Sub-task.

implementations:
  - src/jira/client.ts:JiraClient.createIssue
  - src/jira/client.ts:JiraClient.updateIssue
  - src/jira/publish.ts:publishSpecToJira

## Acceptance
<!-- id: REQ-JIRAPUB-001.A1 -->
- Publishing a spec with three `.A<N>` bullets creates one Story and three
  Sub-tasks whose summaries are the bullet texts, parented to the Story.
<!-- id: REQ-JIRAPUB-001.A2 -->
- Re-publishing the same spec (frontmatter already carries `jira_issue:`)
  updates the Story's summary/description and creates no second Story.
<!-- id: REQ-JIRAPUB-001.A3 -->
- Re-publishing after a fourth acceptance bullet was added creates exactly one
  new Sub-task for it; the existing three are untouched.
<!-- id: REQ-JIRAPUB-001.A4 -->
- A create/update against an unreachable or unauthorized host surfaces the
  client's existing credential-free error and writes nothing to the spec file.

<!-- id: REQ-JIRAPUB-002 -->
## A successful publish MUST write the JIRA identity back into the spec

After the Story is created, the spec's frontmatter records `jira_issue: <KEY>`
(the same key `specship_jira_pick` uses, so the whole existing pipeline —
branch naming, PR linkage, completion transitions, `jira_track` — applies to
spec-first work unchanged). When the spec has no code links yet, publish also
renames the file to `<key>-<title-slug>.md` and re-ids the requirement to
`REQ-<KEY>` (matching what a pick generates, so both directions converge on
one id regime). When links already exist, the id and filename stay unchanged
— only the frontmatter key is added.

implementations:
  - src/jira/publish.ts:writeBackJiraIdentity

## Acceptance
<!-- id: REQ-JIRAPUB-002.A1 -->
- After publishing a fresh, link-less spec, its frontmatter carries
  `jira_issue:`, its requirement id is `REQ-<KEY>`, and its filename starts
  with the lower-cased key.
<!-- id: REQ-JIRAPUB-002.A2 -->
- Publishing a spec that already has code links adds the frontmatter key but
  leaves the requirement id and filename untouched.
<!-- id: REQ-JIRAPUB-002.A3 -->
- `findSpecForIssueKey` locates the published spec by its key (round-trip with
  the existing pick machinery).

<!-- id: REQ-JIRAPUB-003 -->
## The spec authoring flow MUST offer JIRA publishing when the integration is configured

After any authoring path writes and syncs a spec, and the JIRA integration is
configured, the flow offers exactly one prompt — create a JIRA Story for this
spec? — and on yes runs the publish and reports the created key. When JIRA is
not configured the prompt MUST NOT appear. Declining writes nothing to JIRA
and leaves the spec unchanged.

implementations:
  - commands/specship/spec.md

## Acceptance
<!-- id: REQ-JIRAPUB-003.A1 -->
- The spec door's authoring instructions include the post-write JIRA offer,
  gated on the integration being configured.
<!-- id: REQ-JIRAPUB-003.A2 -->
- The offer names the tool to call, so accepting requires no manual JIRA work.

<!-- id: REQ-JIRAPUB-004 -->
## Commits for a JIRA-backed spec MUST carry the issue key

When the spec being implemented carries `jira_issue:` frontmatter, commits
made by the implement workflow are prefixed with the key (`PROJ-123: …`) so
JIRA's development panel and smart-commit processing link them to the issue.
Specs without a key commit exactly as today.

implementations:
  - src/jira/spec-writer.ts:readSpecJiraKey
  - src/workflows/defaults/spec-implement.yaml

## Acceptance
<!-- id: REQ-JIRAPUB-004.A1 -->
- `readSpecJiraKey` returns the key for a spec file with `jira_issue:`
  frontmatter and null for one without (and for a key mentioned only in the
  body).
<!-- id: REQ-JIRAPUB-004.A2 -->
- The bundled implement workflow instructs the committing step to prefix the
  commit message with the spec's issue key when present.

<!-- id: REQ-JIRAPUB-005 -->
## Verified acceptance evidence MUST advance the matching Sub-task

When an acceptance criterion's evidence is verified (its link passes
`link_verify`), and the spec is JIRA-backed with a Sub-task recorded for that
criterion, the Sub-task is transitioned toward done (transition name
configurable, default `Done`), reusing the skip-tolerant transition semantics.
When every Sub-task of the Story has been advanced, the Story itself is
transitioned the same way. Failures to transition never fail the verify —
the verify result is recorded first, the JIRA push is best-effort and
reported.

implementations:
  - src/jira/publish.ts:advanceSubtaskForAcceptance
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify

## Acceptance
<!-- id: REQ-JIRAPUB-005.A1 -->
- A passing `link_verify` on a JIRA-backed acceptance criterion attempts the
  Sub-task transition with the configured name.
<!-- id: REQ-JIRAPUB-005.A2 -->
- A workflow without the target transition records a skip and the verify
  still succeeds.
<!-- id: REQ-JIRAPUB-005.A3 -->
- A verify on a spec without `jira_issue:` performs no JIRA call.

<!-- id: REQ-JIRAPUB-006 -->
## A drift transition on a JIRA-backed spec MUST surface on the issue

When a spec link genuinely transitions into `drifted` (a transition event, not
a re-observation on every sync), and the owning spec is JIRA-backed, a comment
naming the drifted symbol and the drift axis is added to the issue — once per
transition, never repeated for the same ongoing drift. Comment failures are
reported and never block the sync.

implementations:
  - src/jira/publish.ts:commentSpecDrift

## Acceptance
<!-- id: REQ-JIRAPUB-006.A1 -->
- A link entering `drifted` on a JIRA-backed spec produces one comment naming
  the symbol and axis.
<!-- id: REQ-JIRAPUB-006.A2 -->
- A second sync while the link is still drifted produces no second comment.
<!-- id: REQ-JIRAPUB-006.A3 -->
- Drift on a spec without `jira_issue:` produces no JIRA call.

<!-- id: REQ-JIRAPUB-007 -->
## A release MUST be able to stamp its version onto the issues it ships

Given a version label and a set of JIRA-backed specs (or explicit keys), the
release step ensures a matching project version exists in JIRA (creating it if
missing) and sets it as `fixVersion` on each issue, adding a shipped-in
comment. The operation is idempotent — re-running it neither duplicates the
project version nor the comment.

implementations:
  - src/jira/client.ts:JiraClient.ensureProjectVersion
  - src/jira/client.ts:JiraClient.setFixVersion
  - src/jira/publish.ts:releaseIssues

## Acceptance
<!-- id: REQ-JIRAPUB-007.A1 -->
- Releasing version `v1.2.3` against two keys creates the project version once
  and sets it as fixVersion on both issues.
<!-- id: REQ-JIRAPUB-007.A2 -->
- Re-running the same release call is a no-op: no duplicate version, no
  duplicate shipped-in comment.

<!-- id: REQ-JIRAPUB-008 -->
## JIRA-side edits to a published issue MUST be detectable as drift

Publish records a content fingerprint of what was written to the issue
(summary + description) in the spec's frontmatter. Tracking a JIRA-backed
issue compares the live issue content against that fingerprint and reports a
JIRA-side divergence when they differ, so an issue edited in JIRA after
publish is surfaced instead of silently diverging from the spec. Re-publishing
refreshes the fingerprint and clears the divergence.

implementations:
  - src/jira/publish.ts:issueContentFingerprint
  - src/mcp/jira-tools.ts:handleSpecshipJiraTrack

## Acceptance
<!-- id: REQ-JIRAPUB-008.A1 -->
- Publish writes the fingerprint to frontmatter; track on an unedited issue
  reports no divergence.
<!-- id: REQ-JIRAPUB-008.A2 -->
- After the issue's summary or description is edited in JIRA, track reports
  the divergence and names the issue key.
<!-- id: REQ-JIRAPUB-008.A3 -->
- Re-publishing refreshes the fingerprint and a subsequent track reports no
  divergence.
