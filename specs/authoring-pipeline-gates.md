---
id: AUTHG-DOC
title: Review remediation Wave 3 — authoring quality & pipeline gates
owner: specship-core
priority: medium
version: 1
---

<!-- id: AUTHG-DOC -->
# Review remediation Wave 3 — authoring quality & pipeline gates

Deterministic spec linting, shipping the authoring apparatus to all users, and
quality gates in the implement pipeline so produced code is reviewed against
the diff and the project's own analyses.

Non-goals: changing the spec format itself (Wave 2 owns bullet link blocks),
dashboard surfaces (Wave 4).

<!-- id: REQ-AUTHG-001 -->
## `specship lint` MUST exist as a deterministic spec-quality command

Every structural check in the review checklist is currently performed by an
LLM eyeballing the draft. A lint command over `specs/` MUST reuse the
extractor's errors and add mechanical checks.

implementations:
  - src/spec-lint/lint.ts:lintSpecs
  - src/spec-lint/lint.ts:lintSpecSource
  - src/spec-lint/lint.ts:formatLintReport

## Acceptance
<!-- id: REQ-AUTHG-001.A1 -->
- `specship lint [path]` reports: extractor errors, duplicate IDs within a file, bare-path link bullets, `.A<N>` IDs whose parent requirement does not exist, requirements with zero acceptance criteria, and `[needs review]` markers inside acceptance bullets.
<!-- id: REQ-AUTHG-001.A2 -->
- Warnings (non-blocking): requirements with no negative-case acceptance criterion (heuristic keyword scan), missing `## Non-goals`/test-plan signals, requirements with no RFC 2119 keyword in title or body.
<!-- id: REQ-AUTHG-001.A3 -->
- Exit code is non-zero when any error-severity finding exists; zero for warnings only.
<!-- id: REQ-AUTHG-001.A4 -->
- Running lint on the repo's own `specs/` after Wave 1/2 fixes completes without crashing and reports findings in a stable, file-grouped format (machine-readable with `--json`).

<!-- id: REQ-AUTHG-002 -->
## The real spec corpus MUST be linted in CI

The CI job shells out to the built CLI, so the load-bearing code is the lint
command entry point it invokes.

implementations:
  - src/spec-lint/lint.ts:runLintCli

## Acceptance
<!-- id: REQ-AUTHG-002.A1 -->
- The test workflow runs `specship lint specs/` (via the built CLI); error-severity findings fail the build.
<!-- id: REQ-AUTHG-002.A2 -->
- Warning counts are printed in the CI log (visible ratchet baseline).

<!-- id: REQ-AUTHG-003 -->
## The Post-write review and fast path MUST gain mechanical floors

verifies:
  - __tests__/command-doc-truth.test.ts:postWriteChecklistCoversTestEvidence

## Acceptance
<!-- id: REQ-AUTHG-003.A1 -->
- The Post-write review in `commands/specship/spec.md` runs `specship lint` on the written file and treats error-severity findings as structural (auto-fix or block), replacing the mental-scan structural section.
<!-- id: REQ-AUTHG-003.A2 -->
- The fast path asks a minimum of two questions before drafting: the primary failure mode and the primary non-goal.
<!-- id: REQ-AUTHG-003.A3 -->
- The review checklist's duplicate-ID consequence is corrected to "last occurrence overwrites earlier ones".

<!-- id: REQ-AUTHG-004 -->
## The final human gate MUST see the real diff, not the agent's summary

verifies:
  - __tests__/workflow-discovery.test.ts:diffArtifactComesFromGit
  - __tests__/workflow-discovery.test.ts:finalGateShowsTheGitStat

## Acceptance
<!-- id: REQ-AUTHG-004.A1 -->
- The spec-implement workflow computes `git diff --stat` and the full diff into a run artifact after the implement node.
<!-- id: REQ-AUTHG-004.A2 -->
- The `final_review` gate message includes the diff stat block (files + insertions/deletions), sourced from git, not from the implement node's prose.

<!-- id: REQ-AUTHG-005 -->
## A quality gate MUST run between implement and final review

verifies:
  - __tests__/workflow-discovery.test.ts:qualityGateRunsBeforeVerify
  - __tests__/workflow-discovery.test.ts:qualityFailureFeedsTheReviseLoop
  - __tests__/workflow-discovery.test.ts:adversarialReviewIsReadOnlyAndScoresEveryCriterion

## Acceptance
<!-- id: REQ-AUTHG-005.A1 -->
- A workflow node runs the project's typecheck/lint when present (`npm run lint --if-present`, `tsc --noEmit` for TS projects) inside the worktree; failures feed the revise loop rather than silently passing.
<!-- id: REQ-AUTHG-005.A2 -->
- This repository gains a `lint` script (so its own workflow runs get the gate) and the CI test workflow runs it.
<!-- id: REQ-AUTHG-005.A3 -->
- An adversarial read-only review node reports, per acceptance criterion of the spec under implementation: satisfied / partial / unaddressed, plus any untested new code paths — included in the `final_review` message.

<!-- id: REQ-AUTHG-006 -->
## The behaviour gate MUST support change-scoped evaluation

Gating every requirement in the repo (60+ docs) makes the gate unusable as a
pre-commit check; the only escape today is per-ID excludes.

implementations:
  - src/enforce/changed-files.ts:changedFilesSince
  - src/enforce/changed-files.ts:InvalidRefError
  - src/enforce/enforce.ts:evaluateEnforcement

## Acceptance
<!-- id: REQ-AUTHG-006.A1 -->
- `specship check --since <ref>` evaluates only requirements whose links (or spec files) touch files changed since `<ref>`.
<!-- id: REQ-AUTHG-006.A2 -->
- With `--since`, untouched requirements produce no findings; without it, behavior is unchanged.
<!-- id: REQ-AUTHG-006.A3 -->
- An invalid ref exits non-zero with a clear message (no silent full-repo fallback).

<!-- id: REQ-AUTHG-007 -->
## The spec-author skill SHOULD ship with the installer

The gap catalog, quality rubric, and review checklist currently exist only on
one machine; every other user gets the inline fallback.

implementations:
  - src/installer/targets/claude.ts:writeSkillsEntries
  - src/installer/targets/claude.ts:removeSkillsEntries
  - src/installer/targets/claude.ts:SHIPPED_SKILLS

## Acceptance
<!-- id: REQ-AUTHG-007.A1 -->
- `specship install` (claude target) installs the spec-author skill (SKILL.md + references) under the project's `.claude/skills/spec-author/`, marker-managed like other assets.
<!-- id: REQ-AUTHG-007.A2 -->
- The shipped gap catalog includes a SpecShip-invariants section keyed by surface (MCP change → budget monotonicity + server-instructions.ts; installer change → targets/markers/CHANGELOG; retrieval change → call-count/latency budget; extraction change → NodeKind/EdgeKind + copy-assets).
<!-- id: REQ-AUTHG-007.A3 -->
- Uninstall removes the skill; an installer test covers install + uninstall round-trip.
