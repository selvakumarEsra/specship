---
id: STEER-HOOK-DOC
title: Retrieval steering hook at install
owner: installer
priority: high
---

<!-- id: STEER-HOOK-DOC -->
# Retrieval steering hook at install

Dynamic-dispatch coverage is repeatedly validated by probes but goes unused
because the agent never picks the tool ("agent A/B null — adoption-gated",
the recurring wall in the coverage matrix). The only channel that measurably
fixed adoption was high-salience per-run steering (`--append-system-prompt`:
excalidraw call count 3–10 → 3–4, trace adoption 4/4, best run 0-Read/51s);
low-salience channels (MCP initialize instructions, tool descriptions) failed
across 3 variants. Decision (2026-07-11 product review, Q4): ship that
high-salience channel as an installer-written `UserPromptSubmit` hook — the
same mechanism SDD steering already uses (SDD-INSTALL-DOC) — default-on,
opt-outable, and gated on an A/B reproducing the measured win.

<!-- id: REQ-STEER-001 -->
## `specship install` MUST provision a retrieval-steering prompt hook

The installer writes a `UserPromptSubmit` hook (idempotent merge into Claude
`settings.json`, same machinery as the auto-sync and SDD hooks) whose command
emits one short steering line: before reading or editing ANY code for a task
(understanding, implementing, fixing, refactoring), call `specship_explore`
with the relevant symbol/file names first; Read/Grep only what it did not
return. (Broadened 2026-07-13 from flow-questions-only: adoption telemetry —
231 prompts/7d, 29% with specship, 41% with Read — showed the Read-heaviest
prompts are plan-execution and feature/fix prompts, which the narrow wording
excluded.) Unlike the opt-in SDD governance tier, this hook is part of the
default retrieval tier. `specship uninstall` removes it.

implementations:
  - src/installer/targets/claude.ts:writeSteerHookEntry
  - src/installer/targets/claude.ts:cleanupSteerHooks

## Acceptance
<!-- id: REQ-STEER-001.A1 -->
- A default `specship install` adds the steering hook to `settings.json`;
  re-running install is byte-idempotent (`unchanged`).
<!-- id: REQ-STEER-001.A2 -->
- `specship uninstall` removes the hook without disturbing sibling hooks.

<!-- id: REQ-STEER-002 -->
## The hook MUST be silent when it cannot help

The hook command emits nothing when the working project has no `.specship/`
index, and emits nothing when `SPECSHIP_NO_STEERING=1` is set. Uninitialized
projects and opted-out users get zero prompt noise and zero added latency
beyond the hook invocation itself.

implementations:
  - src/activation/steering.ts:buildSteeringNudge

## Acceptance
<!-- id: REQ-STEER-002.A1 -->
- In a directory without `.specship/`, the hook command exits 0 with empty
  output.
<!-- id: REQ-STEER-002.A2 -->
- With `SPECSHIP_NO_STEERING=1`, the hook command exits 0 with empty output
  even in an initialized project.

<!-- id: REQ-STEER-003 -->
## Shipping default-on MUST be gated on a reproduced A/B win

Before the hook ships enabled by default, an agent A/B (≥2 runs/arm, the
standard methodology) MUST show the hook arm matching or beating baseline on
flow questions (tool calls, Reads, duration) with no regression on non-flow
control prompts. Results are recorded in `docs/benchmarks/` (and feed the
BENCH-CLAIM-DOC manifest). If non-flow prompts regress, the hook ships
opt-in instead.

**GATE SATISFIED (2026-07-12):** `docs/benchmarks/steering-hook-ab.md` —
hook arm 1 explore/3 turns in 2/2 flow runs (vs 4–5 turns baseline), control
question unaffected.

implementations:
  - docs/benchmarks/steering-hook-ab.md

## Acceptance
<!-- id: REQ-STEER-003.A1 -->
- A recorded A/B in docs/benchmarks/ shows flow-question improvement and
  non-flow non-regression for the shipped wording.

<!-- id: REQ-STEER-004 -->
## `specship install` MUST provision a point-of-use hook on search tools

Prompt-level steering (REQ-STEER-001) fires once, at prompt submit, and its
pull decays across a long turn — the agent re-decides at every tool call, and
the observed failure is a search-shaped call made many tool-calls after the
nudge. This requirement delivers the same guidance at the moment of the wrong
choice: a `PreToolUse` hook matching search-shaped tools whose command emits
one short line redirecting to `specship_explore`.

The hook is **advisory**: it MUST NOT deny, block, or otherwise prevent the
matched call. A search the index cannot answer is a legitimate search, and a
wrong denial costs the agent a turn — the failure mode this feature exists to
reduce. It is written by the same idempotent merge as the auto-sync, SDD, and
prompt-steer hooks, is part of the default retrieval tier (not gated on
`--sdd` or autoAllow), and is removed by `specship uninstall`.

