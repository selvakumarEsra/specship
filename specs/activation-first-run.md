---
id: ACTIVATION-DOC
title: First-run activation — the manufactured retrieval moment
owner: core
priority: high
version: 1
---

<!-- id: ACTIVATION-DOC -->
# First-run activation — the manufactured retrieval moment

SpecShip's adoption wedge is retrieval: the agent explores the index instead of
Read/Grep-thrashing. That value is **structurally invisible to the human** who
decides whether to keep SpecShip installed — the agent consumes it, the developer
just sees an answer. A tool whose entire benefit is invisible to its adopter
churns.

This document specifies a single *manufactured* first-run moment that makes the
wedge perceivable in one shot: after the project is indexed, SpecShip generates a
concrete "try this" prompt targeting its sweet spot — a cross-file flow or impact
question, the kind that normally makes the agent flail through many files — and
surfaces it where a newcomer will reach it. The contrast (a hard question
answered fast and correctly) is the felt proof. It is part of the adoption-wedge
MVP (Wave 2) and works only for the retrieval tier; nothing here requires specs.

The moment is only surfaced against a healthy install — it depends on the green
post-install smoke check specified in the sibling `install-handshake` spec
(`INSTALL-HANDSHAKE-DOC`). A botched first impression is worse than none, so a
prompt that can't be verified is never shown.

<!-- id: REQ-ACTIVATION-001 -->
## A first-run starter prompt MUST be generated from a pre-verified flow

After indexing a project, SpecShip MUST produce a concrete starter prompt that
names real symbols from *that* repository, derived from a flow it has already
verified connects end-to-end in the graph. When no connecting cross-file flow can
be found, it MUST fall back to an impact question on a single real symbol rather
than emit a weak or unconnected example. The starter prompt MUST never describe a
flow whose endpoints do not actually connect, and MUST never originate a flow from
a god-file's fan-out.

The selection SHOULD prefer a high-value entry point (a `route` node or a
high-fan-in exported function) traced to a leaf it reaches over a multi-hop path,
and SHOULD prefer a path that rides a synthesized dynamic-dispatch edge, since
that showcases coverage grep can't follow. Hop count is a non-normative tuning
heuristic: the path SHOULD be more than a single hop (so the moment demonstrates
multi-hop tracing rather than a trivial one-edge call), with no hard upper bound
(an illustrative comfortable range is 3–6 hops). The hard, testable contract is
the one in A2 — endpoints verified to connect end-to-end, crossing at least two
files — not any specific hop number.

implementations:
  - src/activation/starter-prompt.ts:selectStarterPrompt
  - src/activation/starter-prompt.ts:generateStarterPrompt

## Acceptance
<!-- id: REQ-ACTIVATION-001.A1 -->
- The generated prompt names only symbols that exist in the index — it contains no
  placeholder tokens (e.g. literal `X`/`Y`) that the developer must fill in.
<!-- id: REQ-ACTIVATION-001.A2 -->
- When a connecting flow exists, the prompt describes a flow whose two named
  endpoints are verified to connect end-to-end in the graph, and whose path
  crosses at least two distinct files.
<!-- id: REQ-ACTIVATION-001.A3 -->
- A symbol that the maintainability signals flag as an oversized symbol or
  god-file is never used as the flow's source endpoint.
<!-- id: REQ-ACTIVATION-001.A4 -->
- When no connecting multi-file flow is found, the prompt is an impact question
  ("what breaks if I change <name>?") on the single highest-fan-in symbol — a form
  that needs only one real symbol and therefore cannot fail to connect.
<!-- id: REQ-ACTIVATION-001.A5 -->
- On an empty or unindexed project, no starter prompt is generated.

<!-- id: REQ-ACTIVATION-002 -->
## The starter prompt MUST be delivered at the two surfaces a newcomer reaches

The generated prompt MUST be presented both in the terminal at index time and at
the bare reads-door invocation inside Claude Code, so the moment survives the
handoff from terminal to agent. A developer who just installed a *retrieval* tool
naturally invokes the reads door to see what it does; the prompt MUST live there.

(Delivery is CLI wiring + a markdown door — the `init`/install closing line and
the `specship starter-prompt` command surfaced by the `/ss-explore` door — so
there is no single exported symbol to link; verified by the surfaces' behaviour.)

## Acceptance
<!-- id: REQ-ACTIVATION-002.A1 -->
- `specship init -i` prints the generated starter prompt as its closing terminal
  output.
<!-- id: REQ-ACTIVATION-002.A2 -->
- The `/ss-explore` door invoked with no arguments leads with the generated
  starter prompt (framed as "a flow worth trying in this repo") before its usual
  usage guidance.
<!-- id: REQ-ACTIVATION-002.A3 -->
- For a given index state both surfaces present the same prompt; the prompt is
  regenerated lazily so it stays valid as the repository grows.

<!-- id: REQ-ACTIVATION-003 -->
## The nudge MUST retire once it has served its purpose

Once the developer has actually used retrieval, the starter-prompt lead MUST stop
appearing — the nudge is tied to activation and retires on activation. It MUST NOT
introduce a new counter; it reuses the existing per-session call marker.

implementations:
  - src/statusline/session-marker.ts:readSessionMarker

## Acceptance
<!-- id: REQ-ACTIVATION-003.A1 -->
- After at least one real specship lookup has been recorded in the current
  session marker (the marker counts specship tool calls, `specship_explore`
  chief among them), a bare `/ss-explore` invocation reverts to plain usage
  guidance with no starter-prompt lead.
<!-- id: REQ-ACTIVATION-003.A2 -->
- Retirement is driven by the existing per-session call marker
  (`REQ-STATUSLINE-004`); no additional persistent counter is added.
<!-- id: REQ-ACTIVATION-003.A3 -->
- Retiring the nudge removes only the starter-prompt lead — the reads door's
  normal behaviour is unchanged.

<!-- id: REQ-ACTIVATION-004 -->
## The manufactured moment MUST NOT be surfaced against a broken install

The starter prompt MUST be gated on a healthy, queryable index. If the install is
not verified healthy, neither surface shows a prompt — the developer is never
invited to try a flow against an install that will error. This requirement
depends on the post-install smoke check defined in `INSTALL-HANDSHAKE-DOC`.

## Acceptance
<!-- id: REQ-ACTIVATION-004.A1 -->
- When the post-install smoke check is not green (runtime, FTS5, or a queryable
  index is unavailable), neither the terminal nor the `/ss-explore` surface shows
  a starter prompt.
<!-- id: REQ-ACTIVATION-004.A2 -->
- A project whose index is missing or unreadable produces the existing actionable
  "not initialized — run `specship init -i`" guidance, never a starter prompt.
