---
id: LANDING-DOC
title: Site landing redesign + docs restyle
owner: core
priority: medium
version: 1
---

<!-- id: LANDING-DOC -->
# Site landing redesign + docs restyle

The marketing/docs site (`site/`, Astro + Starlight, deployed to specship.cc via
Cloudflare Workers) gets reconciled to a Claude Design bundle. The canonical
visual source is the **"SpecShip Landing.html"** design at
`https://claude.ai/design/p/6d1bd9f2-5e3b-488a-b382-3179cc73d342?file=SpecShip+Landing.html`,
imported through the Claude Design MCP (`https://api.anthropic.com/v1/design/mcp`,
authenticated via `/design-login`) — the same import-and-reconcile flow used for
the web-ng dashboard.

Scope: the landing page (`site/src/pages/index.astro`) is reconciled to the
design, and the inner Starlight docs adopt the design's visual language. Content
must reflect the **shipped 0.9.0 product**, not aspirational or removed features
— the site has a standing drift problem, so accuracy is a first-class
requirement here, not an afterthought.

Files this touches: `site/src/pages/index.astro`, `site/src/styles/theme.css`,
`site/src/components/*`, and the Starlight config in `site/astro.config.mjs`.

<!-- id: REQ-LANDING-001 -->
## The landing page MUST be reconciled to the canonical Claude Design source

The landing page is brought into structural and visual correspondence with the
imported "SpecShip Landing.html" design — its sections, layout, and visual
treatment match the design bundle rather than the current hand-built page. The
design URL and filename are recorded as the source of truth so a later
divergence is detectable.

## Acceptance
<!-- id: REQ-LANDING-001.A1 -->
- The rendered landing page's section structure and layout correspond to the
  imported "SpecShip Landing.html" design (hero, feature/section blocks, and
  calls-to-action present and ordered as in the design).
<!-- id: REQ-LANDING-001.A2 -->
- The canonical design source (project URL + `SpecShip Landing.html`) is recorded
  in the repo so the landing's provenance is unambiguous.
<!-- id: REQ-LANDING-001.A3 -->
- Where the design and the shipped product disagree on a factual claim,
  REQ-LANDING-002 wins — the reconciliation adapts the design's copy to the truth
  rather than reproducing an inaccurate claim verbatim.

<!-- id: REQ-LANDING-002 -->
## Landing and docs copy MUST reflect the shipped product, not aspirational or removed features

Every factual claim on the redesigned site maps to a capability that actually
ships in the current release. Claims about removed or never-shipped features are
absent. This requirement governs the landing page and any docs copy touched by
the restyle.

## Acceptance
<!-- id: REQ-LANDING-002.A1 -->
- The install command shown matches the published package install
  (`npm i -g @specship/specship`).
<!-- id: REQ-LANDING-002.A2 -->
- Headline capabilities each map to a shipped feature: the workflow engine,
  the knowledge graph + MCP server, Claude Code analytics / SpecShip Impact, and
  the reflection engine ("Improvements").
<!-- id: REQ-LANDING-002.A3 -->
- The site contains no reference to removed or never-shipped features —
  specifically: no multi-agent installer (the product is Claude Code only), no
  fictional CLI subcommands (e.g. a `specship claude` command), and no removed
  MCP tools.
<!-- id: REQ-LANDING-002.A4 -->
- Any version or release reference on the site reflects the current published
  version, not an older or unreleased one.

<!-- id: REQ-LANDING-003 -->
## The inner docs MUST adopt the design's visual language

The Starlight documentation pages are restyled to share the design's visual
language with the landing page — a single source of design tokens drives both —
without breaking docs navigation, sidebar, or content rendering.

## Acceptance
<!-- id: REQ-LANDING-003.A1 -->
- Typography, color, and spacing on a representative docs page are visually
  consistent with the redesigned landing page (shared design tokens, not two
  divergent styles).
<!-- id: REQ-LANDING-003.A2 -->
- Starlight navigation, sidebar, search, and in-page content all render and
  function after the restyle (no broken or unstyled docs chrome).

<!-- id: REQ-LANDING-004 -->
## The site MUST render correctly in both light and dark themes

The landing page and docs are correct in both color themes, and the user's theme
choice persists across navigation and reload.

## Acceptance
<!-- id: REQ-LANDING-004.A1 -->
- Toggling the theme switches the landing page and docs between light and dark,
  and the choice persists across a page reload and across route navigation.
<!-- id: REQ-LANDING-004.A2 -->
- Text and interactive elements meet WCAG AA contrast in both themes on the
  landing page and a representative docs page.

<!-- id: REQ-LANDING-005 -->
## The site MUST be responsive and meet WCAG AA accessibility

The redesigned site is usable across viewport sizes and passes automated
accessibility checks with correct keyboard interaction.

## Acceptance
<!-- id: REQ-LANDING-005.A1 -->
- The landing page is usable with no horizontal overflow at mobile (~375px),
  tablet (~768px), and desktop (~1280px) widths.
<!-- id: REQ-LANDING-005.A2 -->
- The landing page and a representative docs page pass an automated AXE scan with
  no critical or serious violations.
<!-- id: REQ-LANDING-005.A3 -->
- All interactive elements are reachable and operable by keyboard with a visible
  focus indicator, and headings/landmarks follow a correct semantic order.

<!-- id: REQ-LANDING-006 -->
## The site MUST build and deploy through the existing pipeline with no broken links

The redesign builds with the existing Astro toolchain and deploys through the
existing Cloudflare Workers pipeline, with every internal link resolving.

## Acceptance
<!-- id: REQ-LANDING-006.A1 -->
- `astro build` completes without errors and produces the deployable `dist/`
  output.
<!-- id: REQ-LANDING-006.A2 -->
- Every nav link, call-to-action, and internal link on the landing page resolves
  to a real route (no 404s); external links (GitHub, install) point at the
  correct targets.
<!-- id: REQ-LANDING-006.A3 -->
- Any image asset whose bytes change is served under a new cache-busting URL
  (e.g. a bumped `?v=N`) so a stale cached asset is never shown.
