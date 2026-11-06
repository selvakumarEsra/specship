---
id: LINKACC-DOC
title: Link and evidence accuracy
owner: specship-core
priority: high
version: 1
epicKey: SSHIP-781
jira_issue_REQ-LINKACC-001: SSHIP-782
jira_fingerprint_REQ-LINKACC-001: 71c657575e0c1b39
jira_issue_REQ-LINKACC-002: SSHIP-786
jira_fingerprint_REQ-LINKACC-002: bb079bdfb08cab81
jira_issue_REQ-LINKACC-003: SSHIP-792
jira_fingerprint_REQ-LINKACC-003: 9542492aba1afa7d
jira_issue_REQ-LINKACC-004: SSHIP-797
jira_fingerprint_REQ-LINKACC-004: fd72ce51e94a46e2
jira_issue_REQ-LINKACC-005: SSHIP-802
jira_fingerprint_REQ-LINKACC-005: 49dc7224c0c67b04
jira_issue_REQ-LINKACC-006: SSHIP-808
jira_fingerprint_REQ-LINKACC-006: 43eedd5da2ce11dd
jira_issue_REQ-LINKACC-007: SSHIP-813
jira_fingerprint_REQ-LINKACC-007: 714e6a8434176d92
jira_issue_REQ-LINKACC-008: SSHIP-818
jira_fingerprint_REQ-LINKACC-008: a510b8c187d760b2
jira_issue_REQ-LINKACC-009: SSHIP-823
jira_fingerprint_REQ-LINKACC-009: ceb83a8d047085dd
jira_issue_REQ-LINKACC-010: SSHIP-828
jira_fingerprint_REQ-LINKACC-010: b8c5f2b801bedfab
jira_issue_REQ-LINKACC-011: SSHIP-833
jira_fingerprint_REQ-LINKACC-011: 493c90bb852e1563
jira_issue_REQ-LINKACC-012: SSHIP-837
jira_fingerprint_REQ-LINKACC-012: bc4c977a40760aef
---

<!-- id: LINKACC-DOC -->
# Link and evidence accuracy

A review on 2026-11-06 traced every hand-fixed link in one long session back
to something SpecShip did not record. A requirement whose criteria all had
passing tests still could not be verified. Drift said only that something
changed. A parameter rename looked the same as a change in behavior, and a
change inside a function body was not seen at all. A moved function left its
links orphaned. A spec's claim that it had been checked against a tool version
was prose that nothing read. This document makes those facts part of the
graph, so that "verified" means something a reader can check.

Merged in: REQ-CODEDRIFT-001 (`specs/code-drift-explanations.md`, explain code
drift) is now REQ-LINKACC-002.

Already in place, and not repeated here: test titles that name a requirement
or criterion become test links (REQ-VSTATE-002), criteria can carry their own
links (REQ-VSTATE-003), a test report can be ingested (REQ-VSTATE-004), the
per-criterion coverage rollup (REQ-VSTATE-006), and asserted links written back
into the spec file (REQ-THRU-005). Most requirements below close a gap in one
of those.

Non-goals: no new agent or model judgement. Every classification below is
derived from the index, the spec files and recorded test runs. No link state
is set by a guess.

<!-- id: REQ-LINKACC-001 -->
## The verify gate MUST count test evidence on a requirement's own criteria

Promoting an `implements` link to `verified` needs test evidence for the
requirement. That evidence MUST include file-derived test links on the
requirement's acceptance criteria, not only links on the requirement itself.
Test titles name criteria (`REQ-X.A3`), so a requirement can have evidence for
every criterion while today's gate still reports "no test evidence is linked
to it".

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify

verifies:
  - __tests__/verified-evidence.test.ts:reqLinkacc001A1
  - __tests__/verified-evidence.test.ts:reqLinkacc001A2
  - __tests__/verified-evidence.test.ts:reqLinkacc001A3
  - __tests__/verified-evidence.test.ts:reqLinkacc001NestedRequirementExcluded
  - __tests__/verified-evidence.test.ts:reqLinkacc001LookalikeIdExcluded

## Acceptance
<!-- id: REQ-LINKACC-001.A1 -->
- A requirement with no test links of its own, whose criteria have
  file-derived test links from test titles, can have its `implements` link
  promoted to `verified`.
<!-- id: REQ-LINKACC-001.A2 -->
- A requirement with no test links on itself or on any of its criteria is
  still refused, with the existing message.
