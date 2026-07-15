---
id: OFFLINE-DOC
title: Offline mode (desktop dashboard)
owner: dashboard
priority: medium
---

<!-- id: OFFLINE-DOC -->
# Offline mode (desktop dashboard)

When the SpecShip server is unreachable — the `specship serve` process is
stopped, crashed, or the machine is offline — the desktop dashboard MUST
degrade to a usable read-only state instead of the browser's
"This site can't be reached" error page. The shell loads from a local cache,
the last-known data stays on screen, the connection indicator reads
**● Offline**, and actions that need the server are disabled until it returns.

This document is the contract for that behavior. It does not prescribe the
caching technology (service worker, app cache, etc.) — only the observable
result.

> Owner is assumed `dashboard` — `[needs user confirmation]` (single-maintainer
> repo; set a real owner if there's a preferred one).

<!-- id: REQ-OFFLINE-001 -->
## The UI MUST load when the server is unreachable

Opening or reloading the dashboard at its usual address while the server is
unreachable MUST render the application from a locally-cached copy — the app
shell and its static assets are served without a successful network round-trip
to the server. The user MUST NOT see the browser's native "this site can't be
reached" / connection-error page for a URL they have visited before.

The cache MUST NOT permanently pin the user to a stale build: once the server
is reachable again, a subsequent load MUST be able to pick up the current app
version.

## Acceptance
<!-- id: REQ-OFFLINE-001.A1 -->
- With the server process stopped, loading the last-visited dashboard URL renders the SpecShip UI chrome (sidebar, top bar, status strip) rather than the browser's network-error page.
<!-- id: REQ-OFFLINE-001.A2 -->
- The cached shell renders with no successful (2xx) response from the server during the shell load — i.e. the first paint does not depend on the server being up.
<!-- id: REQ-OFFLINE-001.A3 -->
- After the server is reachable again, a reload serves the current app version within one further reload (the cache self-updates; users are not stuck on an old build indefinitely).
<!-- id: REQ-OFFLINE-001.A4 -->
- A first-ever visit while the server has never been reachable (nothing cached yet) still fails gracefully — the user sees an in-app "can't reach the server" state, not a blank page or a stack trace.

implementations:
  - server/src/static-handler.ts:makeStaticHandler

<!-- id: REQ-OFFLINE-002 -->
## The connection indicator MUST show Offline when the server is unreachable

The UI exposes a single connection-state indicator with exactly two states:
**● Live** when the server is reachable and serving data, and **● Offline**
when it is not. The former "mock / no-API-configured" state folds into
**● Offline** — there are no longer three states. The indicator MUST update
when reachability changes without requiring a manual page reload.

## Acceptance
<!-- id: REQ-OFFLINE-002.A1 -->
- When the server is unreachable, the connection indicator reads "Offline" (its label and dot/color reflect the offline state).
<!-- id: REQ-OFFLINE-002.A2 -->
- When the server is reachable and returning data, the indicator reads "Live".
<!-- id: REQ-OFFLINE-002.A3 -->
- A reachable → unreachable transition (and the reverse) is reflected in the indicator within 10 seconds, with no manual page reload.
<!-- id: REQ-OFFLINE-002.A4 -->
- Any live-stream status shown on a detail view (e.g. the session / run event stream) reads "Offline" when the server is unreachable, rather than remaining on "Live".

implementations:
  - ui/src/api.ts:api
  - ui/src/pages/dashboard.tsx:DashboardPage

<!-- id: REQ-OFFLINE-003 -->
## Last-known data MUST stay visible offline and be marked stale

Data that has been fetched successfully at least once MUST remain visible when
the server becomes unreachable, served from a cache that survives a full page
reload. Each surface showing cached data MUST indicate how old it is, so
offline data is not mistaken for live. Offline data is read-only — see
REQ-OFFLINE-004 for actions.

## Acceptance
<!-- id: REQ-OFFLINE-003.A1 -->
- When the server becomes unreachable, a surface that had already loaded data continues to display that data instead of switching to an error banner or empty state.
<!-- id: REQ-OFFLINE-003.A2 -->
- After a full page reload while the server is unreachable, surfaces that were previously loaded still show their last-known data (the cache persists beyond the browser session, not just in memory).
<!-- id: REQ-OFFLINE-003.A3 -->
- A surface showing cached data displays a relative-age label (e.g. "updated 4m ago") whenever the indicator is Offline.
<!-- id: REQ-OFFLINE-003.A4 -->
- When the server returns, each surface refetches and replaces the cached data with live data, and the staleness label clears.
<!-- id: REQ-OFFLINE-003.A5 -->
- A surface that has never been loaded while online shows an explicit "no cached data — connect to load" empty state offline, not a spinner that never resolves.

implementations:
  - ui/src/api.ts:runEventsUrl
  - ui/src/api.ts:api

<!-- id: REQ-OFFLINE-004 -->
## Server-dependent actions MUST be disabled with an offline notice

Controls that require a live server round-trip — the global Refresh, spec
edits/saves, and workflow runs — MUST be disabled while the indicator is
Offline and MUST communicate that the action needs a connection. Attempting a
server-dependent action while offline MUST NOT surface an unhandled error or
silently lose the user's input.

## Acceptance
<!-- id: REQ-OFFLINE-004.A1 -->
- While offline, the global Refresh control is disabled (or no-ops) and shows an offline affordance instead of spinning indefinitely or throwing.
<!-- id: REQ-OFFLINE-004.A2 -->
- While offline, a server-dependent edit/save (e.g. saving a spec) is prevented with an "offline — reconnect to do this" message; no unhandled exception is raised and no entered content is lost.
<!-- id: REQ-OFFLINE-004.A3 -->
- When the server returns, the previously-disabled controls re-enable automatically (no manual reload required).

implementations:
  - ui/src/hooks.ts:useApi
  - ui/src/api.ts:api

<!-- id: REQ-OFFLINE-005 -->
## A missing static asset MUST NOT be answered with the app shell

A GET for a path whose final segment ends in a recognized static-asset
extension (`.js`, `.css`, `.woff2`, `.png`, …) but which does not exist under
the web root MUST be answered with 404 — never with the SPA shell. Serving the
shell (HTML) at an asset URL corrupts every cache between the server and the
page — the browser's HTTP cache and the offline cache both store HTML under
the asset's URL — and surfaces as a module-MIME error that persists until the
user manually clears site data. (Observed 2026-07-03: a tab holding a stale
build requested its old content-hashed bundle during a server restart window;
the shell fallback answered it and the offline cache stored HTML under the
bundle URL.)

Extension-less paths (client routes like `/memory`) MUST keep falling back to
the shell so deep links keep working — including route params that contain
dots without being asset paths (e.g. `/specs/REQ-OFFLINE-001.A1`).

## Acceptance
<!-- id: REQ-OFFLINE-005.A1 -->
- GET of a non-existent content-hashed bundle (e.g. `/main-STALEHASH.js`) returns 404 and the response body is not the app shell.
<!-- id: REQ-OFFLINE-005.A2 -->
- GET of an extension-less client route (e.g. `/memory`) still returns 200 with the app shell.
<!-- id: REQ-OFFLINE-005.A3 -->
- GET of a route param whose dot-suffix is not an asset extension (e.g. `/specs/REQ-OFFLINE-001.A1`) still returns 200 with the app shell.
<!-- id: REQ-OFFLINE-005.A4 -->
- GET of an existing asset still returns 200 with its correct content type, and `/api/*` misses and non-GET methods still return a JSON 404 (behavior for those is unchanged).

implementations:
  - server/src/static-handler.ts:isAssetPath
  - server/src/server.ts:createServer

<!-- id: REQ-OFFLINE-006 -->
## The offline cache MUST NOT store a response that contradicts its request

> **SUPERSEDED (2026-07-15, maintainer):** the service worker
> (`packages/web-ng/public/sw.js`) was not carried over to the React desktop
> SPA — no offline cache exists in the current UI, so there is nothing this
> requirement governs. Retained for history; carries no implementation links.

The offline cache MUST refuse to store a response whose declared content type
contradicts what the request asked for — concretely, an HTML-typed response
MUST never be stored for a non-navigation request (a script, stylesheet, font,
or image URL). The mismatched response still passes through to the page, so
the browser surfaces the real failure; it just never enters the cache, and
later offline loads can never replay poisoned content. A new cache generation
MUST discard the previous generation's entries on activation, so caches
poisoned before this rule existed are dropped on upgrade.

## Acceptance
<!-- id: REQ-OFFLINE-006.A1 -->
- When the network answers a script request with an HTML-typed response, no entry for that URL is written to the offline cache.
<!-- id: REQ-OFFLINE-006.A2 -->
- Correctly-typed responses are cached and served offline exactly as REQ-OFFLINE-001 requires: navigations cache the shell, and assets cache their bodies.
<!-- id: REQ-OFFLINE-006.A3 -->
- After upgrading to a build with a new cache generation, entries from the previous generation are no longer served — a cache poisoned before the upgrade cannot poison the app after it.

