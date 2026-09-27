---
id: SURF-DOC
title: Review remediation — surface removal & cleanup lane
owner: specship-core
priority: high
version: 1
---

<!-- id: SURF-DOC -->
# Review remediation — surface removal & cleanup lane

Remove features that are dead, unreachable, or violate
promise-only-what-you-can-prove; align specs that currently claim
unimplemented surfaces as real. Ratified keeps (dashboard, designer, JIRA,
Gemini target, statusline, taskship, desktop) are out of scope.

<!-- id: REQ-SURF-001 -->
## The dead `GET /api/events` SSE route MUST be removed

Its promised client (`NotificationsService`) was never built; it has zero
consumers and polls up to 10 projects every 3 seconds, forcing the registry's
`maxOpen` inflation.

implementations:
  - server/src/project-registry.ts:ProjectRegistry.maxOpen
  - server/src/server.ts:createServer

## Acceptance
<!-- id: REQ-SURF-001.A1 -->
- The events route and its polling loop are removed; the server boots and all remaining routes function.
<!-- id: REQ-SURF-001.A2 -->
- The registry `maxOpen` inflation that existed only for the events poller is reverted or re-justified in a comment.
<!-- id: REQ-SURF-001.A3 -->
- `specs/dashboard-pwa-notifications.md` is marked SUPERSEDED so it no longer reads as a live contract.

<!-- id: REQ-SURF-002 -->
## The reflection sweep's dead wiring MUST be resolved honestly

`reflectSweep`'s only caller is the removed events route; `learn.md` points
users at an Improvements page that does not exist.

implementations:
  - src/index.ts:SpecShip.reflectSweep

verifies:
  - __tests__/command-doc-truth.test.ts:learnNamesNoImprovementsPage
  - __tests__/command-doc-truth.test.ts:learnNamesTheCliReviewPath

## Acceptance
<!-- id: REQ-SURF-002.A1 -->
- `reflectSweep` either gains a real caller (deferred to the DASHLM Improvements page) or is left callable-but-uncalled with its sweep REQ (REQ-REFLECT-006) marked deferred/superseded — no spec claims a daily sweep runs.
<!-- id: REQ-SURF-002.A2 -->
- `commands/specship/learn.md` no longer instructs users to visit a page that does not exist (wording points at the CLI/MCP path until DASHLM lands).

<!-- id: REQ-SURF-003 -->
## Phantom offline mode MUST be retired from specs and comments

implementations:
  - server/src/static-handler.ts:makeStaticHandler
  - server/src/server.ts:createServer

## Acceptance
<!-- id: REQ-SURF-003.A1 -->
- REQ-OFFLINE-001..004 are marked SUPERSEDED in `specs/offline-mode.md` (005 static-handler behavior stays live).
<!-- id: REQ-SURF-003.A2 -->
- Comments in `server/src/static-handler.ts` and `server/src/server.ts` asserting an "offline service worker's cache" are corrected — no comment protects infrastructure that does not exist.

<!-- id: REQ-SURF-004 -->
## Dead settings knobs MUST be removed

implementations:
  - ui/src/pages/settings.tsx:SettingsPage
  - ui/src/prefs.ts:getDensity

## Acceptance
<!-- id: REQ-SURF-004.A1 -->
- The boot-animation and editor-picker controls and their prefs helpers are removed (Density stays — it is real).
<!-- id: REQ-SURF-004.A2 -->
- No remaining hint text references a nonexistent open-in-editor feature.

<!-- id: REQ-SURF-005 -->
## The unused specship-impact engine MUST be removed

The endpoint's client method is never called, the rendered field is never
rendered, and its hardcoded tool-definition constant is ~2.5× stale — only
not-being-displayed prevents a benchmark-claim violation.

implementations:
  - server/src/routes/claude.ts:registerClaudeRoutes
  - server/src/server.ts:createServer

## Acceptance
<!-- id: REQ-SURF-005.A1 -->
- The `/api/claude/specship-impact` route, boot-time backfill, and the impact-query ingest module are removed; the unused client method and typed-but-unrendered session-summary field go with them.
<!-- id: REQ-SURF-005.A2 -->
- Server boots and the dashboard's remaining pages function; no dangling imports.

<!-- id: REQ-SURF-006 -->
## Debug introspection SHOULD be one tool: fold `specship_version` into `specship_status`

The lite-tier trim currently keeps `version` and drops `status` — backwards.

implementations:
  - src/mcp/tools.ts:ToolHandler.handleStatus
  - src/mcp/tools.ts:applyLiteTierTrim

## Acceptance
<!-- id: REQ-SURF-006.A1 -->
- `specship_status` output includes the version/build info `specship_version` reported; `specship_version` is removed from the tool menu.
<!-- id: REQ-SURF-006.A2 -->
- The lite-tier trim retains `specship_status`.
<!-- id: REQ-SURF-006.A3 -->
- `src/mcp/server-instructions.ts` reflects the merged tool.

<!-- id: REQ-SURF-007 -->
## Code-health SHOULD be one tool: merge `specship_maintainability` and `specship_fitness`

implementations:
  - src/mcp/health-tool.ts:handleSpecshipHealth
  - src/mcp/health-tool.ts:resolveHealthChecks
  - src/installer/targets/shared.ts:getSpecShipPermissions

## Acceptance
<!-- id: REQ-SURF-007.A1 -->
- A single `specship_health` tool (with a `checks` filter) returns what the two tools returned; the two old tools are removed from the menu.
<!-- id: REQ-SURF-007.A2 -->
- `server-instructions.ts` and the enforce/check paths reference the merged tool; existing config keys keep working.

<!-- id: REQ-SURF-008 -->
## Stranded spec contracts MUST be marked superseded

## Acceptance
<!-- id: REQ-SURF-008.A1 -->
- `specs/ideas-lane.md` REQ-IDEAS-004/005 (tracker import/push) are marked SUPERSEDED.
<!-- id: REQ-SURF-008.A2 -->
- REQ-DOMAIN-006/008 and REQ-DASHUX-004/005 are marked SUPERSEDED with a pointer to DASHLM-DOC where re-contracted.

<!-- id: REQ-SURF-009 -->
## Lying comments and mislabeled UI affordances MUST be corrected

implementations:
  - src/installer/index.ts:runInstallerWithOptions
  - ui/src/pages/mcp.tsx:exampleText

## Acceptance
<!-- id: REQ-SURF-009.A1 -->
- Installer comments describing the retired v1 retrieval-only default are updated to match the shipped governance-default-ON behavior.
<!-- id: REQ-SURF-009.A2 -->
- Synthesized MCP example calls are visually distinguishable from genuine latest-call examples on the MCP page.
<!-- id: REQ-SURF-009.A3 -->
- The `specship reflect` CLI surface matches what `specs/learning-loop.md` names (flag vs subcommand aligned, either side).
