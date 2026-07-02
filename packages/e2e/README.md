# @specship/e2e — dashboard browser smoke gate

Browser end-to-end tests for the **SpecShip Desktop** dashboard. This is the
regression guard for the "dashboard opens blank / shows no data" class of bug
(e.g. the same-origin + CORS regression fixed in #55): those bugs are invisible
to the vitest unit/integration suites because nothing there boots the real
Angular SPA in a browser against a live server.

## What it does

`playwright.config.ts` starts a `webServer` that runs
[`scripts/prepare-and-serve.mjs`](./scripts/prepare-and-serve.mjs), which:

1. Builds a **hermetic fixture** (`lib/fixture.mjs`): a tiny source tree indexed
   via the built `SpecShip` library (→ graph nodes/edges) plus seeded Claude
   transcript JSONL under a throwaway `$HOME` (→ cost / tool-call / heatmap
   analytics). Nothing touches your real project or `~/.claude`.
2. Boots `specship serve --ui --host 127.0.0.1` against that fixture.

`tests/dashboard-data.spec.ts` then opens the dashboard **at `127.0.0.1`** (the
exact condition #55 regressed on) and asserts the KPI tiles leave their loading
skeleton and render values, that every `/api` call stayed **same-origin** and
succeeded, and that the graph/analytics endpoints return populated payloads.

## Running locally

```bash
npm run build                     # from repo root — produces dist/bin + dist/web
cd packages/e2e
npm install
npx playwright install chromium
npm test                          # or: npm run test:headed
```

Requirements:

- The repo must be **built** first (`npm run build` at the root) — the harness
  drives `dist/bin/specship.js` and serves `dist/web`.
- SQLite with **FTS5**. Native `better-sqlite3` ships it; on a Node without FTS5
  in its built-in `node:sqlite`, run `npm rebuild better-sqlite3` at the repo
  root (or use the bundled Node 24). Without it, indexing the fixture fails with
  `no such module: fts5`.

## CI

- **`.github/workflows/e2e.yml`** runs this on pull requests touching the
  dashboard, server, or CLI.
- **`.github/workflows/release.yml`** runs it as a **blocking gate** between
  bundling and `npm publish`, so a dashboard-blank regression can't ship.
