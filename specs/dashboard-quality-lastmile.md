---
id: DASHLM-DOC
title: Dashboard quality last-mile — surface the shipped engines
owner: specship
priority: medium
version: 1
jira_issue_REQ-DASHLM-001: SSHIP-1843
jira_fingerprint_REQ-DASHLM-001: 7088e4821483c603
jira_issue_REQ-DASHLM-002: SSHIP-1846
jira_fingerprint_REQ-DASHLM-002: 067d0831c768aceb
jira_issue_REQ-DASHLM-003: SSHIP-1849
jira_fingerprint_REQ-DASHLM-003: ef7875a5d11dd6d1
jira_issue_REQ-DASHLM-004: SSHIP-1853
jira_fingerprint_REQ-DASHLM-004: c5532a18b3e80106
---

<!-- id: DASHLM-DOC -->
# Dashboard quality last-mile — surface the shipped engines

Three quality engines are fully shipped through their API layer but have no
dashboard consumer: maintainability (`GET /api/maintainability`), domain
knowledge (`GET /api/domain`), and reflection proposals (`GET /api/reflect`
plus per-proposal `preview` / `apply` / `undo` / `dismiss`). Meanwhile
`commands/specship/learn.md` points users at an "Improvements page" that does
not exist. This document contracts the last mile: three dashboard pages that
consume the existing endpoints, and agreement between the learn command's
wording and the shipped surface.

Constraints inherited from the codebase: server routes never bare-import the
published package (DOM-SPECSHIP-004 — the routes already comply; this work
adds no server code unless an endpoint gap is found), and pages follow the
existing `ui/src/pages/*.tsx` conventions (design-bundle chrome, `api.ts`
client types, `router.ts` navigation, one concern per page).

<!-- id: REQ-DASHLM-001 -->
## The dashboard MUST render a Health page from the maintainability API

A `health` page renders `GET /api/maintainability`: the overall tier, the
per-check results (including `highPrecisionClean`), and the offending
symbols/files each check reports, so a solo dev can see code-health state
without running the CLI. The page appears in the navigation. An API error or
uninitialized project renders an explicit empty state, never a blank page.

implementations:
  - ui/src/pages/health.tsx
  - ui/src/api.ts
  - ui/src/App.tsx

## Acceptance
<!-- id: REQ-DASHLM-001.A1 -->
- With an initialized project, the Health page shows the maintainability
  tier and every check with its pass/fail state and offender list.
<!-- id: REQ-DASHLM-001.A2 -->
- When the API errors or returns no data, the page shows an explicit empty
  state naming the CLI fallback (`specship maintainability`).

<!-- id: REQ-DASHLM-002 -->
## The dashboard MUST render a Domain page from the domain API

A `domain` page renders `GET /api/domain`: confirmed domain facts (id, type,
title, body, linked specs with inherited drift state) and detected
documentation gaps, closing with the capture hand-off (`/specship:spec
domain`). Facts whose inherited links are drifted or broken are visibly
flagged. An empty knowledge base renders an explicit empty state pointing at
the capture flow.

implementations:
  - ui/src/pages/domain.tsx
  - ui/src/api.ts
  - ui/src/App.tsx

## Acceptance
<!-- id: REQ-DASHLM-002.A1 -->
- Confirmed facts render with type, body, and linked-spec drift state;
  drifted/broken inheritance is visually flagged.
<!-- id: REQ-DASHLM-002.A2 -->
- Detected gaps render as a distinct list, and both the gap list and the
  empty state name `/specship:spec domain` as the capture path.

<!-- id: REQ-DASHLM-003 -->
## The dashboard MUST render an Improvements page with preview-diff → apply

An `improvements` page lists reflection proposals from `GET /api/reflect`
grouped by state, and drives the full lifecycle the API already exposes:
preview (`GET /api/reflect/:hash/preview`) rendered as a diff BEFORE any
write, then apply / dismiss, and undo after an apply. Apply is per-proposal
and requires an explicit click on the previewed diff — no bulk apply, no
write without a rendered preview. A failed apply surfaces the server's error
verbatim rather than flipping the proposal's state.

implementations:
  - ui/src/pages/improvements.tsx
  - ui/src/api.ts
  - ui/src/App.tsx

## Acceptance
<!-- id: REQ-DASHLM-003.A1 -->
- A proposal can be previewed as a diff and applied only from that preview;
  the applied state then offers undo.
<!-- id: REQ-DASHLM-003.A2 -->
- Dismiss removes the proposal from the pending list without writing to any
  target file.
<!-- id: REQ-DASHLM-003.A3 -->
- When apply fails, the proposal remains pending and the server error is
  shown; no partial state change is displayed.

<!-- id: REQ-DASHLM-004 -->
## The learn command's wording MUST agree with the shipped surface

`commands/specship/learn.md` references the dashboard page users act on.
Once REQ-DASHLM-003 ships, its "Improvements page" wording becomes true and
MUST name the page's actual route/label; until then the command MUST NOT
reference a page that does not exist. Whichever ships first, command wording
and dashboard surface agree at every release.

implementations:
  - commands/specship/learn.md

## Acceptance
<!-- id: REQ-DASHLM-004.A1 -->
- `commands/specship/learn.md` names only navigation destinations that exist
  in the shipped dashboard at the same commit.
