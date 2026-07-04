---
id: WORKFLOW-ETA-DOC
title: Workflow run time-to-completion estimates
owner: workflows
priority: medium
---

<!-- id: WORKFLOW-ETA-DOC -->
# Workflow run time-to-completion estimates

An in-flight workflow run gives the user no signal for how long it will take,
so they hover instead of switching to other work. Each run surfaces an
estimated time to completion — honest about uncertainty (a range, never a
point), built only from that workflow's own history, and never counting time
spent waiting on a human as machine work remaining. Promoted from the
ideas-lane brief `specs/workflow-eta/brief.md`.

<!-- id: REQ-ETA-001 -->
## A running run MUST surface its remaining time as a range, never a point

While a run is `running`, its API payload and the runs surfaces carry an
estimated remaining time expressed as an optimistic–pessimistic range
(median-to-90th-percentile of the historical evidence). A single point number
MUST NOT be shown. The estimate MUST be recomputed as the run progresses so
it tightens rather than staying fixed at its launch value.

## Acceptance
<!-- id: REQ-ETA-001.A1 -->
- A running run with sufficient history carries an estimate with two values, low ≤ high, both positive durations.
<!-- id: REQ-ETA-001.A2 -->
- After a step completes, a re-query reflects the remaining steps only — the estimate for a run on its last step is strictly below the same workflow's full-run estimate.

implementations:
  - src/workflows/eta.ts:estimateRunEta
  - packages/server/src/routes/workflow.ts:registerWorkflowRoutes

<!-- id: REQ-ETA-002 -->
## The estimate MUST be derived from the same workflow's per-step history

Remaining time is the sum over the run's not-yet-completed steps of that
step's historical duration distribution, computed from prior runs of the SAME
workflow (step start/completion timestamps already recorded per run). History
from other workflows MUST NOT contribute. A step with no history of its own
falls back to the workflow's overall per-step distribution, never to another
workflow's.

## Acceptance
<!-- id: REQ-ETA-002.A1 -->
- With history seeded for workflow A only, a run of workflow B reports no estimate (cold start), regardless of A's volume.
<!-- id: REQ-ETA-002.A2 -->
- The estimate equals the sum over remaining steps of their per-step historical quantiles (verifiable with hand-seeded durations).

implementations:
  - src/workflows/eta.ts:estimateRunEta

<!-- id: REQ-ETA-003 -->
## Human gate-wait MUST be excluded from the estimate and shown separately

Time a run spends paused at an approval gate is unbounded human latency: it
MUST NOT count toward any step's historical duration, and a currently-paused
run MUST NOT show a machine estimate — it shows a "waiting on you since
<time>" signal instead. One overnight pause must not poison future estimates.

## Acceptance
<!-- id: REQ-ETA-003.A1 -->
- A historical run containing a long approval wait contributes only its active step durations — the recorded history for the gated step excludes the request→grant span.
<!-- id: REQ-ETA-003.A2 -->
- A run in `paused` status carries no numeric remaining-time estimate; its payload carries the timestamp it began waiting.

implementations:
  - src/workflows/eta.ts:estimateRunEta

<!-- id: REQ-ETA-004 -->
## Cold start MUST yield no estimate rather than a fabricated one

With fewer than 3 completed prior runs of a workflow, no numeric estimate is
produced — the payload says the estimate is unavailable and why (insufficient
history). A fabricated or default number MUST NOT be shown.

## Acceptance
<!-- id: REQ-ETA-004.A1 -->
- With 0, 1, or 2 completed prior runs, the payload marks the estimate unavailable with an insufficient-history reason; with 3, an estimate appears.

implementations:
  - src/workflows/eta.ts:estimateRunEta

<!-- id: REQ-ETA-005 -->
## The estimate MUST be visible on the runs surfaces

The runs list and the run detail page render the range for running runs
(e.g. "≈4–11 min left") and the waiting-on-you signal for paused runs. Runs
without an estimate (cold start, completed, failed) show no estimate text —
absence, not a placeholder number.

## Acceptance
<!-- id: REQ-ETA-005.A1 -->
- A running run with history shows a human-readable range on the runs list and its detail page.
<!-- id: REQ-ETA-005.A2 -->
- A paused run shows the waiting-on-you signal in place of a range.

implementations:
  - packages/server/src/ssr/bindings.mjs:bindRuns
  - packages/server/src/ssr/render.mjs:renderRunDetail
