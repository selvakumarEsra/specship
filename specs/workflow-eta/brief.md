---
slug: workflow-eta
created: 2026-07-04
label: workflows, dashboard
---
# Workflow runs should show an estimated time to completion

When a workflow run (spec-implement, spec-author, …) is in flight, the user
has no signal for how long it will take, so they hover instead of switching
to other work. Each run should surface an estimate — as a p50–p90 **range**,
not a point — so the user can decide to walk away and come back.

Proposed direction:
- Estimate from history: per-workflow, per-STEP duration distributions over
  past runs (the runs table already records transitions). ETA = sum of the
  remaining steps' medians, re-estimated as each step completes; show
  p50–p90, not a single number.
- Split machine time from human time: gate-wait (paused at an approval) is
  unbounded human latency and must be EXCLUDED from the estimate — shown
  instead as "waiting on you since HH:MM". Otherwise one overnight pause
  poisons every future estimate.
- Cold start: with fewer than ~3 prior runs of a workflow, show "no estimate
  yet" (or a very wide range) rather than a fabricated number.
- Complexity signal (later): condition on cheap features — number of
  acceptance criteria on the spec, repo size, baseline test-suite duration.
- Surfaces: Runs page + run detail; optionally the runDone/approval desktop
  notifications ("≈12–25 min remaining").

## Grounding
- packages/server/src/routes/events.ts (run-status poller — already diffs
  run transitions; timestamps for per-step history live alongside)
- src/workflows (executor's node/step state transitions)
- packages/web-ng runs pages (display surface)

## Open question (feasibility, discussed 2026-07-04)
Absolute accuracy is not achievable — agentic step durations vary with model
latency, retries, spec complexity, and test-suite time. "Closer" is: p50–p90
range from per-step history, live re-estimation at each step boundary,
human-wait excluded. Expect ±30–50% at p50 after 5–10 runs; ranges + the
existing done/approval notifications cover the real need (safe to focus
elsewhere) even when the point estimate is off.
