---
id: BENCH-CLAIM-DOC
title: Benchmark claim governance
owner: specship
priority: high
---

<!-- id: BENCH-CLAIM-DOC -->
# Benchmark claim governance

Published performance claims drifted from measurement: the README headline
said "~16% cheaper" while the current-build A/B (median of 4 over the 7
README repos) measured 35% cost savings. Decision (2026-07-11 product
review, Q3): the headline leads with the mechanism, and every numeric claim
is generated from a measured, dated artifact — claims can no longer drift
silently, matching the product's own drift-detection thesis.

<!-- id: REQ-BENCH-001 -->
## The README headline MUST be mechanism-led, not percentage-led

The top-of-README pitch describes what SpecShip does — stops the agent
re-reading; flow answers in 1–5 specship calls with ~0 Read/Grep — and
contains no percentage or dollar figures. Precise numbers live only in a
benchmarks section.

## Acceptance
<!-- id: REQ-BENCH-001.A1 -->
- The README above-the-fold block contains no `%` performance claims.
<!-- id: REQ-BENCH-001.A2 -->
- The headline names the mechanism (fewer re-reads / structural answers in
  few calls), consistent with the positioning wedge.

<!-- id: REQ-BENCH-002 -->
## Numeric performance claims MUST be generated from a results manifest

The A/B harness writes its aggregate to a committed manifest
(`docs/benchmarks/results.json`): per-repo medians plus average savings,
stamped with run date, Claude Code version, and model. The README benchmarks
section is rendered from (or checked against) that manifest — numbers are
never hand-typed. Each published table carries its date + version stamp so a
stale claim is visibly stale rather than silently wrong.

implementations:
  - scripts/agent-eval/parse-bench-readme.mjs:parse
  - scripts/agent-eval/bench-manifest.mjs:renderBenchSection

## Acceptance
<!-- id: REQ-BENCH-002.A1 -->
- Running the README A/B aggregation emits/updates `results.json` including
  run date, Claude Code version, and model id.
<!-- id: REQ-BENCH-002.A2 -->
- Every numeric claim in the README benchmarks section matches the manifest;
  a mismatch is detectable by an automated check (test or CI step).
<!-- id: REQ-BENCH-002.A3 -->
- The rendered benchmarks section displays the manifest's date and version
  stamps.

<!-- id: REQ-BENCH-003 -->
## Stale claims MUST fail loudly, not linger

A repo test (or CI step) compares the README's benchmark numbers against the
manifest and fails on divergence. [needs review: refresh cadence — re-run
the A/B per release or quarterly; the check only enforces consistency, not
freshness.]

## Acceptance
<!-- id: REQ-BENCH-003.A1 -->
- Editing a README benchmark number without regenerating the manifest fails
  the check.
