# @specship/e2e — dashboard browser E2E suite

Browser end-to-end tests that drive the **built SpecShip Desktop SPA** served by
the real dashboard server (**REQ-DESKTOP-032**). These exercise flows the vitest
unit/integration suites can't see because nothing there boots the app in a
browser against a live server — including the "dashboard opens blank / shows no
data" same-origin/CORS class of bug (e.g. #55).

## What it does

`playwright.config.ts` starts a `webServer` that runs
[`scripts/prepare-and-serve.mjs`](./scripts/prepare-and-serve.mjs), which:

1. Ensures the **built SPA** exists (`ui/dist`) — building it on demand if you
   ran `cd e2e && npm test` standalone.
2. Builds a **hermetic fixture** (`lib/fixture.mjs`): a tiny source tree indexed
   via the built `SpecShip` library (→ graph nodes/edges) plus seeded Claude
   transcript JSONL under a throwaway `$HOME` (→ cost / tool-call / heatmap
   analytics). Nothing touches your real project or `~/.claude`.
3. Boots the real server over the SPA:
   `specship desktop --web-dir <repo>/ui/dist --path <fixture>`.
   The SPA is the dashboard's only surface (REQ-DESKTOP-033 — the
   server-rendered dashboard retired), served with its client-side-routing
   fallback; no flag is needed to select it.

The specs then drive the app at `127.0.0.1` (the exact condition #55 regressed
on):

- **`screens-render.spec.ts`** — visits every routed screen (`lib/screens.mjs`,
  mirrored from `ui/src/App.tsx`), asserts its key content rendered, and asserts
  **zero console errors** (`console.error` **and** uncaught `pageerror`) per
  screen. The allowlist in `lib/console.ts` is empty by design.
- **`spec-edit-save.spec.ts`** — selects the fixture spec, edits its statement,
  Saves, asserts the `PUT /api/spec` fired, **re-reads the `.md` from disk** to
  prove persistence, sees the re-queued (Drafted) status and the edited text
  render back, then restores the fixture.
- **`theme-palette.spec.ts`** — theme toggle persists across a reload; the
  ⌘/Ctrl-K command palette opens and navigates.
- **`dashboard-detail-nav.spec.ts`** — list → detail drill-downs (spec tree and
  sessions).
- **`dashboard-data.spec.ts`** — a live cost value renders from same-origin
  `/api` data.
- **`api-failure.spec.ts`** — with a data route forced to 500, the dashboard
  shows a named error state with a working Retry instead of a blank screen, and
  the failure stays contained to that one module (REQ-TVIZ-004.A1/.A2).
- **`empty-project.spec.ts`** — an initialized-but-unindexed project renders
  explicit empty states on Dashboard / Specs / Graph, with zero console errors
  (REQ-TVIZ-004.A1).

### The three fixture servers

Playwright boots one `webServer` per row below (ports and modes in
[`lib/ports.ts`](./lib/ports.ts); `E2E_MODE` scopes each one's work dir in
`lib/paths.mjs`, so they build and serve concurrently without trampling each
other). Move all three at once with `E2E_PORT`.

| Mode | Port | Fixture | Drives |
|---|---|---|---|
| `default` | 4319 | indexed + seeded transcripts | every happy-path spec (`baseURL`) |
| `fault` | 4320 | same, plus `E2E_FAULT=/api/claude/stats` | `api-failure.spec.ts` |
| `empty` | 4321 | `specship init` and nothing else | `empty-project.spec.ts` |

`E2E_FAULT` (REQ-TVIZ-004.A2) is read in `server/src/server.ts`: it takes a
comma-separated list of `/api` path substrings and registers an `onRequest` hook
that answers a matching request with 500. With the variable unset — every
production boot — the hook is never registered, so a new failure case is an env
change, not a code change.

**Console-error policy on failure paths.** The allowlist in `lib/console.ts`
stays empty. A spec that deliberately induces a 500 passes its own narrow
allowlist to `captureConsoleErrors` (the browser's unavoidable "Failed to load
resource" line) and separately asserts that the injected route was the only
failing request — so the exemption can't hide an unrelated error.

## Running locally

```bash
npm run e2e                        # from repo root — builds core+server+SPA,
                                   # installs the browser, runs the suite
```

Or step by step:

```bash
npm run build                     # from repo root — dist/bin + dist/server
cd ui && npm ci && npm run build  # the SPA the harness serves (→ ui/dist)
cd ../e2e
npm ci
npx playwright install chromium
npm test                          # or: npm run test:headed
```

Requirements:

- The repo must be **built** (`npm run build`) and the **SPA built** (`ui/dist`).
- SQLite with **FTS5** — the fixture indexer and the server's on-save re-sync
  need it. Native `better-sqlite3` ships it; on a Node without FTS5 in its
  built-in `node:sqlite`, run `npm rebuild better-sqlite3` at the repo root (or
  use the bundled Node 24). Without it, indexing the fixture fails with
  `no such module: fts5`.

## CI

- **`.github/workflows/e2e.yml`** runs this on pull requests touching the SPA,
  server, CLI, or harness.
- **`.github/workflows/release.yml`** runs it as a **blocking gate** before
  bundling and `npm publish`, so an E2E failure can't ship.
