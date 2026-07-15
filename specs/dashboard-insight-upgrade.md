---
id: DASHUX-DOC
title: Dashboard insight upgrade
owner: specship
priority: medium
version: 1
---

<!-- id: DASHUX-DOC -->
# Dashboard insight upgrade

Follow-through on the 2026-07-03 dashboard review: the pages that visualize
SpecShip's fabric (graph, specs, spend/savings) should answer their core
question at a glance, stay fresh without manual refreshes, and not fight
themselves in the navigation. This document covers the SpecShip Impact
reframe, graph-page default view and layout memoization, spec-tree link-state
encoding, SSE-driven freshness, the Tips→Improvements merge, and the top-bar
project unification.

<!-- id: REQ-DASHUX-001 -->
## SpecShip Impact MUST lead with retrieval ROI, not raw net

The page's primary stat is estimated tokens/dollars saved by retrieval tools,
with the per-tool breakdown directly under it. Net (saved − spend) remains
visible but demoted to a secondary stat, formatted compactly, and labeled to
separate retrieval spend from governance overhead (link_assert / link_verify
/ spec calls are bookkeeping, not retrieval) so a negative net is
explained rather than alarming.

implementations:
  - packages/web-ng/src/app/pages/specship-impact/specship-impact.ts:SpecshipImpact

## Acceptance
<!-- id: REQ-DASHUX-001.A1 -->
- The first (leading) stat tile is estimated savings; net is not the leading
  tile.
<!-- id: REQ-DASHUX-001.A2 -->
- A negative net renders compactly (e.g. `-972k`) with an inline explanation
  distinguishing governance overhead from retrieval spend.

<!-- id: REQ-DASHUX-002 -->
## The graph page MUST default to a readable neighborhood and reuse layout work

The default view is the anchored/seeded neighborhood (most recently edited
area), not the 250-most-connected hairball; the full layout remains one
click away. The force layout result is memoized (a `computed()`), so kind
filters, selection, and pan/drag do not re-run the O(n²) simulation.

implementations:
  - ui/src/pages/graph.tsx:GraphPage

## Acceptance
<!-- id: REQ-DASHUX-002.A1 -->
- Opening `/graph` renders the anchored neighborhood view by default.
<!-- id: REQ-DASHUX-002.A2 -->
- With unchanged inputs, the force simulation runs at most once per data
  change (verified by call-count instrumentation in a test or by the layout
  function being a single `computed()` consumed by both readers).

<!-- id: REQ-DASHUX-003 -->
## Spec-tree entries MUST encode rolled-up link state, and the funnel MUST be visible

Each requirement's dot/badge in the specs tree is colored by its rolled-up
spec-link state (verified / implemented / drifted-or-broken / orphaned /
unlinked), not by node kind, so the tree reads as an alignment map. The
funnel summary is promoted to a visible stat strip on the page header.

implementations:
  - ui/src/pages/specs.tsx:SpecsPage

## Acceptance
<!-- id: REQ-DASHUX-003.A1 -->
- Two requirements with different link states render visibly different dot
  colors; the mapping is documented in a legend or tooltip.
<!-- id: REQ-DASHUX-003.A2 -->
- The funnel counts are rendered in the page header at standard stat-tile
  size, not only as small breadcrumb text.

<!-- id: REQ-DASHUX-004 -->
## Project-scoped pages SHOULD refresh from the server event stream

The dashboard, drift queue, and costs pages subscribe to the server's SSE
event stream and re-fetch their resources when a relevant event (index
update, ingest progress) arrives, debounced, so the pages track the live
index/ingest without manual refresh. When the stream is unavailable the
existing fetch-once behavior is unchanged.

implementations:
  - ui/src/hooks.ts:useApi
  - ui/src/api.ts:runEventsUrl

## Acceptance
<!-- id: REQ-DASHUX-004.A1 -->
- With the dashboard open and a re-index or new ingest event emitted on
  `/api/events`, the affected page data refreshes within a few seconds
  without user action.
<!-- id: REQ-DASHUX-004.A2 -->
- When the event stream cannot connect, pages still load via the normal
  fetch path with no errors surfaced.

<!-- id: REQ-DASHUX-005 -->
## Tips MUST merge into Improvements as one surface

Tips and Improvements present the same mined-from-transcripts insight with
the same actions. They become one sidebar destination ("Improvements") with
the tip-style evidence/impact presentation preserved; `/tips` redirects to
the merged page so deep links keep working, and the sidebar shows a single
combined badge count.

implementations:
  - ui/src/router.ts:usePathRoute
  - ui/src/App.tsx:Sidebar

## Acceptance
<!-- id: REQ-DASHUX-005.A1 -->
- The sidebar contains one entry for Improvements and none for Tips;
  navigating to `/tips` lands on the merged page.
<!-- id: REQ-DASHUX-005.A2 -->
- The merged page exposes both the durable-rule proposals and the
  tip evidence cards (no data loss from either page).

<!-- id: REQ-DASHUX-006 -->
## The top bar MUST show the effective project instead of a placeholder

When a project is active — picked by the user or defaulted by the server —
the project picker control displays that project's name/path. The
"Select project" placeholder appears only when no project is resolvable at
all (projectless boot with nothing picked).

implementations:
  - ui/src/App.tsx:ProjectSwitcher

## Acceptance
<!-- id: REQ-DASHUX-006.A1 -->
- With the server booted against a primary project and no explicit user
  pick, the picker control shows that project (not "Select project").
<!-- id: REQ-DASHUX-006.A2 -->
- With an explicit pick, the picker shows the picked project and scoped
  pages query with its slug (existing behavior preserved).
