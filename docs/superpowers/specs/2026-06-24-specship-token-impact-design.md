# SpecShip Token Impact — Design

**Date:** 2026-06-24
**Status:** Design (pre-implementation)
**Scope owner:** dashboard / ingest

## 1. Goal

Surface SpecShip's token impact in the desktop dashboard:

1. **Measured spend** — the tokens (and est. cost) consumed *by using SpecShip*, attributed per prompt → session → project → all-projects.
2. **Estimated savings** — a clearly-flagged estimate of the tokens SpecShip *avoided* by answering structural/flow questions from the graph instead of Read/Grep.
3. **Net impact** — `saved − spend`, shown honestly (may be negative).

Rollup respects the existing project picker: a single project when one is selected, **all projects** when none is.

## 2. Decisions (settled during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Honesty model | Measured spend (hard) **+** estimated savings (flagged `est.`) | Savings is a counterfactual; never present it as measured. |
| v1 attribution scope | Per **prompt → session → project → all-projects** | The data is already in `claude_prompts` / `claude_tool_calls`. |
| Workflows | **Phase 2** | `workflow_runs` has no token columns and no link to driven prompts; needs new instrumentation. |
| Savings model | **B — input-resolution (grounded)** | Estimate avoided tokens from the *real file sizes* of the symbols each call asked for, via the live graph. Fails safe toward under-claiming. |
| Placement | **New top-level "SpecShip Impact" page** | Dedicated, prominent; per-prompt chip + session line feed it. |
| Tool-definition overhead | **Include** as one simple estimated "fixed overhead" line | It's a real always-on SpecShip cost; omitting it would overstate net benefit. |
| Token estimate | **chars ÷ 4** everywhere, labeled est. | Standard proxy; a real tokenizer is a later refinement. |

## 3. Definitions

- **SpecShip tool call:** a `claude_tool_calls` row whose `tool_name LIKE 'mcp__specship__%'`. Covers code-graph, spec, and designer tools.
- **Source-returning code-graph tools** (the only ones that contribute *savings*): `specship_explore`, `specship_node`, `specship_callers`, `specship_callees`, `specship_impact`, `specship_search`, `specship_files`. Spec-mutation tools (`link_assert`/`link_verify`) and `designer_*` count toward **spend** but never **savings** (they displace no Read).
- **Spend (per call):** `result_length` (characters of the tool result) → tokens ≈ `ceil(result_length / 4)`. A call with `result_length` 0 or `NULL` (older/uncaptured rows) contributes **0 spend** and is treated as **`unresolved` for savings** — we can't know the slice it returned, so we don't credit displacement against an unknown size (avoids over-crediting `saved = displaced − 0`).
- **Read-equivalent (per source-returning call):** the summed byte-size of the distinct files the call's requested symbols resolve to in the graph — what a `Read` of those files would have cost.
- **Saved (per call):** `max(0, read_equivalent_chars − result_length)`.
- **Fixed overhead (per session):** estimated size of SpecShip's MCP tool-definition schemas injected into the system prompt, counted once per session that used SpecShip.

## 4. The savings computation (load-bearing)

For each source-returning code-graph call:

1. Parse `input_json` to recover what was asked for (e.g. `specship_node`'s `symbol`, `specship_explore`'s `symbols`/`query`, `specship_impact`'s `symbol`).
2. Resolve those symbols/paths → the file(s) they live in, **via that session's project graph** (the `.specship` index for the session's `project_path`), using the multi-project registry the server already has.
3. `read_equivalent_chars` = Σ size of those **distinct** files.
4. `saved_chars = max(0, read_equivalent_chars − result_length)`.
5. **Unresolvable input → contributes 0 savings** (e.g. a natural-language `explore` query with no symbol bag, or a project whose index isn't available). Mark the call `unresolved` so the UI can disclose coverage.
6. **De-dup within a prompt:** a file counted once per prompt even if multiple calls touch it (a real Read might re-read; counting once is the conservative direction).

### Where it's computed — at ingest, stored on the row

To keep the page pure SQL aggregation, compute the per-call values **once at ingest** and persist them:

- **Schema migration (v9):** add to `claude_tool_calls`:
  - `is_specship INTEGER NOT NULL DEFAULT 0` — fast filter / index.
  - `displaced_chars INTEGER` — `read_equivalent_chars` for a resolved source-returning call; `NULL` when not applicable or unresolved.
  - `resolution TEXT` — `'resolved' | 'unresolved' | 'n/a'` (n/a = not a source-returning tool).
- **Ingestor change:** when writing a SpecShip tool call, set `is_specship`, and for source-returning tools attempt resolution against the session's project graph (opened via the project registry; failure ⇒ `unresolved`, `displaced_chars = NULL`).
- **Backfill migration:** recompute `is_specship` for all existing rows (pure rename/flag from `tool_name`); recompute `displaced_chars` where the project graph is currently available, else leave `unresolved`. Idempotent + re-runnable.

> **Risk flagged:** resolution at ingest needs the *session's* project index open, which may differ from the analytics host project and may be absent. The design degrades to `unresolved` (spend still exact) rather than guessing — and the UI states the unresolved share.

## 5. Aggregation & API

New endpoint:

```
GET /api/claude/specship-impact?project=<slug|all>&range=<day|week|month|all>
```

Returns:

```jsonc
{
  "spendTokens": 0, "spendCostUsd": 0,
  "savedTokens": 0, "savedCostUsd": 0,   // est.
  "overheadTokens": 0,                    // est. fixed tool-def overhead
  "netTokens": 0, "netCostUsd": 0,        // saved − spend − overhead
  "unresolvedCalls": 0, "totalSpecshipCalls": 0,  // coverage disclosure
  "byTool": [ { "tool": "specship_explore", "calls": 0, "spendTokens": 0, "savedTokens": 0 } ],
  "byProject": [ /* only when project=all */ ],
  "trend": [ { "ts": 0, "spendTokens": 0, "savedTokens": 0 } ]
}
```

- Spend / overhead / coverage: pure SQL over `claude_tool_calls` (+ `claude_sessions` for project/range scoping).
- Saved: SQL sum of `displaced_chars − result_length` over resolved source-returning calls, deduped per prompt (dedup handled at ingest by only attributing a file once per prompt, OR via a `GROUP BY prompt_id, file` staging — decided in the plan).
- Cost: price est. tokens with the existing `pricing.ts` per-model table at the model's input rate (conservative-high). Unknown model ⇒ tokens only, no cost.

## 6. UX

### New "SpecShip Impact" page (sidebar, near Costs/Compare)
- **Header tiles:** Spend (tokens · est. cost) · **Est. saved** `[est.]` (tokens · est. cost) · Net (with up/down delta vs prior period) · Coverage ("savings est. from X% of SpecShip calls; Y unresolved").
- **Trend:** spend-vs-saved over the selected range (area/sparkline, existing chart kit).
- **By tool:** table — tool, calls, spend, est. saved.
- **By project:** shown only in all-projects mode.
- **Methodology disclosure:** a visible footer/tooltip stating: chars÷4; savings = file-size displacement of resolved symbols; dedup per prompt; unresolved = 0; cost priced at input rate.

### Per-prompt (Session Detail)
- A small `SpecShip ~X tok` chip on each prompt row, beside the existing tool-mix chips. Tooltip: spend / est. saved / net for that turn.

### Per-session (Session summary panel)
- One line: `SpecShip: spent ~A tok · est. saved ~B tok · net C`.

## 7. Error handling & honesty rails

- Unresolved calls are **counted and disclosed**, never silently folded into savings as 0-benefit-but-counted.
- `designer_*` and spec-mutation tools: in spend, never in savings.
- Negative net is shown as-is.
- Every saved/cost figure carries the `est.` badge with the assumption on hover.
- Missing pricing for a model ⇒ tokens only.
- A project with no SpecShip usage ⇒ empty state, not an error.

## 8. Testing

- **Unit:** spend aggregation SQL; `input_json` → symbol extraction per tool; symbol → file → size resolution (mock graph); per-prompt file dedup; unresolved ⇒ 0; designer/spec-mutation excluded from savings; chars÷4; overhead constant.
- **Integration:** ingest a synthetic JSONL containing SpecShip tool calls against a known fixture graph ⇒ assert `is_specship` / `displaced_chars` / `resolution` rows, then assert `/api/claude/specship-impact` totals (spend, saved, net, coverage) for single-project and all-projects.
- **Unresolved fixture (explicit):** a session whose project index is **missing/unopenable** ⇒ every source-returning call lands `resolution='unresolved'`, `displaced_chars=NULL`, **spend still exact**, and the endpoint reports it in `unresolvedCalls` (savings not inflated).
- **Migration:** v9 add-columns + backfill correctness; idempotent re-run is a no-op.

## 9. Out of scope (v1) / Phase 2

- **Per-workflow attribution** — requires the executor to record the session/prompts each run drove (or a token field on `workflow_runs`). Phase 2.
- **Real tokenizer** (replace chars÷4).
- **Counterfactual A/B** beyond the displacement estimate.

## 10. Open assumptions to validate in plan

- Exact `input_json` shapes per source-returning tool (drives the symbol extractor).
- ~~Whether file *byte size* is directly available~~ — **resolved:** the `files` table has a `size` (byte) column; read it directly, no `stat` at ingest.
- Dedup implementation site (ingest-time vs query-time `GROUP BY prompt_id, file`). Trade-off: ingest-time bakes the per-prompt assumption into stored `displaced_chars` (harder to revisit); query-time keeps raw per-call data re-computable. **Lean query-time** unless aggregation cost demands otherwise — decide in the plan.
- Overhead constant source (measure the serialized tool-definition payload once).
