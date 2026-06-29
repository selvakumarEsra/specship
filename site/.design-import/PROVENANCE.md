# Landing design — provenance (REQ-LANDING-001.A2)

The landing page (`site/src/pages/index.astro`) is reconciled to a Claude Design
bundle. This directory holds the regeneration tooling; the bulky raw bundle is
gitignored (re-fetchable from the source below).

## Canonical source

- **Project:** https://claude.ai/design/p/6d1bd9f2-5e3b-488a-b382-3179cc73d342
- **File:** `SpecShip Landing.html`
- **Imported via:** the Claude Design MCP (`https://api.anthropic.com/v1/design/mcp`,
  authenticated with `/design-login`).

## How the committed landing files are generated

`transform.mjs` consumes the raw bundle and produces the committed build inputs:

- `../src/pages/_landing-body.html` — the design body, with the designer
  instrumentation (`data-om-id`, the omelette injector) stripped and the design's
  placeholder / aspirational copy rewritten to shipped-product truth
  (REQ-LANDING-002): real `npm i -g @specship/specship` install, real
  repo/docs links, live star-count placeholder, the reflection-engine beat, a
  light/dark toggle. Dynamic values stay as `__PLACEHOLDERS__` that `index.astro`
  fills at build.
- `../src/styles/landing.css` — `styles.css` (design system) + `landing.css`
  (page layout), page-scoped so it never leaks into the Starlight docs.
- `../src/scripts/landing-runtime.js` — the design's runtime (nav-scroll state,
  copy buttons, scroll-reveal observer, stat counters).

## To regenerate

1. Re-fetch the bundle into this directory as `SpecShip-Landing.html`, `styles.css`,
   `landing.css` (via the Claude Design MCP — see the source above).
2. `node .design-import/transform.mjs` from `site/`.
3. `npm run build` to verify.
