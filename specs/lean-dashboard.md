---
id: DASH-LEAN-DOC
title: Lean, registry-installable read-only dashboard
owner: "@selvakumar"
priority: high
version: 1
---

<!-- id: DASH-LEAN-DOC -->
# Lean, registry-installable read-only dashboard

Enterprise users build SpecShip from source against a locked-down internal npm
registry (a pull-through mirror or curated allowlist). The current dashboard
(`packages/web-ng`) is an Angular 21 SPA whose dependency closure resolves to
~640 packages — including bleeding-edge `@angular/*`, a 73 MB `monaco-editor`,
and a heavy build-tool tree. On a mirror that lacks a few of those packages, or
that blocks the post-install binary fetches native modules perform, the
`build:web` step fails and the whole build dies. The dashboard is therefore
unusable in exactly the environment that most needs a self-hosted, air-gapped
code-intelligence viewer.

This document makes the dashboard **lean and registry-installable** by rebuilding
it on a server-rendered (SSR) + interactivity-islands stack whose dependency
closure installs cleanly from a mirror-only registry, presents specs read-only
(removing the embedded code editor), and preserves the existing visual design
system and the read-only page set — while staying isolated from the MCP server
and CLI core so those keep working even when the dashboard is not built.

The dashboard is a **fully read-only viewer**: chat, spec editing, workflow
launching, and settings mutation are out of scope by design. The read-only
architecture (SSR) is a deliberate contract decision, not left to the
implementer.

Relationship to adjacent specs — these do **not** overlap:
- `OFFLINE-INSTALL-DOC` (`offline-install-package.md`) covers the **pre-built
  release bundle** self-installing on an air-gapped box with no npm at all. This
  document covers the **build-from-source-against-an-internal-registry** path,
  where npm runs but the registry is constrained.
- `BUNDLE-DASHBOARD-DOC` (`bundle-dashboard-freshness.md`) covers build hygiene
  (the bundle ships the freshly built UI). `OFFLINE-DOC` (`offline-mode.md`)
  covers runtime behavior when the server is unreachable. Neither addresses the
  dashboard's build-time dependency surface.

Kept page set (19, all read-only): `compare`, `costs`, `dashboard`, `domain`,
`drift`, `graph`, `heatmap`, `improvements`, `maintainability`, `mcp`, `memory`,
`run-detail`, `runs`, `session-detail`, `sessions`, `spec-detail`, `specs`,
`specship-impact`, `tips`.

Dropped page set (3, write/interactive-only, no read-only value): `chat`,
`design` (the designer loop page), `workflows` (launch UI; run history stays
under `runs`). The 2026-07-04 design import (REQ-DASHLEAN-005) added three
design screens to the kept set: `tips`, `design-system`, and a read-only
`settings` view — the design is canonical for the page set where the two
conflict.

Current integration sites the rebuild must preserve or adapt (prose, not
`implementations:` links — several are shell/generated and the graph does not
symbolize them): the CLI dashboard loader (`src/bin/specship.ts:loadServerPackage`,
`locateWebDir`), the web build pipeline (`scripts/build-web-bundle.mjs`), the
dashboard HTTP server (`packages/server`), and the root `build` script in
`package.json`.

<!-- id: REQ-DASHLEAN-001 -->
## The dashboard build's dependency closure MUST resolve from a mirror-only registry with no native build or post-install network

Every package the dashboard build installs MUST be a package published on the
public npm registry (so a pull-through mirror can serve it), and installing them
MUST NOT trigger any native compilation or any network request to a host other
than the configured registry. This is the property that lets the build succeed
behind a locked-down internal registry with no direct public-internet egress.

## Acceptance
<!-- id: REQ-DASHLEAN-001.A1 -->
- A clean install of the dashboard's dependencies, run against a registry that
  is the only reachable network host (no direct `registry.npmjs.org` egress),
  completes with exit code 0.
<!-- id: REQ-DASHLEAN-001.A2 -->
- No package in the dashboard's dependency closure runs a post-install step that
  fetches from any host other than the configured registry — no
  prebuilt-binary/GitHub download (`node-pre-gyp` / `prebuild-install`) occurs.
<!-- id: REQ-DASHLEAN-001.A3 -->
- The dashboard install and build complete with no native toolchain present — no
  `node-gyp` / C/C++ compile step runs.
<!-- id: REQ-DASHLEAN-001.A4 -->
- Every entry in the dashboard's resolved lockfile is a published, mirrorable
  package (no `git://`, `file:`, or tarball-URL dependency that a mirror cannot
  proxy).

<!-- id: REQ-DASHLEAN-002 -->
## The dashboard's installed dependency count MUST NOT exceed 250 packages

The number of packages in the dashboard's resolved dependency closure MUST be at
most 250, down from ~640 today. This ceiling is the measurable "lean" gate; a
smaller count is expected from the SSR + islands architecture and is welcome.

## Acceptance
<!-- id: REQ-DASHLEAN-002.A1 -->
- The dashboard package's resolved lockfile contains at most 250 packages.
<!-- id: REQ-DASHLEAN-002.A2 -->
- `monaco-editor` and every `@angular/*` package are absent from the dashboard's
  dependency closure.

<!-- id: REQ-DASHLEAN-003 -->
## The dashboard MUST present specs read-only with no embedded code editor

Spec content MUST be shown as rendered, read-only markdown. The dashboard MUST
NOT offer in-place spec editing and MUST NOT ship a heavyweight embedded code
editor. This removes both the editing affordance and its largest dependency.

