---
id: DASHINT-DOC
title: Dashboard data integrity
owner: specship
priority: high
version: 1
---

<!-- id: DASHINT-DOC -->
# Dashboard data integrity

The desktop dashboard's credibility rests on its numbers being real. A joint
code/UX/API audit (2026-07-03) found five places where the dashboard shows
wrong, fabricated, or crash-prone data: unpriced `claude-fable-5` sessions
cost $0.00 everywhere; the shared delta component renders raw ratios
(`-1`, `+2.372016052719695`); the session-summary endpoint 500s on sessions
containing Skill calls; the home page draws randomly generated graph edges;
and the MCP page silently substitutes fabricated seed servers. This document
specifies the corrections.

<!-- id: REQ-DASHINT-001 -->
## Sessions from unpriced Claude model families MUST NOT be costed at $0

The pricing resolver falls back by model family. The `fable` family (e.g.
`claude-fable-5`) is added alongside opus/sonnet/haiku, priced at the
published Fable rate, and the seeded pricing table carries a matching row.
Already-ingested sessions whose cost was computed as 0 while their tokens are
non-zero MUST be re-costed on the next ingest boot (idempotent backfill),
so historical charts heal without manual intervention.

implementations:
  - packages/server/src/ingest/pricing.ts:resolvePricing
  - packages/server/src/ingest/ingestor.ts:seedPricing
  - packages/server/src/ingest/impact-backfill.ts:backfillDisplaced

## Acceptance
<!-- id: REQ-DASHINT-001.A1 -->
- A session whose model is `claude-fable-5` (any date/window suffix) computes
  a non-zero cost when its token usage is non-zero.
<!-- id: REQ-DASHINT-001.A2 -->
- After the backfill pass, a previously-ingested fable session with non-zero
  tokens and `total_cost_usd = 0` has a recomputed non-zero cost.
<!-- id: REQ-DASHINT-001.A3 -->
- An unknown future family still resolves to null pricing (cost 0) rather
  than throwing.

<!-- id: REQ-DASHINT-002 -->
## Delta and compact-number formatting MUST render every real value legibly

The shared delta component receives one unit — a signed fraction (0.55 =
+55%, -1 = -100%) — and renders it as a percentage for any finite magnitude,
including exactly ±1 and ratios above 1. The compact-number formatter
(`fmtK`) abbreviates negative magnitudes the same way it abbreviates
positive ones (-971752 → -972k). Producers currently emitting raw counts or
unbounded ratios into delta slots are normalized to fractions.

implementations:
  - packages/web-ng/src/app/ui/delta.ts:Delta
  - packages/web-ng/src/app/pages/specship-impact/specship-impact.ts:fmtK

## Acceptance
<!-- id: REQ-DASHINT-002.A1 -->
- A delta of -1 renders as `-100%`, not `-1`.
<!-- id: REQ-DASHINT-002.A2 -->
- A delta of 2.372016052719695 renders as a rounded percentage (`+237%`),
  never as the raw float.
<!-- id: REQ-DASHINT-002.A3 -->
- `fmtK(-971752)` renders `-972k` (sign preserved, magnitude abbreviated).

<!-- id: REQ-DASHINT-003 -->
## The session summary endpoint MUST NOT 500 on truncated tool input

`GET /api/claude/session/:id/summary` extracts the skill name from tool-call
input. The ingester truncates `input_summary` to 400 chars, which yields
invalid JSON and a `SQLITE_ERROR` from `json_extract`. The query reads the
untruncated `input_json` column instead and guards every JSON extraction
with `json_valid()`, so malformed rows degrade to null instead of failing
the request.

implementations:
  - packages/server/src/routes/claude.ts:registerClaudeRoutes

## Acceptance
<!-- id: REQ-DASHINT-003.A1 -->
- A session containing a Skill tool call whose `input_summary` is truncated
  (invalid JSON) returns 200 with a summary; the skill name comes from
  `input_json` when valid.
<!-- id: REQ-DASHINT-003.A2 -->
- A row with malformed JSON in both columns contributes null skill data but
  does not fail the request.

<!-- id: REQ-DASHINT-004 -->
## The dashboard neighborhood graph MUST NOT draw fabricated edges

The home page's "Recent neighborhood" panel currently invents edges between
real nodes with `Math.random()`. Edges are either real (fetched from the
graph API for the displayed node set) or absent — when no real edge data is
available the panel renders the nodes without connecting lines. No
randomness is used in any computed().

implementations:
  - packages/web-ng/src/app/pages/dashboard/dashboard.ts:Dashboard

## Acceptance
<!-- id: REQ-DASHINT-004.A1 -->
- With live nodes returned from the graph API, every rendered edge
  corresponds to an edge returned by the server for those nodes.
<!-- id: REQ-DASHINT-004.A2 -->
- Rendering the dashboard twice over identical data produces identical
  edges (deterministic).

<!-- id: REQ-DASHINT-005 -->
## Seeded placeholder data MUST be visibly labeled as sample

Surfaces that fall back to illustrative seed data when their backing
endpoint is missing or empty (the MCP servers page today) MUST mark that
state with an explicit SAMPLE treatment on the data itself (badge on each
seeded card/row), not only a dismissible banner, so a screenshot of the page
cannot be mistaken for live data.

implementations:
  - packages/web-ng/src/app/pages/mcp/mcp.ts:Mcp

## Acceptance
<!-- id: REQ-DASHINT-005.A1 -->
- When the MCP endpoint is unreachable, every displayed seed server carries
  a visible `SAMPLE` marker in addition to the page-level notice.
