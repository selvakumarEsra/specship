# Steering-hook A/B — REQ-STEER-003.A1 release gate

**Measured 2026-07-12 · Claude Code 2.1.201 · `EVAL_MODEL=opus` · specship 0.16.0+main · express (147 files) · harness `run-all.sh`, both arms WITH the specship MCP; the only variable is the project-level `UserPromptSubmit` steering hook (`specship steer-nudge`).**

## Flow question (repo-anchored request→handler trace) — 2 runs/arm

| Arm | specship calls | turns | duration | cost |
|---|---|---|---|---|
| no hook, r1 | 2 explore | 4 | 44s | $0.74 |
| no hook, r2 | 1 explore + 2 Bash | 5 | 49s | $0.42 |
| **hook, r1** | **1 explore** | **3** | **27s** | **$0.35** |
| **hook, r2** | **1 explore** | **3** | **35s** | **$0.37** |

The hook arm converged on the canonical pattern (one explore, answer) in
2/2 runs — fewer turns, faster, cheaper. Reproduces the direction of the
historical `--append-system-prompt` steering result (call-count tightening,
flounder elimination).

## Non-flow control ("what license is this project under?") — 1 run/arm

| Arm | tools | turns | duration | cost |
|---|---|---|---|---|
| no hook | 1 Bash | 2 | 15s | $0.263 |
| hook | 1 Read | 2 | 8s | $0.261 |

No regression: the injected line ("for structure/flow questions…") did not
push the agent into a wasteful graph call on a trivial question.

## Verdict

**Gate satisfied.** The shipped default-on steering hook matches or beats
baseline on flow questions and does not regress non-flow prompts.
(n=2/arm flow + 1/arm control on one small repo — the spec's minimum;
variance caveats apply as always. The haiku-tier steering TEMPLATE
(REQ-LOWMODEL-002) is not exercised headlessly — single-prompt sessions have
no model marker at hook time — and stays on-trial pending an interactive
eval; see lowmodel-haiku-baseline.md.)
