---
id: IMPACT-SPEC-DOC
title: Spec-aware impact — blast radius includes governing specs
owner: core
priority: medium
version: 1
---

<!-- id: IMPACT-SPEC-DOC -->
# Spec-aware impact

`specship_impact` answers "what breaks if I change X" purely in code space —
the transitive dependents. But the graph also carries intent: when an affected
symbol is linked to a requirement, changing it drifts a verified promise, and
today the user discovers that only after the edit, in the drift queue. The one
moment spec linkage could prevent a regression — before the change — is exactly
when it is invisible, and the reads door is a dead end with no handoff into the
intent or gate doors.

This document joins spec links into the blast radius. It is the feature that
distinguishes SpecShip impact from any plain code-graph impact, so it is shown
regardless of install tier — retrieval-tier users seeing spec annotations is
organic advertising for the governance tier.

<!-- id: REQ-IMPACT-SPEC-001 -->
## Impact analysis MUST report the specs governing the blast radius

For each affected symbol that carries a spec link, the impact output lists the
governing spec's id, the link kind, and the link's current state, and closes
with drift-handoff guidance when governed symbols are in the radius.

implementations:
  - src/mcp/tools.ts:handleImpact
  - src/mcp/tools.ts:formatGovernedBy
  - src/index.ts:SpecShip.getImpactRadius

## Acceptance
<!-- id: REQ-IMPACT-SPEC-001.A1 -->
- `specship_impact` output includes, for each affected symbol with a spec link,
  a governed-by entry naming the spec id, the link kind, and the link's current
  state (e.g. `REQ-AUTH-005 · implemented-by · verified`).
<!-- id: REQ-IMPACT-SPEC-001.A2 -->
- The governed-by section appears regardless of install tier — a
  retrieval-tier install with spec links in its database shows the same
  annotations as a governance-tier install.
<!-- id: REQ-IMPACT-SPEC-001.A3 -->
- When one or more governed symbols are in the radius, the output ends with
  handoff guidance: re-assert links after the change and check the gate door
  for drift.
<!-- id: REQ-IMPACT-SPEC-001.A4 -->
- A radius containing no spec-linked symbols produces output identical in
  structure to today's — no empty governed-by section is emitted.
