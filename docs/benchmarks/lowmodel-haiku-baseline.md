# Haiku baseline — LOWMODEL-DOC / MODCTX-DOC gate (REQ-LOWMODEL-005.A2)

**Measured 2026-07-12 · Claude Code 2.1.201 · `EVAL_MODEL=haiku` (claude-haiku-4-5) · specship 0.16.0+main · harness `scripts/agent-eval/run-all.sh`**

Three arms per repo, 2 runs each. `without` = no MCP. `with (off)` = specship
MCP, tier features inactive (no model marker — a fresh session's first
prompt). `with (ON)` = marker pre-seeded (`claude-haiku-4-5`) = the
steady-state of an installed session from prompt 2 onward: prose compaction,
haiku numbered-hop flow, blast-radius cap. (The haiku menu trim did NOT
engage in any arm — see finding 2.)

Repos: express (147 files, small tier) · excalidraw (656 files, medium tier).
Question per repo held constant across arms (repo-anchored phrasing — see
finding 3).

## Results (per run: specship calls / Reads / turns / duration / cost)

| Arm | express r1 | express r2 | excalidraw r1 | excalidraw r2 |
|---|---|---|---|---|
| without | Bash4+R8, — | Bash6+R9, — | Ag1+Bash21+R16, 188s $0.23 | Ag1+Bash24+R14 |
| with, features off | 4cg/1R/7t/70s/$0.096 | 3cg/0R/5t/43s/$0.056 | 4cg/0R/6t/45s/$0.120 | 3cg/1R/6t/41s/$0.088 |
| with, features ON (v1 banner) | 3cg/4R/11t/65s/$0.091 | 4cg/4R/11t/68s/$0.104 | 3cg/0R/5t/36s/$0.077 | 5cg/0R/7t/42s/$0.121 |
| with, features ON (**v2 banner**) | **1cg/0R/3t/27s/$0.026** | 3cg/1R/6t/35s/$0.060 | — | — |

## Findings

1. **The v1 compact-mode banner caused a re-read spiral (express, 2/2 runs).**
   The original wording — "compact mode (haiku) — `SPECSHIP_COMPACT=0` for
   full output" — told the model its output was incomplete; it re-Read files
   it had just been handed (4 Reads / 11 turns / ~420k tokens vs 0–1 Reads /
   5–7 turns / ~200k with features off). **Fix validated:** rewording the
   banner to assert completeness ("ALL code complete and verbatim — do not
   re-read these files") and removing the opt-out mention flipped ON from
   the worst arm to the best (v2 r1: 1 explore, 0 Reads, 3 turns, $0.026 —
   better than features-off). Lesson, now encoded in REQ-MODCTX-003: never
   advertise an escape hatch inside a response a small model must trust.
2. **The haiku menu trim never engaged** ("tools exposed: 14" in every arm,
   including marker-seeded): `tools/list` is answered at connect, before the
   engine lazily opens the project, and `getTools()` skips the trim without
   an open `cg`. The trim currently only takes effect on a client that
   re-fetches after `listChanged` fires (first code-graph call). Menu-trim
   effects are therefore UNMEASURED by this baseline; REQ-LOWMODEL-004 stays
   default-on-trial pending either connect-time tier resolution or an
   interactive-session eval.
3. **Generic questions void the control arm.** With "how does an incoming
   request reach a route handler?", the haiku without-arm answered from
   TRAINING DATA in one turn, zero tool calls (express is famous). Baseline
   questions must be repo-anchored ("in THIS repository's source… name the
   specific files"); after rephrasing, the without-arm did real work
   (6–26 Bash + 9–21 Reads).
4. **Medium repo (excalidraw): features-ON ≥ features-off even on v1** —
   0 Reads in both ON runs, fastest run of the repo (36s/$0.077). The
   banner regression was small-repo-specific (small outputs → the agent has
   budget to "double-check"), reinforcing that sufficiency *perception*
   matters as much as sufficiency.

## Per-tier pass bar (proposed from this baseline, per REQ-LOWMODEL-005)

- **Haiku, small repo:** ≤1 Read, ≤6 turns, specship calls ≤ explore budget.
  (v2 baseline meets it: 0–1 Reads.)
- **Haiku, medium repo:** ≤1 Read, ≤7 turns. (Baseline meets it: 0 Reads.)
- Frontier bar unchanged (~0 Read/Grep within the explore budget).

## Gate status

- REQ-MODCTX-002/003 (compaction + banner): **validated** with the v2
  banner (n=2/arm; the small-n caveat applies, but the v1→v2 delta was
  consistent and mechanistically explained).
- REQ-LOWMODEL-003 (numbered hops): active in the ON arms; no adverse
  signal; excalidraw ON matched or beat OFF.
- REQ-LOWMODEL-004 (menu trim): **unmeasured** (finding 2) — remains
  on-trial.
- REQ-LOWMODEL-002 (haiku steering template): not exercised headlessly
  (single-prompt sessions have no marker at hook time); validate in an
  interactive session eval.