<!-- id: REQ-LINKACC-001.A3 -->
- An agent-asserted test link on a criterion does not count, the same as on
  the requirement (REQ-REVINT-005.A2).

<!-- id: REQ-LINKACC-002 -->
## Code drift MUST say what changed

When a linked symbol's signature changes, the link MUST record the kind of
change: `rename-only` (same parameter count and types, and the same return
type, with different parameter names), `type-change` (any parameter or return
type differs), or `shape-change` (parameters were added or removed, or the
signature and the body both changed in a way that is neither of the others).
A link with no signature baseline (file-level and test-title links carry
none on purpose) MUST NOT start drifting because of this requirement: it keeps
its state. When a link
does drift and either signature cannot be parsed or compared, the kind MUST be
`unclassified`. SpecShip MUST NOT infer a more specific kind from a hash
difference alone. The kind MUST appear wherever the
drifted link is shown: `specship_spec`, `specship drifted` and the dashboard's
Review screen.

The kind is an explanation. On its own it MUST NOT change a link's state or
count as verification. Only a recorded passing test run can clear a
`rename-only` drift (REQ-LINKACC-003). A change to the body alone is not a
drift (REQ-LINKACC-004). This requirement absorbs REQ-CODEDRIFT-001, merged on
2026-11-06.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveOneLink
  - ui/src/review-groups.ts:driftReason
  - src/resolution/signature-drift.ts:classifySignatureDrift
  - src/resolution/signature-drift.ts:parseSignature
  - src/resolution/signature-drift.ts:formatDriftLabel
  - src/resolution/signature-drift.ts:formatDriftedLine
  - src/db/spec-queries.ts:SpecQueries.updateSpecLinkState
  - src/mcp/spec-tools.ts:formatLink
  - src/db/spec-queries.ts:SpecQueries.insertSpecLink
  - src/db/spec-queries.ts:SpecQueries.upsertSpecLink
  - src/db/spec-queries.ts:rowToSpecLink
  - ui/src/pages/review.tsx:ReviewRowItem

verifies:
  - __tests__/signature-drift.test.ts:reqLinkacc002A1
  - __tests__/signature-drift.test.ts:reqLinkacc002A1Classifier
  - __tests__/signature-drift.test.ts:reqLinkacc002A2
  - __tests__/signature-drift.test.ts:reqLinkacc002A2Stored
  - __tests__/signature-drift.test.ts:reqLinkacc002A3
  - __tests__/signature-drift.test.ts:reqLinkacc002A3Resolver
  - __tests__/signature-drift.test.ts:reqLinkacc002A4
  - __tests__/signature-drift.test.ts:reqLinkacc002A5
  - __tests__/signature-drift.test.ts:reqLinkacc002A3WhitespaceOnly
  - ui/src/__tests__/review.test.tsx:reviewRowShowsDriftKind

## Acceptance
<!-- id: REQ-LINKACC-002.A1 -->
- Renaming a linked function's parameter from `installClaude: boolean` to
  `hasStatusLine: boolean` drifts its link with kind `rename-only`.
<!-- id: REQ-LINKACC-002.A2 -->
- Changing a parameter's type, the return type, or the number of parameters
  drifts the link with kind `type-change` or `shape-change`.
<!-- id: REQ-LINKACC-002.A3 -->
- A link with no signature baseline does not start drifting. A link that
  drifts while either signature cannot be parsed drifts with kind
  `unclassified`, never `rename-only`.
<!-- id: REQ-LINKACC-002.A4 -->
- `specship drifted` and `specship_spec` print the kind next to each drifted
  link.
<!-- id: REQ-LINKACC-002.A5 -->
- Recording the kind, including `rename-only`, leaves the link `drifted`. It
  neither clears the drift nor promotes the link.

<!-- id: REQ-LINKACC-003 -->
## A rename-only drift MUST clear itself when the requirement's tests pass on the current commit

A link that drifted with kind `rename-only` MUST return to the state it had
before the drift once a recorded test run on the current commit passes for
every test link of that requirement and its criteria (REQ-LINKACC-006). Until
then it stays `drifted` with kind `rename-only`. A drift of any other kind
never clears this way. A `verified` link never code-drifts in the first place
(sticky states, DOM-SPECSHIP-001), so in practice the state restored is
`implemented`. A link that drifted before this requirement shipped has no
recorded prior state, so it stays `drifted` until it is verified by hand.

