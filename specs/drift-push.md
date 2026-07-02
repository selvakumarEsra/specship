---
id: DRIFT-PUSH-DOC
title: Drift is pushed to the user, not pulled
owner: core
priority: medium
version: 1
---

<!-- id: DRIFT-PUSH-DOC -->
# Drift push

SpecShip's hooks push users into *creating* intent (the `spec-nudge`
UserPromptSubmit hook), but drift — the thing the whole spec→test→verify chain
protects against — is pull-only: nobody sees the drift queue unless they think
to run the gate door. Drift discovered weeks later is archaeology; drift
surfaced at edit time is a five-second `link_assert`.

This document pushes drift at two moments, both cheap and noise-bounded:
at edit time on a link **state transition** (never on every edit to linked
code), and once per session start when the queue is non-empty. Explicitly out
of scope: prompt-level nagging (UserPromptSubmit already carries one hook) and
blocking hooks (drifting during active work is the normal rhythm — drift, then
re-assert).

<!-- id: REQ-DRIFT-PUSH-001 -->
## An edit that drifts a link MUST surface a one-line notice in the session

When the post-edit sync flips a spec link into the `drifted` state, one line is
emitted into the session naming the spec, the transition, the changed symbol,
and the remedy — so the agent can re-assert in the same task, at the cheapest
possible moment.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.markSpecDrifted
  - src/index.ts:SpecShip.sync

## Acceptance
<!-- id: REQ-DRIFT-PUSH-001.A1 -->
- When the PostToolUse sync transitions a link to `drifted`, a single line is
  emitted into the session naming the spec id, the prior state, the changed
  symbol, and the remedy (re-assert the link, or the gate door's fix flow).
<!-- id: REQ-DRIFT-PUSH-001.A2 -->
- Only state transitions emit — a subsequent edit to code whose link is
  already `drifted` emits nothing.
<!-- id: REQ-DRIFT-PUSH-001.A3 -->
- A sync that causes no transition emits nothing, and the hook remains
  non-blocking — it never interrupts or gates the edit.

<!-- id: REQ-DRIFT-PUSH-002 -->
## Session start MUST summarize the drift queue when it is non-empty

The SessionStart sync additionally reports the drifted-link count with a
pointer to the gate door's review queue — one line, once per session, zero
output when clean.

implementations:
  - src/installer/targets/claude.ts:writeHooksEntry
  - src/installer/targets/claude.ts:cleanupStaleSessionStartSyncHook

## Acceptance
<!-- id: REQ-DRIFT-PUSH-002.A1 -->
- When one or more links are in the `drifted` state at session start, the
  SessionStart hook emits a single line with the count and the
  `/specship:check drifted` pointer.
<!-- id: REQ-DRIFT-PUSH-002.A2 -->
- With zero drifted links the hook emits no drift output at all.

