---
id: KNOWLEDGE-DOC
title: Knowledge that compounds — external facts, enforcement, proposals (0.30)
owner: specship-core
priority: high
version: 1
jira_issue_REQ-KNOW-001: SSHIP-409
jira_fingerprint_REQ-KNOW-001: 4df61a1ca0bdaa4f
jira_issue_REQ-KNOW-002: SSHIP-412
jira_fingerprint_REQ-KNOW-002: 03b15afa1d03b5ab
jira_issue_REQ-KNOW-003: SSHIP-416
jira_fingerprint_REQ-KNOW-003: 1a074edba59e3a15
jira_issue_REQ-KNOW-004: SSHIP-421
jira_fingerprint_REQ-KNOW-004: effc45a02df96608
jira_issue_REQ-KNOW-005: SSHIP-426
jira_fingerprint_REQ-KNOW-005: bca8faccb8648e10
jira_issue_REQ-KNOW-006: SSHIP-429
jira_fingerprint_REQ-KNOW-006: f75734fc63d1792c
jira_issue_REQ-KNOW-007: SSHIP-432
jira_fingerprint_REQ-KNOW-007: f00e6ba0a0aa711f
---

<!-- id: KNOWLEDGE-DOC -->
# Knowledge that compounds — external facts, enforcement, proposals (0.30)

SpecShip keeps human-confirmed domain facts (`specs/domain/`, types term /
rule / decision / constraint) and surfaces them inline when a spec or term is
looked up. What it does not keep is the knowledge a team learns while
building — especially facts about the tools it integrates with. On
2026-10-26 three Gemini CLI 0.28 facts (hook ordering, `[[rule]]` policy
tables, bare MCP tool names) were each rediscovered from source, lived only in
spec prose, and two of them caused shipped-looking bugs that only human review
caught.

This document makes such facts first-class: an `external` fact type pinned to
a dependency version, staleness when that version changes, machine-enforced
rules a fact can carry, pinned fixture tests, proposals drafted by the
implement workflow for a human to confirm, and a knowledge view.

The capture rule is unchanged: domain knowledge is human-confirmed, never
auto-extracted (DOM-SPECSHIP-003). The pipeline may only propose.

Non-goals: semantic contradiction detection between prose facts and specs;
auto-applying proposals; a hosted knowledge service.

<!-- id: REQ-KNOW-001 -->
## Domain facts MUST support an external type pinned to a dependency version

A domain fact MAY have `type: external`, describing a fact about a third-party
tool or library. An external fact MUST carry `dependency` (the package or tool
name), `version` (the version it was verified against) and `source` (where it
was verified, e.g. a file and symbol in that dependency). Missing any of the
three is a lint error; the fact still indexes.

implementations:
  - src/extraction/specs/markdown-spec-extractor.ts:MarkdownSpecExtractor
  - src/spec-lint/lint.ts:lintSpecSource

verifies:
  - __tests__/knowledge.test.ts:externalFactIndexesWithProvenance
  - __tests__/knowledge.test.ts:externalFactWithoutProvenanceIsALintError

## Acceptance
<!-- id: REQ-KNOW-001.A1 -->
- A `specs/domain/*.md` fact with `type: external`, `dependency`, `version` and `source` indexes as a domain fact with no warning, and its provenance is readable from its metadata.
<!-- id: REQ-KNOW-001.A2 -->
- An external fact missing `dependency`, `version` or `source` produces a lint error naming the missing field.

<!-- id: REQ-KNOW-002 -->
## External facts MUST go stale when their dependency version changes

A `specship knowledge stale` command MUST compare each external fact's
`version` with the installed version of its `dependency` (the project's
`node_modules`, then the global npm root) and report facts whose installed
version differs, with both versions. A dependency that cannot be found is
reported as unverifiable, never as fresh. The command MUST exit non-zero when
any fact is stale, and the SessionStart summary MUST print one line when
stale facts exist.

implementations:
  - src/knowledge/stale.ts:findStaleExternalFacts
  - src/knowledge/stale.ts:resolveInstalledVersion

verifies:
  - __tests__/knowledge.test.ts:versionChangeMakesFactStale
  - __tests__/knowledge.test.ts:matchingVersionIsFresh
  - __tests__/knowledge.test.ts:missingDependencyIsUnverifiable

## Acceptance
<!-- id: REQ-KNOW-002.A1 -->
- An external fact verified against 0.28.0 whose dependency is installed at 0.29.0 is reported stale with both versions, and the command exits non-zero.
<!-- id: REQ-KNOW-002.A2 -->
- A fact whose installed version matches is not reported.
<!-- id: REQ-KNOW-002.A3 -->
- A fact whose dependency is not installed anywhere it looks is reported as unverifiable and does not count as fresh.

<!-- id: REQ-KNOW-003 -->
## A fact MAY carry machine-enforced rules, and violations MUST be reported

A domain fact MAY include an `## Enforced` section whose bullets read
`` `<glob>` must not match `/<regex>/` ``. A `specship knowledge check`
command MUST scan the files matching each glob and report every match as a
violation naming the fact, file and line, exiting non-zero when any exist.
The postcheck (REQ-PIPETRUST-005) MUST run it as a built-in check. A
malformed enforced bullet is a lint error.

implementations:
  - src/knowledge/enforce.ts:parseEnforcedRules
  - src/knowledge/enforce.ts:checkEnforcedRules
  - src/spec-quality/postcheck.ts:runPostcheck

verifies:
  - __tests__/knowledge.test.ts:enforcedRuleFlagsViolation
  - __tests__/knowledge.test.ts:enforcedRulePassesCleanTree
  - __tests__/knowledge.test.ts:malformedEnforcedBulletIsALintError
  - __tests__/spec-postcheck.test.ts:postcheckRunsKnowledgeCheck

