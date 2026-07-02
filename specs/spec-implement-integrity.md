---
id: IMPLINT-DOC
title: Verified integrity in the spec-implement workflow
owner: core
priority: high
version: 1
---

<!-- id: IMPLINT-DOC -->
# Verified integrity in the spec-implement workflow

The bundled `spec-implement` workflow's `verify` node runs the project's test
suite, but its no-recognised-framework fallback exits zero, and the `link`
prompt is left to judge whether "skipping" counts as passing. A project with no
test runner can therefore end up with specs marked `verified` having run zero
tests — poisoning the spec→test→verify chain the gate door (`specship check`)
gates on. Separately, a green suite that simply does not exercise the spec's
acceptance criteria flows to `verified` with the coverage hole invisible at the
final human gate.

This document makes `verified` unfakeable and makes acceptance-criteria test
coverage visible at the workflow's final approval. Behaviour-test authoring is
deliberately NOT auto-chained into the run — it stays a visible suggestion,
keeping the workflow light for the solo dev.

<!-- id: REQ-IMPLINT-001 -->
## The implement workflow MUST NOT mark a spec verified when tests did not run

The `verify` node distinguishes ran-and-passed from skipped in a
machine-readable way, and the `link` step treats them differently: a skipped
verify may assert links but never verifies them.

## Acceptance
<!-- id: REQ-IMPLINT-001.A1 -->
- The `verify` node's output distinguishes ran-and-passed, ran-and-failed, and
  skipped (no recognised test framework) via a machine-readable marker, not
  free prose the link step must interpret.
<!-- id: REQ-IMPLINT-001.A2 -->
- When verify was skipped, the `link` step calls `specship_link_assert` only;
  the link state stays `implemented`, and `specship_link_verify` with
  `result: "pass"` is never called.
<!-- id: REQ-IMPLINT-001.A3 -->
- Ran-and-failed still halts the workflow before the link step, as the
  non-zero exit gating already provides.

<!-- id: REQ-IMPLINT-002 -->
## The final approval gate MUST report acceptance-criteria test coverage

The `final_review` message tells the approving human how many of the spec's
acceptance criteria carry `tests`-kind links, so a coverage hole is approved
with eyes open rather than silently.

## Acceptance
<!-- id: REQ-IMPLINT-002.A1 -->
- The `final_review` message reports "N of M acceptance criteria for the spec
  have linked tests", derived from the spec's `.A<N>` children and their
  `tests`-kind links.
<!-- id: REQ-IMPLINT-002.A2 -->
- When N < M, the message names `/specship:spec behaviour <SPEC_ID>` as the
  follow-up that closes the gap.
<!-- id: REQ-IMPLINT-002.A3 -->
- Behaviour-test authoring is not auto-chained into the implement run — the
  coverage report is a visible suggestion, not a blocking step.
