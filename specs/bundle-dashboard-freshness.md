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

The dashboard is an Angular app in `packages/web-ng` with its **own**
`package-lock.json`; the repo-root `npm ci` does not install its dependencies.
The bundle build runs `npm run build`, whose `build:web` step
(`scripts/build-web-bundle.mjs`) invokes the Angular CLI from
`packages/web-ng/node_modules` and copies the output into `dist/web/`, which the
bundle then serves. When those dependencies are absent — a clean checkout, or a
direct `scripts/build-bundle.sh <target>` run — the dashboard build cannot run,
so the bundle ships a stale or missing UI. The GitHub release workflow works
around this with a separate `cd packages/web-ng && npm ci` step, but the bundle
build itself is not self-contained.

<!-- id: REQ-BUNDLE-WEB-001 -->
## The dashboard build MUST be self-contained so every bundle ships the freshly built UI

The dashboard build step MUST ensure the dashboard's own dependencies are
present before building, so a build started without them still produces the
current UI rather than failing or shipping a stale one. When the Angular CLI is
not found in `packages/web-ng`, the build MUST install the dashboard
dependencies (from its own lockfile) and then build; when the CLI is already
present, it MUST NOT reinstall. The dashboard build MUST run on the default path
(it is skipped only when explicitly requested), so `dist/web/` reflects the
current `packages/web-ng` source and rides into the bundle.

The implementation site is `scripts/build-web-bundle.mjs` (the `build:web` step),
so the fix benefits every caller — `npm run build`, `scripts/build-bundle.sh`,
and the release workflow alike.

## Acceptance
<!-- id: REQ-BUNDLE-WEB-001.A1 -->
- When `packages/web-ng` has no installed dependencies (no Angular CLI under its `node_modules`), the `build:web` step installs them from the dashboard's lockfile and then builds, instead of exiting with an error.
<!-- id: REQ-BUNDLE-WEB-001.A2 -->
- After `scripts/build-bundle.sh <target>` completes on a checkout that started without `packages/web-ng/node_modules`, the staged bundle contains a freshly built `dist/web/index.html`.
<!-- id: REQ-BUNDLE-WEB-001.A3 -->
- When the dashboard's Angular CLI is already installed, the build does not reinstall the dependencies (no redundant `npm ci`/`install`).
<!-- id: REQ-BUNDLE-WEB-001.A4 -->
- On the default path (with `SPECSHIP_SKIP_WEB_BUILD` unset and no `--skip-build`), the Angular build runs and `dist/web/` is rebuilt from the current `packages/web-ng` source.
<!-- id: REQ-BUNDLE-WEB-001.A5 -->
- If the Angular CLI is still missing after the install attempt, the build fails loudly (non-zero exit) rather than silently shipping a stale `dist/web/`.

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
