# Search-interceptor A/B — REQ-STEER-006.A1 gate record

**Measured 2026-08-23 · `EVAL_MODEL=opus` and `haiku` · specship main (post REQ-STEER-004/005 implementation) · express (shallow clone, indexed with local dist) · harness `run-intercept-ab.sh`: both arms WITH the specship MCP, NO prompt-steer hook in either arm; the only variable is the `PreToolUse` `Grep|Glob` hook (`specship search-intercept`) injected via `--settings`.**

## Flow question (repo-anchored request→handler→response trace) — 2 runs/arm × 2 models

| Arm | Read/Grep | specship calls | turns | duration | cost |
|---|---|---|---|---|---|
| opus, no hook, r1 | 0 | 1 explore | 3 | 23s | $0.56 |
| opus, no hook, r2 | 0 | 2 explore | 4 | 29s | $0.36 |
| opus, hook, r1 | 0 | 2 explore | 4 | 30s | $0.36 |
| opus, hook, r2 | 0 | 2 explore | 4 | 32s | $0.36 |
| haiku, no hook, r1 | 0 | 3 explore + 1 node | 5 | 33s | $0.10 |
| haiku, no hook, r2 | 0 | 3 explore + 2 other | 6 | 37s | $0.06 |
| haiku, hook, r1 | 0 | 3 explore + 5 other | 9 | 40s | $0.09 |
| haiku, hook, r2 | 0 | 2 explore + 1 node | 4 | 32s | $0.05 |

**All 8 runs, both arms: zero Read/Grep.** With the specship MCP present, the
server-instructions steering already routes single-prompt headless sessions
straight to `specship_explore`, so the interceptor's matcher never fires on a
flow question — a *reduction* in Read/Grep cannot manifest against a baseline
already at the floor. Turns/duration/cost differences are within the
harness's known run-to-run variance. The decay scenario the interceptor
exists for — a search-shaped call made many tool-calls after the nudge, deep
in a long interactive session — is structurally out of reach of single-prompt
headless runs.

## Legitimate-search control ("find every file containing the literal string 'trust proxy'") — opus, 2 runs/arm

| Arm | tools | turns | duration | interceptor |
|---|---|---|---|---|
| no hook, r1 | 1 Grep | 2 | 6s | — |
| no hook, r2 | 1 Grep | 2 | 6s | — |
| hook, r1 | 1 Grep | 2 | 8s | **fired** (verified: `hook_additional_context` in transcript) |
| hook, r2 | 1 Grep | 2 | 7s | **fired** |

The interceptor fired exactly once per session, the matched Grep proceeded
(advisory honored — no deny, no retry), the agent completed the search in the
same 2 turns, and the redirect line did not push it into a wasteful graph
call. Per-call latency: the hook command measures ~95 ms warm (Node CLI
startup–dominated), within the ratified 150 ms budget (REQ-STEER-004.A5).

## Bug found and fixed by this A/B

The first control run exposed a self-silencing false positive: the
transcript scan treated any `mcp__specship__` *mention* as tool use, but
transcripts carry the full tool listing (`deferred_tools_delta`) in every
session where specship is installed — so the interceptor silenced itself in
100% of sessions. Fixed to require an actual `tool_use` record
(`src/activation/search-intercept.ts:transcriptUsedSpecship`); the rerun
above is with the fix.

## Verdict

**No measurable win, no measurable cost.** The reduction clause of
REQ-STEER-006 is unmeasurable in this harness (baseline Read/Grep is already
0 when specship is installed and steered); the cost clauses are satisfied
(no turn/duration regression on flow or control, firing verified, advisory
honored, latency within budget). Whether that clears the interceptor for a
default-on release or argues for opt-in is a product call recorded in the
spec (REQ-STEER-006), not something this data can decide alone.

**Resolution (2026-08-23): user ratified default-on.** The reduction clause
was waived as unmeasurable-by-construction in this harness; the decision
rests on the passed cost clauses plus the real observed decay scenario the
hook targets. Recorded in REQ-STEER-006.
