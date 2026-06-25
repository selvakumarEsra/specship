---
id: PWA-DOC
title: Installable PWA dashboard with desktop notifications
owner: dashboard
priority: medium
brief: dashboard-pwa-notifications/brief.md
---

<!-- id: PWA-DOC -->
# Installable PWA dashboard with desktop notifications

The SpecShip dashboard (`specship serve --ui`) is a local web app on
`127.0.0.1`. To let developers monitor and review their Claude Code work as if
it were a desktop app — without a native shell (Tauri/Electron) and its
build/sign/notarize/auto-update surface — this makes the dashboard an
**installable PWA** that fires **desktop notifications while it is open or
backgrounded**. Loopback is a secure context, so install, the Service Worker,
and the Notifications API all work without HTTPS.

Notifications when the app is **fully closed** are out of scope (that alone
would force a native shell — deferred to a possible future Tauri escalation).
This is additive: the web `serve --ui` mode is unchanged.

<!-- id: REQ-PWA-001 -->
## The dashboard MUST be installable as a standalone app

The dashboard MUST be installable via a web app manifest so it launches in its
own standalone window — its own icon, no browser address bar — under the name
**SpecShip**. The app MUST present an in-app install affordance when the browser
reports it is installable, and hide it once installed. Installing MUST NOT
regress offline behavior: the standalone app still loads its cached shell when
the server is unreachable (per OFFLINE-DOC).

## Acceptance
<!-- id: REQ-PWA-001.A1 -->
- A valid web app manifest is served with `display: standalone`, the name "SpecShip", and icons including 192px and 512px (at least one maskable); a supporting browser offers to install the app.
<!-- id: REQ-PWA-001.A2 -->
- Launching the installed app opens the dashboard in a standalone window with its own icon and no browser address bar.
<!-- id: REQ-PWA-001.A3 -->
- The in-app install affordance is shown only while the browser reports the app installable, and is hidden once it is installed.
<!-- id: REQ-PWA-001.A4 -->
- The installed/standalone app still loads its cached shell when the server is unreachable — no regression to OFFLINE-DOC behavior.

<!-- id: REQ-PWA-002 -->
## The dashboard MUST raise desktop notifications for alert-worthy events across all tracked projects

While the dashboard is open or backgrounded and notifications are enabled, it
MUST raise a desktop notification for alert-worthy events in **any** project the
dashboard tracks — not only the currently-selected project. The alert-worthy
events are: a run **pausing for approval**, a run **completing or failing**, and
newly-detected **spec→code drift**. Activating a notification MUST focus the app
and navigate to the relevant run or drift. The same event MUST NOT raise more
than one notification, and routine high-volume activity MUST NOT notify.

[needs review] Source coverage: the existing `workflow_events` SSE is scoped to
the active project's database, and drift has no live stream today. Delivering
"all tracked projects" + drift will likely require new server plumbing — a
cross-project event stream and/or a drift signal (or a periodic drift poll) —
rather than consuming the single existing SSE. Resolve the source during
implementation; if drift cannot be sourced cleanly in this iteration, split it
into a follow-up rather than dropping the dedupe/scope guarantees for runs.

## Acceptance
<!-- id: REQ-PWA-002.A1 -->
- With notifications enabled, a run pausing for approval raises an OS notification while the app is open or backgrounded.
<!-- id: REQ-PWA-002.A2 -->
- A run completing or failing raises an OS notification (when that alert type is enabled).
<!-- id: REQ-PWA-002.A3 -->
- Newly-detected spec→code drift raises an OS notification (when that alert type is enabled).
<!-- id: REQ-PWA-002.A4 -->
- An alert-worthy event in a project that is NOT the currently-selected one still raises a notification.
<!-- id: REQ-PWA-002.A5 -->
- Activating a notification focuses the app and navigates to the run or drift it refers to.
<!-- id: REQ-PWA-002.A6 -->
- A single event raises exactly one notification, even if the underlying event is observed or redelivered more than once (de-duped by project + event identity).
<!-- id: REQ-PWA-002.A7 -->
- Routine high-volume activity that is not one of the defined alert-worthy events raises no notification.

<!-- id: REQ-PWA-003 -->
## Desktop notifications MUST be user-enabled and per-type controllable

Notifications MUST be off until the user explicitly enables them: the app MUST
request OS notification permission only in response to an explicit user action,
never automatically on load. Settings MUST offer a per-alert-type toggle
(approval, completed/failed, drift) whose state persists across reloads. When
permission is denied or the Notifications API is unsupported, the app MUST
continue to function normally, raise no notifications, and reflect the
denied/unsupported state in Settings.

## Acceptance
<!-- id: REQ-PWA-003.A1 -->
- No permission prompt appears on load; it appears only after the user activates an explicit "enable notifications" control.
<!-- id: REQ-PWA-003.A2 -->
- Settings exposes a per-alert-type toggle (approval, completed/failed, drift); each enables/disables its notifications and the choices persist across reloads.
<!-- id: REQ-PWA-003.A3 -->
- With permission denied, no notifications fire, the dashboard works normally, and Settings shows the denied state.
<!-- id: REQ-PWA-003.A4 -->
- In a browser without the Notifications API, the dashboard works normally and the control shows the feature unsupported.
