---
id: MULTIDEV-DOC
title: Multiple developers and branches on a shared repository
owner: core
priority: high
version: 1
epicKey: SSHIP-600
jira: SSHIP-606
depends_on: [LINK-TRUTH-DOC, JIRA-TEAM-DOC]
jira_issue_REQ-MULTIDEV-001: SSHIP-601
jira_fingerprint_REQ-MULTIDEV-001: 0d53f50b17925107
jira_issue_REQ-MULTIDEV-002: SSHIP-606
jira_fingerprint_REQ-MULTIDEV-002: 02aac467ff0a73f2
jira_issue_REQ-MULTIDEV-003: SSHIP-613
jira_fingerprint_REQ-MULTIDEV-003: 95eff5dffd8ec219
jira_issue_REQ-MULTIDEV-004: SSHIP-618
jira_fingerprint_REQ-MULTIDEV-004: 6953e12d2b6c3a2b
jira_issue_REQ-MULTIDEV-005: SSHIP-624
jira_fingerprint_REQ-MULTIDEV-005: a71d8111395be015
---

<!-- id: MULTIDEV-DOC -->
# Multiple developers and branches on a shared repository

Git is the only shared source of truth. Specs, their `implementations:` /
`verifies:` blocks and `specship.config.json` are committed and merged like
code. Each developer's `.specship/` index is local and can be rebuilt from any
checkout, and CI builds its own index rather than reusing a developer's. Nothing
SpecShip generates is ever merged.

That only holds if every fact the team relies on after a merge comes from the
checked-out files. Today it doesn't, in four ways:

- Two branches can each add the same requirement ID in different spec files.
  After merging, one silently overwrites the other. The duplicate check only
  looks inside one file.
- A spec file deleted on a branch, or missing on the branch just checked out,
  keeps its specs and links in the index. They show up as drift that isn't
  real.
- Nothing records which branch or commit the index was built from, so a stale
  index looks current.
- Every developer machine that syncs can publish to JIRA. Branches that
  publish the same spec create duplicate issues and conflicting frontmatter.

**Non-goals.** A shared or server-side index; merging SpecShip's database;
resolving git merge conflicts; locking spec IDs across open branches before
they merge (collisions are caught at merge, not prevented at authoring); and
any change to how links are written into spec files (LINK-TRUTH-DOC already
covers that).

**Test plan.** Unit tests cover the cross-file ID check, the merge checks and
the pruning against temp repos built with real `git init` / branch / merge.
The status tests move HEAD in a temp repo. The JIRA policy tests use the
existing fake JIRA client and set `CI` and the branch via the environment.

<!-- id: REQ-MULTIDEV-001 -->
## A requirement ID declared in more than one spec file MUST be an error

`specship lint` MUST report, as an error, any spec ID that is declared in more
than one spec file of the checkout, naming every file and line that declares
it. This is the check that catches two branches choosing the same ID once they
are merged. The existing duplicate-within-one-file error is unchanged.

implementations:
  - src/spec-lint/lint.ts:lintSpecs
  - src/spec-lint/lint.ts:findCrossFileDuplicates
  - src/spec-lint/lint.ts:collectIdDeclarations

verifies:
  - __tests__/spec-lint.test.ts:reqMultidev001A1
  - __tests__/spec-lint.test.ts:reqMultidev001A2
  - __tests__/spec-lint.test.ts:reqMultidev001A3
  - __tests__/spec-lint.test.ts:reqMultidev001A4

## Acceptance
<!-- id: REQ-MULTIDEV-001.A1 -->
- Two spec files that both declare `REQ-X-001` make `specship lint` exit
  non-zero with an error-severity finding that lists both file paths and
  their line numbers.
<!-- id: REQ-MULTIDEV-001.A2 -->
- After merging two branches that each added `REQ-X-004` in a different spec
  file, `specship lint` on the merged checkout reports that collision.
<!-- id: REQ-MULTIDEV-001.A3 -->
- A checkout where every ID is declared once produces no new finding, and the
  existing within-file `spec_duplicate_id` behaviour is unchanged.
<!-- id: REQ-MULTIDEV-001.A4 -->
- Linting a subset of files (`specship lint <paths>`) still detects a
  collision between a linted file and an unlinted spec file elsewhere in the
  checkout.

<!-- id: REQ-MULTIDEV-002 -->
## `specship check` MUST report links that won't survive a merge or that the branch broke

