---
id: CHAT-REMOVE-DOC
title: Remove the dashboard chat surface
owner: specship
priority: medium
---

<!-- id: CHAT-REMOVE-DOC -->
# Remove the dashboard chat surface

Decision (2026-07-11 product review, Q9): the chat page is cut. Even in its
no-LLM deterministic form (DASH-CHAT-DOC — which this document supersedes),
it duplicates jobs other surfaces already do (graph/specs/search for
structural questions; Claude Code itself for conversation) while adding a
whole interaction surface to maintain. The reviewer-facing loop that might
have justified a conversational surface lands on Workflows + Runs instead
(WF-REJECT-DOC's reject-with-comment → revise → re-gate).

<!-- id: REQ-CHATRM-001 -->
## The chat page MUST be removed from the dashboard

Navigation entry, route, and page component are removed. No dead nav item,
no orphaned route.

implementations:
  - ui/src/App.tsx:App

## Acceptance
<!-- id: REQ-CHATRM-001.A1 -->
- The dashboard renders no Chat nav item and `/chat` resolves to the
  not-found treatment.

<!-- id: REQ-CHATRM-002 -->
## The chat API surface MUST be removed with it

`POST /api/chat`, `GET /api/chat/stream`, and the chat answer engine behind
them are deleted (routes, `server/src/chat/`, `chat-answer.ts`), along with
the client bindings. Verified before deletion: no other route imported from
`server/src/chat/` or `chat-answer.ts`. The removal is held in place by a
source-scan guard test.

implementations:
  - __tests__/chat-removal.test.ts

## Acceptance
<!-- id: REQ-CHATRM-002.A1 -->
- `POST /api/chat` and `GET /api/chat/stream` return 404.
<!-- id: REQ-CHATRM-002.A2 -->
- The server builds and all non-chat routes pass their tests after removal.

<!-- id: REQ-CHATRM-003 -->
## Reviewer gate actions MUST live on the run page

The non-coding reviewer's loop — read the gate message and artifacts,
approve with comment, or reject with comment and follow the revision —
is complete on the Workflows + Runs surface, so removing chat removes no
reviewer capability.

implementations:
  - ui/src/components/run-detail.tsx:RunDetail

## Acceptance
<!-- id: REQ-CHATRM-003.A1 -->
- A paused run's page offers approve-with-comment and reject-with-comment,
  and shows the revision re-pausing at the gate (per WF-REJECT-DOC).
