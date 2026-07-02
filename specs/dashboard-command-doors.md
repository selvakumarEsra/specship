---
id: DASH-DOORS-DOC
title: Dashboard command-doors surface
owner: web
priority: medium
version: 1
---

<!-- id: DASH-DOORS-DOC -->
# Dashboard command-doors surface

SpecShip's agent-facing command surface consolidated into three **doors** — the
Intent door (`/specship:spec`), the Reads door (`/specship:explore`), and the Gate & health
door (`/specship:check`) — each routing the whole family of flows the old per-command
slash commands used to. The dashboard predates this: it still tells users to run
retired individual commands, and nothing on it communicates that the doors exist.
This document makes the doors clear in the dashboard.

<!-- id: REQ-DASH-DOORS-001 -->
## The dashboard home MUST present the three command doors

A "Command doors" surface on the Dashboard home screen shows the three doors —
Intent (`/specship:spec`), Reads (`/specship:explore`), and Gate & health (`/specship:check`) —
each with its slash command, a one-line purpose, and the sub-routes it dispatches.
Each door links to the most-related dashboard page so the surface is also a
navigation affordance, not just documentation.

implementations:
  - packages/web-ng/src/app/pages/dashboard/dashboard.ts:Dashboard
  - packages/web-ng/src/app/pages/dashboard/dashboard.html

## Acceptance
<!-- id: REQ-DASH-DOORS-001.A1 -->
- The Dashboard home renders exactly three door tiles labelled Intent, Reads, and Gate & health, each showing its slash command (`/specship:spec`, `/specship:explore`, `/specship:check`).
<!-- id: REQ-DASH-DOORS-001.A2 -->
- Each door tile lists the sub-routes it dispatches (e.g. Intent shows new · implement · review · triage · domain).
<!-- id: REQ-DASH-DOORS-001.A3 -->
- Activating a door tile navigates to its related dashboard page (Intent → specs, Reads → graph, Gate & health → drift) and is reachable by both pointer and keyboard.

<!-- id: REQ-DASH-DOORS-002 -->
## The dashboard MUST NOT instruct users to run retired pre-door commands

Everywhere the dashboard tells a user (or their agent) to run a slash command, it
MUST name a current door command, not a command the door consolidation retired.
The retired forms — `/ss-spec-author`, `/ss-domain`, `/cg-implement` — are
replaced by their door equivalents (`/specship:spec new`, `/specship:spec domain`,
`/specship:spec`).

implementations:
  - packages/web-ng/src/app/components/draft-with-claude-modal/draft-with-claude-modal.ts
  - packages/web-ng/src/app/pages/domain/domain.html
  - packages/web-ng/src/app/pages/chat/chat.ts

## Acceptance
<!-- id: REQ-DASH-DOORS-002.A1 -->
- No dashboard source emits `/ss-spec-author`, `/ss-domain`, or `/cg-implement` as a command for a user to run.
<!-- id: REQ-DASH-DOORS-002.A2 -->
- The draft-with-Claude action emits the Intent-door form (`/specship:spec new "…"`) instead of `/ss-spec-author`.
<!-- id: REQ-DASH-DOORS-002.A3 -->
- The Domain page's capture and refine prompts reference the Intent door's domain route (`/specship:spec domain`) instead of `/ss-domain`.