implementations:
  - src/verify/report-ingest.ts:ingestTestReport
  - src/verify/report-ingest.ts:clearRenameOnlyDrift
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveOneLink
  - src/db/spec-queries.ts:SpecQueries.updateSpecLinkSigBaseline
  - src/index.ts:SpecShip.verifyFromReport

verifies:
  - __tests__/verify-report.test.ts:reqLinkacc003A1
  - __tests__/verify-report.test.ts:reqLinkacc003A1EndToEnd
  - __tests__/verify-report.test.ts:reqLinkacc003EndToEndFailingTestKeepsDrift
  - __tests__/verify-report.test.ts:reqLinkacc003A2
  - __tests__/verify-report.test.ts:reqLinkacc003A3
  - __tests__/verify-report.test.ts:reqLinkacc003A4
  - __tests__/verify-report.test.ts:reqLinkacc003NoCommitClearsNothing
  - __tests__/verify-report.test.ts:reqLinkacc003KindChangedSinceDrift
  - __tests__/signature-drift.test.ts:reqLinkacc003PreDriftSaved

## Acceptance
<!-- id: REQ-LINKACC-003.A1 -->
- An `implemented` link that drifted `rename-only` in a real sync is
  `implemented` again, with its signature baseline updated, after a report
  from the current commit records all of the requirement's tests passing.
<!-- id: REQ-LINKACC-003.A2 -->
- The same report with one of those tests failing leaves the link `drifted`.
<!-- id: REQ-LINKACC-003.A3 -->
- A report recorded on an older commit clears nothing.
<!-- id: REQ-LINKACC-003.A4 -->
- A `type-change` or `shape-change` drift is not cleared by a passing report.

<!-- id: REQ-LINKACC-004 -->
## A change to a linked symbol's body MUST be flagged without changing the link's state

Each code link MUST keep a fingerprint of its symbol's body next to the
signature baseline. When the body changes and the signature does not, the
link MUST carry a "body changed since <state>" marker in `specship_spec` and
Review, and its state MUST NOT change. Re-verifying the link MUST take a new
baseline and remove the marker. Whitespace-only and comment-only edits MUST
NOT set the marker.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveOneLink
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.checkBodyChange
  - src/resolution/body-fingerprint.ts:fingerprintBody
  - src/resolution/body-fingerprint.ts:stripCommentsAndWhitespace
  - src/resolution/body-fingerprint.ts:readNodeBody
  - src/resolution/body-fingerprint.ts:nodeBodyFingerprint
  - src/resolution/body-fingerprint.ts:bodyChangedSince
  - src/index.ts:SpecShip.linkBodyFingerprint
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify
  - src/mcp/spec-tools.ts:handleSpecshipLinkAssert
  - src/mcp/spec-tools.ts:formatLink
  - src/verify/report-ingest.ts:clearRenameOnlyDrift
  - src/verify/report-ingest.ts:ingestTestReport
  - src/graph/spec-coverage.ts:rollup
  - ui/src/review-groups.ts:bodyChangedNotes
  - ui/src/review-groups.ts:classifyRequirement
  - ui/src/pages/review.tsx:ReviewRowItem

verifies:
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A1
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A1Implemented
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A2
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A2Normalizer
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A2Python
  - __tests__/body-fingerprint.test.ts:reqLinkacc004UnknownLanguage
  - __tests__/body-fingerprint.test.ts:reqLinkacc004UnknownLanguageMarked
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A3
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A4
  - ui/src/__tests__/review.test.tsx:reqLinkacc004A1Review

## Acceptance
<!-- id: REQ-LINKACC-004.A1 -->
- Changing one statement inside a verified function, with its signature
  unchanged, leaves the link `verified` and shows "body changed since
  verified".
<!-- id: REQ-LINKACC-004.A2 -->
- Re-indenting the function or editing only a comment inside it sets no
  marker.
<!-- id: REQ-LINKACC-004.A3 -->
- Verifying the link again removes the marker.
<!-- id: REQ-LINKACC-004.A4 -->
- No drift-queue entry is created for a body-only change.

<!-- id: REQ-LINKACC-005 -->
## An orphaned link MUST follow its symbol across a rename or a move

When a link's target disappears, the resolver MUST look for exactly one
symbol of the same kind, added in the same pass, whose body fingerprint
(REQ-LINKACC-004) matches the old one. If it finds one, the link MUST
re-point to it, keep its state, and record the old and new location. If it
finds none, or more than one, the link MUST stay `orphaned`, as it does today.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveOneLink
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.findLogicalTarget