## Acceptance
<!-- id: REQ-KNOW-003.A1 -->
- A fact enforcing `` `src/**/*.ts` must not match `/\[\[rules\]\]/` `` reports a file containing `[[rules]]` with its line number and makes the command exit non-zero.
<!-- id: REQ-KNOW-003.A2 -->
- With no matches the command exits zero and prints a clean summary.
<!-- id: REQ-KNOW-003.A3 -->
- An `## Enforced` bullet that does not follow the form is a lint error.
<!-- id: REQ-KNOW-003.A4 -->
- `specship postcheck` fails when a knowledge check fails.

<!-- id: REQ-KNOW-004 -->
## The implement workflow MUST propose knowledge, and only a human MUST apply it

The bundled implement workflows MUST draft knowledge proposals after the
adversarial review — terms, rules, decisions and external facts the change
relied on — as files under `.specship/knowledge/proposals/`, and the final
review MUST list them. Nothing is written to `specs/domain/` by the workflow.
A `specship knowledge proposals` command MUST list pending proposals, and
`specship knowledge apply <id>` MUST move a confirmed proposal into
`specs/domain/` with the next free id; `reject <id>` deletes it.

implementations:
  - src/knowledge/proposals.ts:listProposals
  - src/knowledge/proposals.ts:applyProposal
  - src/knowledge/proposals.ts:rejectProposal
  - src/workflows/defaults/spec-implement.yaml
  - src/workflows/defaults/spec-implement-mixed.yaml

verifies:
  - __tests__/knowledge-proposals.test.ts:applyMovesProposalWithNextFreeId
  - __tests__/knowledge-proposals.test.ts:rejectDeletesProposal
  - __tests__/knowledge-proposals.test.ts:invalidProposalIsNotApplied
  - __tests__/workflow-discovery.test.ts:workflowProposesKnowledgeButNeverWritesDomain

## Acceptance
<!-- id: REQ-KNOW-004.A1 -->
- Both implement workflows have a knowledge-proposal step after the adversarial review whose allowed writes are limited to `.specship/knowledge/proposals/`, and the final review message includes its output.
<!-- id: REQ-KNOW-004.A2 -->
- `specship knowledge apply <id>` writes the fact to `specs/domain/` with the next free `DOM-<AREA>-NNN` id and removes the proposal.
<!-- id: REQ-KNOW-004.A3 -->
- A proposal that would fail lint (e.g. an external fact without provenance) is refused by `apply` with the lint finding, and left in place.
<!-- id: REQ-KNOW-004.A4 -->
- `specship knowledge reject <id>` deletes the proposal and writes nothing to `specs/domain/`.

<!-- id: REQ-KNOW-005 -->
## Knowledge MUST reach the agent with the spec, including provenance and rules

When a requirement is fetched for planning or implementation, its linked
domain facts MUST arrive inline (as today) and an external fact MUST show its
dependency, verified version, staleness and any enforced rules, so the agent
does not rediscover them. The implement workflows' plan and implement prompts
MUST tell the agent to respect enforced rules.

implementations:
  - src/mcp/spec-tools.ts:renderDomainFactsInline
  - src/workflows/defaults/spec-implement.yaml

verifies:
  - __tests__/knowledge.test.ts:inlineFactShowsProvenanceAndRules
  - __tests__/workflow-discovery.test.ts:promptsRespectEnforcedRules

## Acceptance
<!-- id: REQ-KNOW-005.A1 -->
- The inline rendering of an external fact linked to a requirement includes its dependency, verified version, a stale marker when stale, and its enforced rules.
<!-- id: REQ-KNOW-005.A2 -->
- The plan and implement prompts of both implement workflows instruct the agent to treat enforced rules as constraints.

<!-- id: REQ-KNOW-006 -->
## External facts SHOULD be backed by pinned fixture tests

An external fact MAY name `fixture` tests (`path:Symbol`) that assert
SpecShip's behaviour against the recorded external shape. `specship knowledge
stale` MUST list a stale fact's fixtures as the tests to re-check. This
repository MUST record its Gemini CLI 0.28.0 integration facts this way.

implementations:
  - src/knowledge/stale.ts:findStaleExternalFacts

verifies:
  - __tests__/knowledge.test.ts:staleFactListsItsFixtures
  - __tests__/contracts/gemini-cli.contract.test.ts:geminiPolicyUsesRuleTables
  - __tests__/contracts/gemini-cli.contract.test.ts:geminiDenyDecisionIsTopLevel
  - __tests__/contracts/gemini-cli.contract.test.ts:geminiTranscriptIsSingleJson

## Acceptance
<!-- id: REQ-KNOW-006.A1 -->
- A stale fact's report line lists the fixture tests it names.
<!-- id: REQ-KNOW-006.A2 -->
- This repository carries external facts for Gemini CLI 0.28.0 (policy `[[rule]]` tables, top-level BeforeTool deny decision, single-JSON transcripts with bare MCP tool names), each naming a passing fixture test.

<!-- id: REQ-KNOW-007 -->
## The dashboard SHOULD offer a knowledge view

The dashboard SHOULD list domain facts with their type, linked requirements,
and — for external facts — dependency, verified version and staleness, from a
read-only API endpoint. [needs review: page placement and visual design]

implementations:
  - server/src/routes/knowledge.ts:registerKnowledgeRoutes

verifies:
  - __tests__/knowledge-endpoint.test.ts:knowledgeEndpointListsFactsWithFreshness

## Acceptance
<!-- id: REQ-KNOW-007.A1 -->
- A read-only knowledge endpoint returns every domain fact with id, title, type, linked requirement ids, and for external facts dependency, version and stale state.