The enforcement gate MUST gain merge checks that work on the checked-out tree
alone, with no developer index needed:

- **undeclared links:** a link whose relationship exists only in the index (an
  `agent-asserted` link) and is not declared in any spec file's
  `implementations:` / `verifies:` block or by an `@implements` /
  `@verifies` code comment. A fresh clone would never see it.
- **branch-broken links:** with `--since <ref>`, a link that resolved at
  `<ref>` but is `orphaned` or `broken` on the checkout, which shows the
  branch broke it.

These checks follow the existing gating model. They are advisory by default
and gate only when enabled under `enforce.gate` in `specship.config.json` or
with `--strict`. Each finding names the spec ID, the link target and the
reason.

implementations:
  - src/enforce/enforce.ts:evaluateEnforcement
  - src/enforce/changed-files.ts:changedFilesSince
  - src/enforce/enforce.ts:undeclaredLinkFindings
  - src/enforce/enforce.ts:branchBrokenFindings
  - src/enforce/changed-files.ts:existedAtRef
  - src/index.ts:SpecShip.getEnforce
  - src/index.ts:SpecShip.prepareEnforce

verifies:
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A1
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A2
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A2Method
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A3
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A3Repo
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A4
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A5
  - __tests__/multidev-merge-checks.test.ts:reqMultidev002A6

## Acceptance
<!-- id: REQ-MULTIDEV-002.A1 -->
- An `agent-asserted` link with no matching spec-file declaration or code
  comment is reported as an undeclared-link finding. A link declared in an
  `implementations:` block is not reported.
<!-- id: REQ-MULTIDEV-002.A2 -->
- On a branch that renames a function linked from `main`,
  `specship check --since main` reports that link as branch-broken, naming the
  spec ID and the old target.
<!-- id: REQ-MULTIDEV-002.A3 -->
- A link already `orphaned` at `<ref>` is not reported as branch-broken.
<!-- id: REQ-MULTIDEV-002.A4 -->
- With no gating configured, findings are printed and `specship check` exits
  0. With the check enabled under `enforce.gate`, or with `--strict`, the same
  findings exit non-zero.
<!-- id: REQ-MULTIDEV-002.A5 -->
- An unresolvable `--since` ref exits non-zero with the existing error, and
  never falls back to a full-repo run.
<!-- id: REQ-MULTIDEV-002.A6 -->
- In a fresh CI clone (`specship init` + `index`, no developer `.specship/`),
  `specship check --since origin/main --json` lists both checks' findings.

<!-- id: REQ-MULTIDEV-003 -->
## Specs from spec files no longer in the checkout MUST be removed on sync

On every `specship sync` and `specship index`, specs whose spec file no longer
exists in the checkout MUST be removed from the index, together with their
links, acceptance criteria and virtual nodes. This covers a deleted file and a
branch switch where the file doesn't exist. Switching back to a branch that has
the file restores them on the next sync, because the file is the source of
truth. Removed links MUST NOT be reported as drift.

implementations:
  - src/index.ts:SpecShip.indexSpecsInternal
  - src/index.ts:SpecShip.indexSpecs
  - src/index.ts:SpecShip.pruneMissingSpecFiles
verifies:
  - __tests__/spec-file-removal.test.ts:reqMultidev003A1
  - __tests__/spec-file-removal.test.ts:reqMultidev003A2
  - __tests__/spec-file-removal.test.ts:reqMultidev003A3
  - __tests__/spec-file-removal.test.ts:reqMultidev003A4
  - __tests__/spec-file-removal.test.ts:reqMultidev003ScopedRootsKeepOthers

## Acceptance
<!-- id: REQ-MULTIDEV-003.A1 -->
- After deleting `specs/foo.md` and running `specship sync`, none of its spec
  IDs appear in `specship spec --list`, and `specship drifted` lists none of
  its links.
<!-- id: REQ-MULTIDEV-003.A2 -->
- Switching to a branch that lacks `specs/foo.md` and syncing removes its
  specs and links. Switching back and syncing restores them, with links
  re-resolved from the file's `implementations:` / `verifies:` blocks.
<!-- id: REQ-MULTIDEV-003.A3 -->
- Specs and links from spec files that are still present are untouched,
  including their `verified` state and evidence.