## Acceptance
<!-- id: REQ-LINKACC-005.A1 -->
- Moving a linked function unchanged to another file re-points its link to
  the new file and keeps its state.
<!-- id: REQ-LINKACC-005.A2 -->
- Renaming a linked function without changing its body re-points the link to
  the new name.
<!-- id: REQ-LINKACC-005.A3 -->
- When two new symbols have the same matching body, the link stays
  `orphaned`.
<!-- id: REQ-LINKACC-005.A4 -->
- A deleted symbol with no match stays `orphaned`.
<!-- id: REQ-LINKACC-005.A5 -->
- The re-pointed link shows where it came from in `specship_spec`.

<!-- id: REQ-LINKACC-006 -->
## A verification MUST record the test run it rests on

When a recorded test report covers a link's evidence, verifying that link
MUST store the run's commit, time and per-test results. A free-text reason
MUST NOT be required in that case. A verification with no recorded run MUST
still be allowed, and MUST be shown as "verified by hand" next to the
reason given. `specship_spec` MUST show which of the two backs each verified
link.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify
  - src/verify/report-ingest.ts:ingestTestReport

## Acceptance
<!-- id: REQ-LINKACC-006.A1 -->
- After a report is ingested, verifying a link whose evidence the report
  covers stores the report's commit and time and needs no reason.
<!-- id: REQ-LINKACC-006.A2 -->
- Verifying a link that no report covers still works, and the link is shown
  as "verified by hand" with its reason.
<!-- id: REQ-LINKACC-006.A3 -->
- A report in which one of the link's tests failed makes a `pass` verify
  fail, naming the failing test.
<!-- id: REQ-LINKACC-006.A4 -->
- `specship_spec` names the commit of the run behind each run-backed
  verified link.

<!-- id: REQ-LINKACC-007 -->
## A verified requirement MUST show which of its criteria have no test

When a requirement is `verified` but one or more of its acceptance criteria
has no test link, `specship_spec`, `specship spec list` and the Review screen
MUST show the requirement as verified with the count of untested criteria,
and `specship_spec` MUST name them. A requirement whose criteria all have
tests MUST show no count.

implementations:
  - src/graph/spec-coverage.ts:computeSpecCoverage
  - src/graph/spec-coverage.ts:untestedCriteria
  - src/graph/spec-coverage.ts:formatVerifiedSuffix
  - src/mcp/spec-tools.ts:buildInventory
  - src/mcp/spec-tools.ts:inventoryRows
  - src/mcp/spec-tools.ts:handleSpecshipSpec
  - ui/src/review-groups.ts:classifyRequirement
  - ui/src/review-groups.ts:untestedCriteriaCount
  - ui/src/pages/review.tsx:ReviewRowItem

verifies:
  - __tests__/spec-coverage-untested.test.ts:reqLinkacc007A1
  - __tests__/spec-coverage-untested.test.ts:reqLinkacc007A2
  - __tests__/spec-coverage-untested.test.ts:reqLinkacc007A3
  - __tests__/spec-coverage-untested.test.ts:reqLinkacc007A4
  - __tests__/spec-coverage-untested.test.ts:reqLinkacc007A3OtherLinkKinds
  - __tests__/spec-coverage-untested.test.ts:reqLinkacc007A1SpecListCli

## Acceptance
<!-- id: REQ-LINKACC-007.A1 -->
- A verified requirement with four criteria, two of them tested, shows
  "verified · 2 of 4 criteria untested" and names the two.
<!-- id: REQ-LINKACC-007.A2 -->
- A verified requirement whose criteria are all tested shows plain
  "verified".
<!-- id: REQ-LINKACC-007.A3 -->
- The count comes from the coverage rollup, so Review and `specship_spec`
  agree.
<!-- id: REQ-LINKACC-007.A4 -->
- A requirement that is not verified shows no untested-criteria count, even
  when it has untested criteria.

<!-- id: REQ-LINKACC-008 -->
## A spec's claim that it was checked against a dependency version MUST be checked

A spec MAY record, in its frontmatter, the version of an external tool or
package its requirements were checked against. SpecShip MUST compare that
claim with the version the project now uses and flag the spec in
`specship lint` and `specship_spec` when the version in use is newer. A claim
SpecShip cannot check MUST be reported as unchecked, never as current. How the
version in use is found (the lockfile for a package, a probe command for an
installed CLI) is [needs review].

