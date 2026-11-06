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
jira_issue_REQ-LINKACC-013: SSHIP-841
jira_fingerprint_REQ-LINKACC-013: 4179c2137f99e58b
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
  - src/resolution/body-fingerprint.ts:rebaselineBodyMetadata
  - src/index.ts:SpecShip.rebaselineLinkBody
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
  - server/src/routes/spec.ts:registerSpecRoutes
  - ui/src/review-groups.ts:bodyChangedNotes
  - ui/src/review-groups.ts:classifyRequirement
  - ui/src/pages/review.tsx:ReviewRowItem

verifies:
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A3DashboardPath
  - __tests__/body-fingerprint.test.ts:reqLinkacc004A3NoFingerprintKeepsMarker
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
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.findRepointTarget
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.addedSymbols
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.repointLink
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveAll
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveLinksForFiles
  - src/resolution/spec-link-resolver.ts:nodeLogicalKey
  - src/db/spec-queries.ts:SpecQueries.updateSpecLinkTarget
  - src/db/spec-queries.ts:SpecQueries.hasRepointableLinks
  - src/db/queries.ts:QueryBuilder.getNodeLogicalKeys
  - src/index.ts:SpecShip.indexAll
  - src/index.ts:SpecShip.sync
  - src/index.ts:SpecShip.snapshotNodeKeysForRepoint
  - src/index.ts:SpecShip.persistRepoints
  - src/index.ts:SpecShip.reindexRepointedSpecFile
  - src/spec-quality/link-persist.ts:persistLinkToSpecFile
  - src/resolution/link-repoint.ts:repointedFrom
  - src/resolution/link-repoint.ts:formatRepointedFrom
  - src/resolution/link-repoint.ts:formatRepointNotices
  - src/mcp/spec-tools.ts:formatLink

verifies:
  - __tests__/link-persist.test.ts:repointRewritesBulletInPlace
  - __tests__/link-persist.test.ts:repointDropsOldWhenNewListed
  - __tests__/link-persist.test.ts:repointUnchangedWhenAlreadyMoved
  - __tests__/link-persist.test.ts:repointAppendsWhenNeitherListed
  - __tests__/link-persist.test.ts:repointMatchesDoubleColonName
  - __tests__/link-persist.test.ts:repointKeepsCrlf
  - __tests__/link-persist.test.ts:repointRefusedForUnknownRequirement
  - __tests__/spec-link-repoint.test.ts:reqLinkacc005A1
  - __tests__/spec-link-repoint.test.ts:reqLinkacc005A2
  - __tests__/spec-link-repoint.test.ts:reqLinkacc005A3
  - __tests__/spec-link-repoint.test.ts:reqLinkacc005A4
  - __tests__/spec-link-repoint.test.ts:reqLinkacc005A5
  - __tests__/spec-link-repoint.test.ts:reqLinkacc005SpecWriteBack

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
  - src/verify/report-ingest.ts:coveringRun
  - src/verify/report-ingest.ts:evidenceLinksFor
  - src/index.ts:SpecShip.recordLinkVerification
  - src/mcp/spec-tools.ts:formatLink
  - src/mcp/spec-tools.ts:verificationOf
  - server/src/routes/spec.ts:registerSpecRoutes

verifies:
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006A3OlderFailureCounts
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006PartialCoverageIsHand
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006DashboardGateCountsCriteria
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006A1
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006A2
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006A3
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006A4
  - __tests__/link-verify-run-backed.test.ts:reqLinkacc006DashboardRouteSameRecord

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
SpecShip cannot check MUST be reported as unchecked, never as current.

The claim is written `checked_against: "<package>@<x.y.z>"` (several claims
comma-separated; each is split at its last `@`). The version in use is found
in this order: (1) `package-lock.json` `packages["node_modules/<pkg>"].version`,
(2) `node_modules/<pkg>/package.json`, (3) a probe the project opts into in
`specship.config.json`: `"versionProbes": { "<pkg>": "<command>" }` — the
first x.y.z in its stdout is the version in use. A command named in a spec
file MUST never run; only the config may name probes. A probe has a 3 s
timeout, runs without a shell for its arguments beyond what the command string
needs, and is memoised per process; a failure, a timeout or no match leaves the
claim unchecked. Only `specship lint` runs probes; it saves each result in
`.specship/version-probes.json`. `specship_spec` MUST NOT run a probe (a
retrieval call never waits on a process): it reads the result lint saved, and
a claim lint has not probed yet is unchecked.