implementations:
  - src/installer/targets/claude.ts:writeSearchInterceptHookEntry
  - src/installer/targets/claude.ts:cleanupSearchInterceptHooks

## Acceptance
<!-- id: REQ-STEER-004.A1 -->
- A default `specship install` adds a `PreToolUse` hook matching search-shaped
  tools to `settings.json`; re-running install is byte-idempotent
  (`unchanged`).
<!-- id: REQ-STEER-004.A2 -->
- The hook command exits 0 on every invocation and never emits a deny or block
  decision; the matched call proceeds in all cases, including when the command
  itself errors internally.
<!-- id: REQ-STEER-004.A3 -->
- The command emits empty output in a directory without `.specship/`, and with
  `SPECSHIP_NO_STEERING=1` set in an initialized project — the same two silence
  gates as REQ-STEER-002.
<!-- id: REQ-STEER-004.A4 -->
- `specship uninstall` removes the hook without disturbing sibling `PreToolUse`
  matcher groups or the `UserPromptSubmit` hooks from REQ-STEER-001 and
  SDD-INSTALL-DOC.
<!-- id: REQ-STEER-004.A5 -->
- The command adds no more than 150 ms at p95 to a matched call, measured
  warm. (Ratified 2026-08-23: the decision logic is sub-millisecond; the
  floor is Node CLI startup, measured ~95 ms warm — a 50 ms budget is not
  reachable without a shell fast-path, which is not warranted for a hook
  that fires usefully once per session.)

<!-- id: REQ-STEER-005 -->
## The interceptor MUST self-silence once a session has used the index

Firing on every search-shaped call would make the hook noise, and noise is
what taught the agent to ignore the prompt-level nudge. The hook emits at most
one line per session, and only when the invoking session has made zero
specship tool calls. An agent that has already queried the index does not need
redirecting; the first specship call in a session silences the hook for the
remainder of that session.

implementations:
  - src/activation/search-intercept.ts:buildSearchIntercept

## Acceptance
<!-- id: REQ-STEER-005.A1 -->
- In a session that has made at least one specship tool call, a matched
  search-shaped call produces empty output.
<!-- id: REQ-STEER-005.A2 -->
- In a session with zero specship tool calls, the first matched call produces
  the redirect line and every subsequent matched call in that session produces
  empty output.
<!-- id: REQ-STEER-005.A3 -->
- Two sessions active in the same project are tracked independently: one
  session firing or being silenced does not change the other's behaviour.
<!-- id: REQ-STEER-005.A4 -->
- Per-session tracking state does not grow without bound — records for
  sessions older than 7 days are pruned on write.

<!-- id: REQ-STEER-006 -->
## Shipping the interceptor default-on MUST be gated on a reproduced A/B win

Same bar as REQ-STEER-003, and for the same reason (BENCH-CLAIM-DOC: promise
only what you can prove). Before the interceptor ships enabled by default, an
agent A/B (≥2 runs/arm, the standard methodology) MUST show the interceptor
arm reducing Read/Grep count on flow questions with no regression in total
turns or duration on non-flow control prompts. If the added per-call latency
or the redirect line costs more than it saves, the hook ships opt-in instead.

**GATE RESULT (2026-08-23):** `docs/benchmarks/search-intercept-ab.md` —
null-with-non-regression. Both arms hit 0 Read/Grep on flow questions
(opus + haiku, 2 runs/arm): with specship installed, server-instructions
steering already holds the headless baseline at the floor, so the reduction
clause is unmeasurable in this harness; the decay scenario the interceptor
targets (long interactive sessions) does not reproduce headlessly. The cost
clauses passed: firing verified on a legitimate-search control (advisory
honored, search proceeded, same turns/duration), latency ~95 ms warm within
the 150 ms budget. The A/B also caught and fixed a self-silencing false
positive (tool LISTING mistaken for tool use). **RATIFIED default-on
(user decision, 2026-08-23):** the reduction clause is waived as
unmeasurable-by-construction in the headless harness (baseline already at
the floor); the gate is judged on the cost clauses, which passed. The
target scenario (steering decay in long interactive sessions, observed
2026-08-16) is real, the measured cost is nil, and the hook self-silences.

implementations:
  - docs/benchmarks/search-intercept-ab.md
  - scripts/agent-eval/run-intercept-ab.sh

## Acceptance
<!-- id: REQ-STEER-006.A1 -->
- A recorded A/B in `docs/benchmarks/` shows reduced Read/Grep count on flow
  questions and non-regression on control prompts for the shipped wording and
  matcher.
