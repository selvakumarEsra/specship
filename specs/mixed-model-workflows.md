---
id: MIXMODEL-DOC
title: Mixed-model workflows — frontier judgment, small-model execution
owner: specship
priority: medium
---

<!-- id: MIXMODEL-DOC -->
# Mixed-model workflows — frontier judgment, small-model execution

Small models are cheap pattern-completers and poor planners/self-verifiers.
The workflow engine already has the right shape to exploit that: per-node
`model`, deterministic verification (tests + the evidence gate), and human
approval gates. This packages it: **judgment nodes run on a capable model,
execution nodes run on Haiku, and the machinery — not the model — verifies
every step.** Haiku's error rate is acceptable when externally checked; it is
fatal when it grades its own work.

<!-- id: REQ-MIX-001 -->
## A bundled `spec-implement-mixed` workflow MUST split judgment from execution

Ships alongside `spec-implement` with identical steps, gates, and verify
mechanics — only per-node models differ: `plan` (the judgment-heavy step)
pins to a capable model (`sonnet`); `fetch_spec`, `implement`, `link`, and
`coverage` (mechanical steps: summarize, type the planned code, assert
links, count) pin to `haiku`. The bash `verify` step and both approval
gates are model-free and unchanged — correctness comes from tests and the
reviewer, not from the executor's self-assessment. Model aliases (not
dated ids) keep the file evergreen.

implementations:
  - src/workflows/defaults/spec-implement-mixed.yaml

## Acceptance
<!-- id: REQ-MIX-001.A1 -->
- `specship workflow list` shows `spec-implement-mixed` as a bundled
  workflow; its definition validates against the schema.
<!-- id: REQ-MIX-001.A2 -->
- The `plan` node carries `model: sonnet`; the `fetch_spec`, `implement`,
  `link`, and `coverage` nodes carry `model: haiku`; the `verify` bash node
  and both approval gates are identical to `spec-implement`'s.
<!-- id: REQ-MIX-001.A3 -->
- A project-tier `spec-implement-mixed.yaml` overrides the bundled one, like
  every other bundled workflow.

<!-- id: REQ-MIX-002 -->
## The tips engine MUST detect small-model flounder and recommend escalation

A session on a haiku/sonnet model with the flounder signature (many file
Reads in one session — the re-read spiral) gets a tip: this task shape wants
a bigger model, or the same work packaged as `spec-implement-mixed` (fresh
context per step + external verification). SpecShip becomes the router that
knows WHEN the small model is out of its depth. [needs review: threshold —
initial value ≥15 Reads/session, tune from telemetry.]

implementations:
  - server/src/routes/claude.ts:registerClaudeRoutes

## Acceptance
<!-- id: REQ-MIX-002.A1 -->
- A haiku session with ≥15 Read calls in this project produces an
  escalation tip naming the model and the mixed workflow; a frontier-model
  session with the same Reads does not.