implementations:
  - src/spec-lint/version-claims.ts:checkVersionClaims
  - src/spec-lint/version-claims.ts:parseVersionClaims
  - src/spec-lint/version-claims.ts:resolveVersionInUse
  - src/spec-lint/version-claims.ts:findVersionClaimInSource
  - src/spec-lint/version-claims.ts:formatVersionClaim
  - src/spec-lint/version-claims.ts:splitCommand
  - src/spec-lint/version-claims.ts:versionFromLockfile
  - src/spec-lint/version-claims.ts:versionFromNodeModules
  - src/spec-lint/version-claims.ts:configuredProbe
  - src/spec-lint/version-claims.ts:runProbe
  - src/spec-lint/lint.ts:lintSpecs
  - src/spec-lint/lint.ts:lintSpecSource
  - src/spec-lint/lint.ts:versionClaimFindings
  - src/mcp/spec-tools.ts:renderVersionClaims
  - src/mcp/spec-tools.ts:handleSpecshipSpec

verifies:
  - __tests__/spec-version-claims-mcp.test.ts:specToolNeverRunsAProbe
  - __tests__/spec-version-claims-mcp.test.ts:specToolShowsTheResultLintSaved
  - __tests__/spec-version-claims-mcp.test.ts:parseHandlesListsAndBadValues
  - __tests__/spec-lint.test.ts:reqLinkacc008A1
  - __tests__/spec-lint.test.ts:reqLinkacc008A2
  - __tests__/spec-lint.test.ts:reqLinkacc008A3
  - __tests__/spec-lint.test.ts:reqLinkacc008A4
  - __tests__/spec-lint.test.ts:versionInUseFromLockfile
  - __tests__/spec-lint.test.ts:versionInUseFromNodeModules
  - __tests__/spec-lint.test.ts:configuredProbeResolvesVersion
  - __tests__/spec-lint.test.ts:failingOrTimingOutProbeIsUnchecked
  - __tests__/spec-lint.test.ts:specCannotCauseACommandToRun
  - __tests__/spec-version-claims-mcp.test.ts:specToolShowsStaleClaimOfParentDocument
  - __tests__/spec-version-claims-mcp.test.ts:specToolHidesCurrentClaim
  - __tests__/spec-version-claims-mcp.test.ts:specToolShowsUncheckedNeverCurrent

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
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.applyFileDeclaration
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveOneLink
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveFileLink
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveFileLinks
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.fileFingerprint
  - src/resolution/spec-link-resolver.ts:isFileContentLink
  - src/extraction/specs/markdown-spec-extractor.ts:MarkdownSpecExtractor.extractLinkRefBlock
  - src/index.ts:SpecShip.rebaselineLinkOnVerify
  - src/index.ts:SpecShip.indexSpecsInternal

verifies:
  - __tests__/spec-link-file-level.test.ts:reqLinkacc009ExtensionlessPaths
  - __tests__/spec-link-file-level.test.ts:reqLinkacc009A1
  - __tests__/spec-link-file-level.test.ts:reqLinkacc009A2
  - __tests__/spec-link-file-level.test.ts:reqLinkacc009A3
  - __tests__/spec-link-file-level.test.ts:reqLinkacc009A4
  - __tests__/spec-link-file-level.test.ts:verifiedFileLinkFlagsBodyChangeWithoutDrifting
  - __tests__/spec-link-file-level.test.ts:untrackedFileEditDriftsWithNoCodeChange
  - __tests__/spec-link-file-level.test.ts:specEditInSameSyncDoesNotHideFileChange
  - __tests__/spec-link-file-level.test.ts:bareImplementationsBulletIsFileLevel
  - __tests__/spec-link-file-level.test.ts:bareVerifiesBulletStaysNoEdge

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
  - src/spec-lint/commit-suggestions.ts:findRequirementCommits
  - src/spec-lint/commit-suggestions.ts:linkSuggestionFindings
  - src/spec-lint/commit-suggestions.ts:preloadCommitGrammars
  - src/spec-lint/lint.ts:lintSpecs
  - src/spec-lint/lint.ts:formatLintReport
  - src/spec-lint/lint.ts:runLintCli