implementations:
  - packages/web-ng/src/app/pages/specs/specs.ts:Specs
  - packages/web-ng/src/app/pages/spec-detail/spec-detail.ts:SpecDetail

## Acceptance
<!-- id: REQ-DASHLEAN-003.A1 -->
- The spec detail view renders spec content as formatted markdown and exposes no
  editable text field.
<!-- id: REQ-DASHLEAN-003.A2 -->
- The dashboard exposes no save/edit control for specs and issues no
  spec-mutation (write) request to the server.

<!-- id: REQ-DASHLEAN-004 -->
## The dashboard MUST be server-rendered with client interactivity confined to islands

Each page's primary content MUST be produced as fully-rendered HTML by the
server. The dashboard MUST NOT ship a client-side SPA router or component
framework; client-side JavaScript MUST be limited to self-contained interactive
islands (e.g. graph pan/zoom, heatmap hover), so pages with no island need no
framework runtime.

> **Superseded by REQ-DESKTOP-033.** The server-rendered dashboard retired in
> favour of the built SPA; the SSR routes and render modules that satisfied
> this requirement were removed, so it carries no implementation link.

## Acceptance
<!-- id: REQ-DASHLEAN-004.A1 -->
- On first request, each page's primary content is present in the server's
  initial HTML response rather than assembled client-side.
<!-- id: REQ-DASHLEAN-004.A2 -->
- The dashboard's dependency closure contains no client-side SPA router or
  component-framework runtime; interactive behavior is delivered as isolated
  islands.
<!-- id: REQ-DASHLEAN-004.A3 -->
- A kept page that has no interactive island renders and displays its content
  with client-side JavaScript disabled.

<!-- id: REQ-DASHLEAN-005 -->
## The rebuilt dashboard MUST preserve the existing visual design system

The rebuild MUST reproduce the "SpecShip Desktop" Claude Design bundle — the
canonical design reference imported on 2026-07-04 into `specs/lean-dashboard/`:
`design-system.css` (the design's own stylesheet: tokens for dark + light,
utility classes, `btn`/`pill`/`card` components, and the `sp-*` spec-document
formatting language) and `screens/*.html` (the 14 rendered screens captured
from the live design preview, whose markup and inline styles are the
pixel-level truth). Fidelity to that reference is a product requirement, not a
best-effort.

## Acceptance
<!-- id: REQ-DASHLEAN-005.A1 -->
- Each kept page's rendered appearance matches its captured reference screen in
  `specs/lean-dashboard/screens/` under side-by-side visual comparison, with no
  unintended differences in layout, color, type, or spacing.
<!-- id: REQ-DASHLEAN-005.A2 -->
- The dashboard serves the design's own stylesheet (tokens and classes from
  `specs/lean-dashboard/design-system.css`) rather than an approximation of it,
  and spec bodies render with the design's `sp-*` document formatting.
<!-- id: REQ-DASHLEAN-005.A3 -->
- The shell matches the design: grouped sidebar (PROJECT / CLAUDE CODE
  accordions with badges), top status strip with the project path, and the
  top bar with search affordance and theme toggle.

<!-- id: REQ-DASHLEAN-006 -->
## The rebuilt dashboard MUST preserve the read-only page set and serve no dropped page

Every page in the kept read-only set MUST remain reachable and render its data;
the four dropped write/interactive pages MUST NOT be served. Each kept page MUST
show the same data it shows today.

> **Superseded by REQ-DESKTOP-033.** The read-only page set is now served by the
> built SPA rather than the retired server-rendered routes; the SSR
> implementation was removed, so this requirement carries no implementation link.

## Acceptance
<!-- id: REQ-DASHLEAN-006.A1 -->
- Each of these routes resolves to a page that renders its data without error:
  `compare`, `costs`, `dashboard`, `domain`, `drift`, `graph`, `heatmap`,
  `improvements`, `maintainability`, `mcp`, `memory`, `run-detail`, `runs`,
  `session-detail`, `sessions`, `spec-detail`, `specs`, `specship-impact`,
  `tips`.
<!-- id: REQ-DASHLEAN-006.A2 -->
- The routes `chat`, `design`, `settings`, and `workflows` are not served (the
  dashboard exposes no page or launch/edit action for them).
<!-- id: REQ-DASHLEAN-006.A3 -->
- Each kept page displays the same data as the current dashboard, consuming the
  same server data contract it consumes today.

<!-- id: REQ-DASHLEAN-007 -->
## The dashboard rebuild MUST NOT affect the MCP server or CLI core, which stay buildable without it

The MCP server and CLI MUST remain buildable and runnable without installing the
dashboard's dependencies, and the dashboard MUST remain optional — its absence
MUST NOT break any CLI subcommand other than the one that serves it.

The dashboard HTTP server is loaded lazily (only the `serve --ui` handler pulls
it in), and `npm run build:core` builds the CLI + MCP server without the
dashboard. The `build:core` script is a package.json entry the graph does not
symbolize, so only the runtime isolation carries an `implementations:` link.

implementations:
  - src/bin/specship.ts:loadServerPackage

## Acceptance
<!-- id: REQ-DASHLEAN-007.A1 -->
- Building and running the MCP server (`specship serve --mcp`) succeeds without
  installing the dashboard's dependencies.
<!-- id: REQ-DASHLEAN-007.A2 -->
- Skipping the dashboard build breaks no CLI subcommand other than `serve --ui`.
<!-- id: REQ-DASHLEAN-007.A3 -->
- The dashboard's UI-framework dependencies are not pulled into the root/core
  package's runtime dependency closure.
