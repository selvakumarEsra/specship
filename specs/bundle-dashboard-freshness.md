---
id: BUNDLE-DASHBOARD-DOC
title: Bundle ships the current UI and code
owner: "@selvakumar"
priority: high
---

<!-- id: BUNDLE-DASHBOARD-DOC -->
# Bundle ships the current UI and code

The self-contained release bundle (`scripts/build-bundle.sh`) must ship the
**current** SpecShip build — both the compiled library/CLI/server code and the
SpecShip Desktop dashboard — freshly built from source, with no stale artifacts
left over from previous builds.

The dashboard is a SPA in the top-level `ui/` module with its **own**
`package-lock.json`; the repo-root `npm ci` does not install its dependencies.
The bundle build runs `npm run build`, whose `build:server` step
(`scripts/build-server-bundle.mjs`) copies `ui/dist` into `dist/ui`, which the
bundle then serves. Historically that step only COPIED whatever was lying in
`ui/dist` — a direct `scripts/build-bundle.sh <target>` run (offline bundles,
local builds) shipped a stale UI, or none at all, and only the GitHub release
workflow's separate `cd ui && npm ci && npm run build` step saved releases.
The bundle build itself must be self-contained. (Updated 2026-07-12 from the
retired `packages/web-ng` / `build:web` layout — REQ ids preserved.)

<!-- id: REQ-BUNDLE-WEB-001 -->
## The dashboard build MUST be self-contained so every bundle ships the freshly built UI

The `build:server` step MUST build the dashboard itself rather than copying a
pre-existing `ui/dist`: when the UI's build tooling is not installed under
`ui/node_modules`, it MUST install the dashboard dependencies from `ui/`'s own
lockfile first; when the tooling is present, it MUST NOT reinstall. On the
default path the SPA is rebuilt from current `ui/` source so `dist/ui/` always
reflects it; `SPECSHIP_SKIP_WEB_BUILD=1` is the only opt-out. If no
`ui/dist/index.html` exists after the build, the step MUST fail loudly —
a bundle without its dashboard never ships quietly.

The implementation site is `scripts/build-server-bundle.mjs` (the
`build:server` step), so the fix benefits every caller — `npm run build`,
`scripts/build-bundle.sh`, and the release workflow alike.

implementations:
  - scripts/build-server-bundle.mjs

## Acceptance
<!-- id: REQ-BUNDLE-WEB-001.A1 -->
- When `ui/` has no installed dependencies (no build tooling under its `node_modules`), the `build:server` step installs them from the dashboard's lockfile and then builds, instead of shipping without the SPA.
<!-- id: REQ-BUNDLE-WEB-001.A2 -->
- After `scripts/build-bundle.sh <target>` completes on a checkout that started without `ui/node_modules`, the staged bundle contains a freshly built `lib/dist/ui/index.html`.
<!-- id: REQ-BUNDLE-WEB-001.A3 -->
- When the dashboard's build tooling is already installed, the build does not reinstall the dependencies (no redundant `npm ci`/`install`).
<!-- id: REQ-BUNDLE-WEB-001.A4 -->
- On the default path (`SPECSHIP_SKIP_WEB_BUILD` unset), the SPA build runs and `dist/ui/` is rebuilt from the current `ui/` source.
<!-- id: REQ-BUNDLE-WEB-001.A5 -->
- If no `ui/dist/index.html` exists after the build attempt, the step exits non-zero rather than silently shipping a bundle without (or with a stale) dashboard.

<!-- id: REQ-BUNDLE-WEB-002 -->
## The bundle build MUST start from a clean `dist/` so no stale artifacts ship

`npm run build` overwrites compiled outputs but does not remove orphans: when a
source file is renamed or deleted, its previously compiled `.js` lingers in
`dist/` and would ride into the bundle. To guarantee the bundle contains only
the current build, `scripts/build-bundle.sh` MUST remove the previous `dist/`
before compiling — running the existing `npm run clean` immediately before
`npm run build`, so the bundle is assembled from a freshly and wholly rebuilt
`dist/`.

## Acceptance
<!-- id: REQ-BUNDLE-WEB-002.A1 -->
- `scripts/build-bundle.sh` runs `npm run clean` (which removes `dist/`) before it runs `npm run build`.
<!-- id: REQ-BUNDLE-WEB-002.A2 -->
- After a bundle build, `dist/` contains only outputs produced by that build — a `.js` whose source file was deleted before the build is not present in the staged bundle.