verifies:
  - __tests__/spec-lint-commit-suggestions.test.ts:reqLinkacc010A1
  - __tests__/spec-lint-commit-suggestions.test.ts:reqLinkacc010A2
  - __tests__/spec-lint-commit-suggestions.test.ts:reqLinkacc010A3
  - __tests__/spec-lint-commit-suggestions.test.ts:reqLinkacc010A4

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
  - src/index.ts:SpecShip.assertSpecLink
  - server/src/routes/spec.ts:registerSpecRoutes

verifies:
  - __tests__/link-assert-writeback-required.test.ts:reqLinkacc011A3RebuiltFromFiles
  - __tests__/link-assert-writeback-required.test.ts:reqLinkacc011A1
  - __tests__/link-assert-writeback-required.test.ts:reqLinkacc011A2
  - __tests__/link-assert-writeback-required.test.ts:reqLinkacc011A3

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

<!-- id: REQ-LINKACC-013 -->
## Verifying a link MUST take a new spec-text baseline

A link stores the hash of its requirement's text from when the link was made,
and a sync drifts the link on the spec side when the requirement's current hash
differs. Verifying a link never updated that stored hash, so a link created
before its requirement's text last changed stayed out of step for good: every
later sync of that spec file drifted it again, although the requirement's text
had not changed since it was verified. On 2026-11-06 nine verified links in
this repository were in that state.

Every way of verifying a link (the `specship_link_verify` tool, the dashboard's
verify action, and a passing test report that promotes a link) MUST store the
requirement's current text hash on the link, and the code signature it
resolves to now when there is one. A failed verification MUST NOT change
either baseline.

implementations:
  - src/mcp/spec-tools.ts:handleSpecshipLinkVerify
  - src/verify/report-ingest.ts:ingestTestReport
  - src/verify/report-ingest.ts:rebaselineOnPass
  - src/index.ts:SpecShip.rebaselineLinkOnVerify
  - src/index.ts:SpecShip.verifyFromReport
  - src/db/spec-queries.ts:SpecQueries.updateSpecLinkSpecBaseline
  - server/src/routes/spec.ts:registerSpecRoutes

verifies:
  - __tests__/link-verify-spec-baseline.test.ts:reqLinkacc013A1
  - __tests__/link-verify-spec-baseline.test.ts:reqLinkacc013A2
  - __tests__/link-verify-spec-baseline.test.ts:reqLinkacc013A3
  - __tests__/link-verify-spec-baseline.test.ts:reqLinkacc013A4
  - __tests__/link-verify-spec-baseline.test.ts:reqLinkacc013A4StaleNodeId
  - __tests__/link-verify-spec-baseline.test.ts:reqLinkacc013A5

## Acceptance
<!-- id: REQ-LINKACC-013.A1 -->
- A link created before its requirement's text changed, then verified, does not
  drift on the next sync of its spec file when that requirement's text is
  unchanged.
<!-- id: REQ-LINKACC-013.A2 -->
- Editing another requirement in the same spec file does not drift a verified
  link of an unchanged requirement.
<!-- id: REQ-LINKACC-013.A3 -->
- Editing the linked requirement's own text after it was verified still drifts
  the link on the spec side.
<!-- id: REQ-LINKACC-013.A4 -->
- The dashboard's verify action and a passing test report take the same new
  baseline as the `specship_link_verify` tool.
<!-- id: REQ-LINKACC-013.A5 -->
- A failed verification leaves both stored baselines as they were.