<!-- id: REQ-MULTIDEV-003.A4 -->
- A sync after only a code change does not remove any spec.

<!-- id: REQ-MULTIDEV-004 -->
## `specship status` MUST show the branch and commit the index was built from

Every full or incremental sync and every index MUST record the branch name and
commit it ran against. `specship status`, both human and `--json` output, MUST
show the recorded branch and commit and the checkout's current HEAD. When they
differ, or the checkout has uncommitted changes to tracked source or spec files,
it MUST say the index may be stale and name `specship sync` as the fix. This is
report-only: no command re-indexes because HEAD moved. Outside a git repository
the fields are absent and nothing is reported.

implementations:
  - src/sync/worktree.ts:detectWorktreeIndexMismatch

## Acceptance
<!-- id: REQ-MULTIDEV-004.A1 -->
- Right after `specship sync`, `specship status --json` reports
  `indexedBranch`, `indexedCommit` and `headCommit`, with `indexedCommit`
  equal to `headCommit` and no staleness flag.
<!-- id: REQ-MULTIDEV-004.A2 -->
- After `git checkout` to another commit with no sync, `status` reports the
  index as possibly stale and names `specship sync`. After the sync, the flag
  clears.
<!-- id: REQ-MULTIDEV-004.A3 -->
- A detached HEAD records the commit with no branch name and still reports
  staleness correctly.
<!-- id: REQ-MULTIDEV-004.A4 -->
- In a directory that is not a git repository, `status` omits the fields and
  prints no staleness notice. No command fails.
<!-- id: REQ-MULTIDEV-004.A5 -->
- No CLI or MCP command triggers a sync because HEAD moved.

<!-- id: REQ-MULTIDEV-005 -->
## A repo MAY require JIRA publishing to happen only in CI on its main branch

A new opt-in binding setting `jira.publishFrom: "ci"` in
`specship.config.json` MUST restrict every JIRA create or update of a spec issue
to a run where the environment reports CI (`CI=true`) and the checkout is on
the configured publish branch (`jira.publishBranch`, default `main`). Anywhere
else, every publishing path defers instead of writing to JIRA: authoring-time
intake (REQ-JIRATEAM-006), sync auto-publish, `specship jira publish` and the
`specship_jira_publish` MCP tool. Each records the spec as pending and says
publishing happens in CI after merge.

Under this mode, the authoring intake gate and the implement-time anchor gate
(REQ-JIRATEAM-007) MUST accept the spec's epic anchor (`epicKey` in frontmatter
or the binding default) in place of an issue key, so work can start before the
issue exists. With the setting absent, behaviour is exactly as today. CI never
writes to git. Before creating an issue, publishing MUST look in the bound JIRA
project for an existing issue carrying the requirement's ID and fingerprint. If
one exists, it is updated instead of a new one being created. A key found this
way is used even if it never makes it back into the spec file.

implementations:
  - src/jira/auto-publish.ts:autoPublishSpecsOnSync
  - src/jira/publish.ts:publishSpecToJira
  - src/jira/repo-config.ts:loadRepoJiraBinding

## Acceptance
<!-- id: REQ-MULTIDEV-005.A1 -->
- With `jira.publishFrom: "ci"` and `CI` unset, `specship jira publish
  --pending`, sync auto-publish and `specship_jira_publish` make no JIRA write
  and report the spec as pending CI publication.
<!-- id: REQ-MULTIDEV-005.A2 -->
- With the setting, `CI=true` and the checkout on `main`,
  `specship jira publish --pending` publishes every pending spec.
<!-- id: REQ-MULTIDEV-005.A3 -->
- With the setting and `CI=true` on any other branch, nothing is published
  and the output names the configured publish branch.
<!-- id: REQ-MULTIDEV-005.A4 -->
- Under the setting, `/specship:spec implement` on a spec with an `epicKey`
  and no issue key passes the anchor gate. Without an epic anchor it is still
  refused.
<!-- id: REQ-MULTIDEV-005.A5 -->
- Running the CI publish twice on the same commit, where the spec file still
  has no `jira_issue` key, creates no duplicate JIRA issue. The second run
  finds the issue created by the first and updates it.
<!-- id: REQ-MULTIDEV-005.A7 -->
- The CI publish makes no git commit or push.
<!-- id: REQ-MULTIDEV-005.A6 -->
- With `jira.publishFrom` absent, every existing JIRA test passes unchanged.