implementations:
  - src/spec-lint/lint.ts:lintSpecs

## Acceptance
<!-- id: REQ-LINKACC-008.A1 -->
- A spec claiming `@google/gemini-cli 0.28.0` is flagged when the version in
  use is 0.67.0, and the flag names both versions.
<!-- id: REQ-LINKACC-008.A2 -->
- The same claim is not flagged when 0.28.0 is still in use.
<!-- id: REQ-LINKACC-008.A3 -->
- A claim whose version in use cannot be found is reported as unchecked.
<!-- id: REQ-LINKACC-008.A4 -->
- A malformed claim is a lint error naming the frontmatter key.

<!-- id: REQ-LINKACC-009 -->
## A bare-path implementation MUST drift when its file changes

An `implementations:` bullet that names only a file creates no link today, so
a change to that file is never noticed. Such a bullet MUST create a file-level
link with a fingerprint of the file's content. A content change MUST drift
the link with kind `file-change`. The lint warning for bare paths MUST
change to say that the link is file-level.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.applyDeclarationCandidates

## Acceptance
<!-- id: REQ-LINKACC-009.A1 -->
- A spec listing `- scripts/build-gemini-extension.mjs` gets a link to that
  file after sync.
<!-- id: REQ-LINKACC-009.A2 -->
- Editing the file drifts the link with kind `file-change`.
<!-- id: REQ-LINKACC-009.A3 -->
- Touching the file without changing its content does not drift it.
<!-- id: REQ-LINKACC-009.A4 -->
- A bare path to a file that does not exist leaves the link `orphaned`.

<!-- id: REQ-LINKACC-010 -->
## SpecShip SHOULD suggest links the implementing commits imply

For a requirement whose commits can be found (commit messages naming the
requirement or its JIRA key), `specship lint` SHOULD list the symbols those
commits changed that the requirement does not link, as suggestions. It MUST
NOT add any link itself. Test files and symbols already linked by another
requirement in the same commit MUST NOT be suggested.

implementations:
  - src/spec-lint/lint.ts:lintSpecs

## Acceptance
<!-- id: REQ-LINKACC-010.A1 -->
- A requirement whose commit changed five symbols, two of them linked, gets
  the other three as suggestions.
<!-- id: REQ-LINKACC-010.A2 -->
- No spec file or link changes as a result.
<!-- id: REQ-LINKACC-010.A3 -->
- A requirement with no identifiable commit gets no suggestions and no error.
<!-- id: REQ-LINKACC-010.A4 -->
- Changed test files are not suggested as implementations.

<!-- id: REQ-LINKACC-011 -->
## An asserted link MUST NOT exist only in the index

`specship_link_assert` MUST record a link only when it can also write it into
the spec file. When the write-back fails, it MUST record nothing and say what
to add to the spec by hand. This removes the index-only links that disappear
on a full re-index.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkAssert
  - src/spec-quality/link-persist.ts:persistLinkToSpecFile

## Acceptance
<!-- id: REQ-LINKACC-011.A1 -->
- An assert that writes into the spec records the link, as today.
<!-- id: REQ-LINKACC-011.A2 -->
- An assert whose write-back fails records no link, and its message names the
  bullet to add and the spec file.
<!-- id: REQ-LINKACC-011.A3 -->
- After a full `specship index`, every link that `specship_link_assert`
  reported as recorded still exists.

<!-- id: REQ-LINKACC-012 -->
## specship_spec MUST show where each link came from and how much to trust it

Every link `specship_spec` shows MUST name its provenance (declared in the
spec, a code comment, a test title, asserted by an agent, or followed across
a move) and its confidence. This is mostly in place today. The requirement
adds the followed-across-a-move provenance from REQ-LINKACC-005, and keeps
the rest from regressing.

implementations:
  - src/mcp/spec-tools.ts:formatLink

## Acceptance
<!-- id: REQ-LINKACC-012.A1 -->
- Each link line in `specship_spec` names its provenance and confidence.
<!-- id: REQ-LINKACC-012.A2 -->
- A link re-pointed by REQ-LINKACC-005 shows the followed-across-a-move
  provenance.
<!-- id: REQ-LINKACC-012.A3 -->
- A link with no recorded confidence shows its provenance without a
  confidence figure, rather than a made-up one.
