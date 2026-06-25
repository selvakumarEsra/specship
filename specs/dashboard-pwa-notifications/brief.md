---
slug: dashboard-pwa-notifications
spec: PWA-DOC   # specs/dashboard-pwa-notifications.md (REQ-PWA-001..003)
created: 2026-06-25
---

# Brainstorm: Installable PWA dashboard with while-open desktop notifications

## Problem

Developers want to **monitor and review** their Claude Code work in SpecShip
without missing the moments that need them — a run pausing for approval, a run
finishing/failing. Today `specship serve --ui` is a **local web app** (Fastify
on `127.0.0.1:4242` serving the Angular SPA in the browser); it's branded
"SpecShip Desktop" but there is no native shell. A browser tab gives no
standalone window and no OS-level popups, so monitoring events are easy to miss.

We want the dashboard to feel like an installed app and to **fire desktop
notifications while it is open or backgrounded** — without taking on a native
desktop shell (Tauri/Electron) and its per-platform build/sign/notarize/
auto-update surface, which would contradict the fork's "smaller surface"
identity and burden an already-fragile release pipeline.

Notifications when the app is **fully closed** are explicitly **not** required
for now (that's the only thing that would force a native shell — deferred).

## Code grounding

- **`specship serve --ui`** → `packages/server/src/cli.ts` (internal binary
  `specship-desktop`) starts the Fastify server on `127.0.0.1:4242`
  (loopback); `src/bin/specship.ts` locates the built Angular UI. Secure
  context, so manifest install + Service Worker + Notifications API all work.
- **Service worker already exists:** `packages/web-ng/public/sw.js`, registered
  in `packages/web-ng/src/main.ts` (`navigator.serviceWorker.register('sw.js')`)
  — caches the offline app shell (OFFLINE-DOC, `REQ-OFFLINE-001`). Data is
  cached in `localStorage` (`packages/web-ng/src/app/api/api.ts`,
  `api/resource.ts`). **No web app manifest exists yet** (none under
  `packages/web-ng/public`).
- **Live event stream for alerts exists:** `packages/server/src/routes/workflow`
  exposes an **SSE stream of `workflow_events`** as they're appended — where a
  run pausing for approval and completing/failing surface. Also
  `packages/server/src/routes/projects.ts` (`GET /api/projects/events`). No new
  backend stream is needed.
- **Client services to mirror/extend:** `packages/web-ng/src/app/api/connection.ts`
  (ConnectionService — online/offline + SSE handling patterns), `api/api.ts`,
  `api/resource.ts`. A new notification service follows the same `inject()`/
  signals conventions; Settings page hosts the per-type toggles.
- Ships inside the existing npm package — no native distribution artifacts.

## Approaches considered

1. **Installable PWA + while-open Web Notifications.** Add a manifest, lean on
   the existing `sw.js`, wire the Notifications API to the workflow-events SSE.
2. **Tauri native shell.** Real tray/background presence + notifications even
   fully closed; reuses the bundled-Node `serve` binary as a sidecar (~10–20MB)
   — but adds Rust + per-platform sign/notarize/auto-update release matrix.
3. **Electron native shell.** Most batteries-included, ~120–150MB, heaviest
   maintenance; worst fit for a "smaller surface" fork.
**Chosen: 1 (PWA).** The only requirement that forced a native shell —
notifications when the app is fully closed — is explicitly out of scope for
now. A PWA delivers the real need (standalone installed window + OS popups while
open/backgrounded) by reusing the offline service worker, with near-zero new
distribution surface and no strain on the release pipeline. Tauri remains a
clean future escalation if fully-closed/background alerts are later required.

## Key decisions

- **Installable PWA:** add a web app manifest (standalone display mode, name
  "SpecShip", theme + background colors, `start_url` at the dashboard, 192px and
  512px icons incl. a maskable one); ensure the existing `sw.js` satisfies
  installability (a navigation fallback so the shell loads offline). Provide an
  in-app **Install** affordance via `beforeinstallprompt`, hidden once installed.
- **While-open notifications:** a client notification service that
  - requests `Notification` permission only on an explicit user action (e.g. an
    "Enable notifications" control in Settings / on first install), never
    unprompted on load;
  - subscribes to the existing **workflow-events SSE** and raises an OS
    notification on the alert-worthy transitions — **run paused / needs
    approval** and **run completed / failed** (the anchor cases);
  - clicking a notification focuses the app and deep-links to the relevant run;
  - exposes **per-type toggles** in Settings; persists the user's choices.
- **Scope of "live":** notifications fire while the PWA window is open OR
  backgrounded/minimized. Fully-closed / background-push is out of scope.
- **Coexistence:** the web `serve --ui` mode is unchanged; the PWA is the same
  app made installable. No native shell, no push server.

## Edge cases & non-goals

Edge cases:
- **Permission denied or unsupported** → the notification service no-ops
  silently; the dashboard works normally, and the Settings control reflects the
  denied/unsupported state rather than erroring.
- **Not installed / plain browser tab** → notifications still work while the tab
  is open if permission is granted; the Install affordance is shown only when
  the browser reports installability.
- **Offline** → install + cached shell still load (OFFLINE-DOC); the SSE simply
  reconnects when the server returns, consistent with existing offline behavior.
- **Duplicate/echo events** → the same workflow transition must not fire
  repeated notifications (de-dupe by run + transition).
- **Notification flooding** → high-volume event streams must not produce a popup
  per event; only the defined alert-worthy transitions notify.

Non-goals:
- No Tauri/Electron/native shell; no app signing/notarization/auto-update.
- No notifications when the app is fully closed (no push service / background
  push).
- No change to the loopback-only security posture (still `127.0.0.1`).
- No rewrite of the Angular UI or the server; this is additive.

## Acceptance criteria

- With the dashboard open in a supporting browser, an **Install** affordance
  appears, and installing it launches the dashboard as a **standalone window**
  (own icon, no browser chrome) from a valid web app manifest.
- After the user enables notifications (explicit action) and grants permission,
  a workflow run **pausing for approval** raises an OS notification while the app
  is open or backgrounded; clicking it focuses the app on that run.
- A workflow run **completing or failing** likewise raises a notification when
  its per-type toggle is enabled.
- Per-type notification toggles in Settings turn each alert class on/off and
  persist across reloads; a disabled type produces no notification.
- When notification permission is denied or the API is unsupported, the app
  functions normally and raises no errors; the Settings control shows the state.
- The same run transition never fires more than one notification (de-duped).
- The installed PWA still loads its cached shell offline (no regression to
  OFFLINE-DOC behavior), and notifications resume when the server reconnects.
