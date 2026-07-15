---
id: MAINT-DOC
title: Maintainability harness (graph-derived signals)
owner: core
priority: medium
version: 1
---

<!-- id: MAINT-DOC -->
# Maintainability harness

The implementable spec for the first harness-engineering expansion lane,
`REQ-STRATEGY-001` (see `specs/harness-engineering-strategy.md` and
`docs/strategy/harness-engineering-positioning.md`). It is the *maintainability*
dimension of Fowler's three harnesses — and the cheapest to land credibly,
because every signal is derived from the **existing knowledge graph** with no
new parse.

Scope of v1: four deterministic, graph-derived signals — coupling, size
hotspots, dependency cycles, and dead-code candidates — exposed through the CLI,
an MCP tool, and the dashboard, with built-in thresholds a project can override.
v1 is **advisory** (reports only), but shaped so the enforcement lane
(`REQ-STRATEGY-003`) can later turn it into a CI gate without a redesign.

Out of scope for v1: true cyclomatic complexity (would require analyzing symbol
bodies, i.e. a new extraction pass — this lane is deliberately graph-only),
duplication detection, and style/lint (those are external-tool territory).

Integration points the implementation will build on (no new extraction): node
line spans (`start_line`/`end_line`) and per-file grouping, edge degree via
`QueryBuilder.getIncomingEdges`/`getOutgoingEdges`, and graph traversal via
`GraphQueryManager` / `GraphTraverser`; surfaced through the MCP tool registry
(`src/mcp/tools.ts`), the CLI (`src/bin/specship.ts`), and the dashboard.

<!-- id: REQ-MAINT-001 -->
## SpecShip MUST derive deterministic maintainability signals from the graph

SpecShip computes four maintainability signals from the existing index, with no
additional file parsing: coupling, size hotspots, dependency cycles, and
dead-code candidates. The signals are deterministic so they can underpin a
future CI gate.

implementations:
  - src/graph/maintainability.ts:computeMaintainability

## Acceptance
<!-- id: REQ-MAINT-001.A1 -->
- Reports per-symbol and per-file **coupling** — fan-in (incoming edge count) and
  fan-out (outgoing edge count) — derived from the graph's edges.
<!-- id: REQ-MAINT-001.A2 -->
- Reports **size hotspots** — oversized symbols (by `end_line − start_line`
  span) and god-files (by symbol count and/or total span) — derived from node
  line metadata.
<!-- id: REQ-MAINT-001.A3 -->
- Reports **dependency cycles** — strongly-connected components over import/call
  edges — listing each cycle's member files/symbols.
<!-- id: REQ-MAINT-001.A4 -->
- Reports **dead-code candidates** — symbols with zero incoming edges that are
  not exported and not framework entrypoints/routes — and does NOT flag a symbol
  that is reachable only via a synthesized (heuristic/`provenance:'heuristic'`)
  edge, so dynamic-dispatch targets are not false-flagged.
<!-- id: REQ-MAINT-001.A5 -->
- All signals are computed from the existing index with no additional file
  parse, and re-running against an unchanged index returns byte-identical
  results.

<!-- id: REQ-MAINT-002 -->
## SpecShip MUST apply configurable thresholds with sensible defaults

Each signal flags items against a threshold. SpecShip ships defaults that work
out of the box and lets a project override them, so the harness adapts to repo
size and language without code changes.

implementations:
  - src/graph/maintainability.ts:resolveThresholds

## Acceptance
<!-- id: REQ-MAINT-002.A1 -->
- Every signal has a built-in default threshold, so the harness produces useful
  output with no configuration.
<!-- id: REQ-MAINT-002.A2 -->
- A checked-in project configuration can override each signal's threshold, and
  the effective threshold in force is reported alongside the results.
<!-- id: REQ-MAINT-002.A3 -->
- Each flagged item states why it surfaced — the threshold it breached (or its
  top-N rank) — so a finding is actionable, not just a number.
<!-- id: REQ-MAINT-002.A4 -->
- A repository with nothing past threshold returns an explicit "clean" result,
  not an empty or ambiguous one.

<!-- id: REQ-MAINT-003 -->
## SpecShip MUST surface the report through CLI, MCP, and the dashboard

The maintainability report is reachable where the agent and the human already
work: a headless CLI command, an MCP tool, and a dashboard page. The CLI is
advisory by default but shaped to become a CI gate later.

implementations:
  - src/mcp/maintainability-tool.ts:handleSpecshipMaintainability
  - server/src/routes/maintainability.ts:registerMaintainabilityRoutes

## Acceptance
<!-- id: REQ-MAINT-003.A1 -->
- A headless CLI command runs the analysis and emits both a human-readable
  summary and a `--json` form, with no dashboard required.
<!-- id: REQ-MAINT-003.A2 -->
- An MCP tool returns the same maintainability report to the agent.
<!-- id: REQ-MAINT-003.A3 -->
- A dashboard page presents the signals, ranked, with each finding linking to its
  file/symbol.
<!-- id: REQ-MAINT-003.A4 -->
- The CLI is advisory by default (exit 0 even with findings) but gating-ready: a
  documented strictness flag is defined so the enforcement lane
  (`REQ-STRATEGY-003`) can make it exit non-zero on a breach without changing the
  report format.
