# Agent-eval harness

<!-- Inherits all rules from the root CLAUDE.md. This file adds the
     validation methodology for scripts/agent-eval/. -->

## What this module is

The with/without A/B harness and deterministic probes that gate every
retrieval, budget, and dynamic-dispatch change.

## Validation methodology (REQUIRED for every new language/framework)

For each **language × framework**, validate on **small, medium, and large**
real repos with **≥3 different flow prompts** each:

1. **Pick the canonical flow** for the framework ("how does X reach Y":
   state→render, request→handler→view, query→SQL, action→reducer→store…).
2. **Deterministic probes** (`probe-node.mjs` / `probe-explore.mjs` against
   the built `dist/`): `specship_explore` with the flow's symbol names
   connects from→to with no break; **no node explosion** (`select count(*)
   from nodes` stable before/after re-index); synthesized-edge **precision**
   spot-check (`select … where provenance='heuristic'`).
3. **Agent A/B** (`run-all.sh <repo> "<Q>"`): with vs without specship,
   **≥2 runs/arm** — run-to-run variance is large; never conclude from n=1.
   Record duration, total tool calls, Read, Grep. `EVAL_MODEL=haiku|sonnet`
   baselines lower tiers (LOWMODEL-DOC). Optional forced-Read-0 sufficiency
   proof via the block-read hook (`hook-settings.json`).
4. **Pass bar:** a normal flow question reaches **~0 Read/Grep within the
   repo's explore-call budget**, runs faster than without-specship, and
   shows no regression on a control repo. Record the numbers in
   `docs/design/dynamic-dispatch-coverage-playbook.md`.
5. **Exact-name recall** (REQ-EXPLORE-PIN-004.A2): `probe-recall.mjs <repo>`
   samples named targets from the repo's own index (kebab-case paths,
   basenames, non-callable symbols) and explores each by name. It prints a
   per-run recall figure and **exits non-zero below `RECALL_MIN` (default
   1.0) — that failure fails the A/B pass bar**, so a ranking change cannot
   silently regress named-target retrieval.

## Gemini runner (LOWEND-DOC REQ-LOWEND-005)

The same A/B methodology through Gemini CLI, pinned to `gemini-3.5-flash`:

```bash
scripts/agent-eval/run-all-gemini.sh <repo> "<Q>"                # auto tier
SPECSHIP_MODEL=lite     scripts/agent-eval/run-all-gemini.sh <repo> "<Q>"
SPECSHIP_MODEL=standard scripts/agent-eval/run-all-gemini.sh <repo> "<Q>"
```

- **Prerequisites are hard failures** (REQ-LOWEND-005.A2): no `gemini` on
  PATH, or a smoke call that fails/auth-errors, exits 1 before any arm runs.
  A skipped Gemini eval is never recorded as a pass.
- **Arms are settings-driven**, not flag-driven — Gemini CLI has no
  `--mcp-config`/`--strict-mcp-config`. The runner writes
  `<repo>/.gemini/settings.json` per arm (with = `mcpServers.specship`
  carrying `SPECSHIP_HOST=gemini` so the host-gated tier detection fires;
  without = none), pins `--allowed-mcp-server-names` so a global entry can't
  leak in, and restores any pre-existing file on exit.
- **The two `SPECSHIP_MODEL` arms are REQ-LOWEND-002's decision procedure**:
  run `lite` and `standard` under the same question and adopt the tier with
  the lower fallback rate that still meets the pass bar.
- `EVAL_RUNS` defaults to **2** — the ≥2-runs-per-arm rule applies here too.
- **No cost figure.** Gemini CLI reports no dollar amount, so `costUsd` is
  `null` and prints as `n/a`; comparisons use tool calls, wall-clock, and the
  Read/Grep fallback rate. Gemini rows go in
  `docs/benchmarks/call-sequence-analysis.md`, not the README block.
- Arms run with `--output-format stream-json` (the only Gemini form that
  carries the **ordered** tool sequence; plain `json` is aggregate-only —
  `parse-run-gemini.mjs` reads both). Flags and both output schemas were
  read out of the installed `@google/gemini-cli` 0.28.0, not assumed.
- Metrics from both hosts share one schema (`eval-metrics.mjs`);
  `parse-run-gemini.mjs` normalizes Gemini's tool names
  (`read_file`→`Read`, `search_file_content`→`Grep`,
  `run_shell_command`→`Bash`) so fallback counting is comparable. Output it
  cannot recognize exits 2 rather than scoring a zero-tool run.

Questions must be **repo-anchored** ("in THIS repository's source…") — a
generic question lets the without-arm answer from training data and voids
the control (measured on express/haiku).

Measure tokens by **summing per-turn assistant usage**, not `result.usage`
(last-turn-only in current Claude Code). Cost + tool/Read counts are the
reliable signals.

## Worked example — Excalidraw (TS/React, medium, 643 files)

Question: "how does updating an element re-render the canvas on screen?"
(crosses observer callback, `setState`→`render`, and JSX-child boundaries).
Without specship: 115–139s, 9–10 Read, 10–11 Grep. Fixed budgets + messages
+ synthesis: 64–112s, 0–2 Read. With trace-first steering: 51–74s, 0–2 Read,
2/4 runs fully clean; call count tightened to 3–4. Residual reads are the
nonce data-flow (`canvasNonce` — a local prop with no graph edges), the
deliberately-uncovered def-use frontier. Full record:
`docs/benchmarks/call-sequence-analysis.md`.
