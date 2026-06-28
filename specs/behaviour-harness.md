---
id: BEHAVIOUR-DOC
title: Behaviour harness — generate, run, and verify E2E tests from spec acceptance criteria
owner: core
priority: high
version: 1
brief: behaviour-harness/brief.md
---

<!-- id: BEHAVIOUR-DOC -->
# Behaviour harness

The generate-and-run half of SpecShip's behaviour harness. SpecShip already owns
the verify half — `tests`-kind spec links, the `verified`/`broken` state machine,
and the `specship check` behaviour gate. This lane turns a requirement's
acceptance criteria into actual end-to-end tests — a Playwright UI journey and/or
a backend/batch API test — links each to the criterion it covers, runs them, and
feeds the outcome back into that existing chain.

The shape is a deterministic **behaviour-surface retrieval primitive** (the flow
map a requirement exposes) plus an orchestrating **`/ss-behaviour` skill** (the
agent authors and runs the tests, the human gates the write). SpecShip itself
executes nothing: it surfaces the flows and records verification state. It reuses
`specship_link_assert` (kind `tests`), `specship_link_verify`, and the
enforcement behaviour check; it adds no new verification state machinery.

<!-- id: REQ-BEHAVIOUR-001 -->
## The behaviour surface MUST expose a requirement's testable flows, grouped UI vs backend

Given a requirement, the behaviour surface returns the code that requirement
already links to plus the routes, components, and handlers reachable around it,
split into a UI tier and a backend/batch tier — enough for the skill to author
end-to-end tests without further exploration.

implementations:
- src/behaviour/behaviour-surface.ts:computeBehaviourSurface
- src/behaviour/behaviour-surface.ts:isUiNode
- src/behaviour/behaviour-surface.ts:renderBehaviourSurface

## Acceptance
<!-- id: REQ-BEHAVIOUR-001.A1 -->
- Queried with a requirement id, the surface returns the requirement's linked
  code together with the surrounding routes / components / handlers, partitioned
  into a UI tier and a backend/batch tier.
<!-- id: REQ-BEHAVIOUR-001.A2 -->
- Each returned flow element carries enough to act on — its symbol, kind, and
  file location — so the skill needs no follow-up fetch to author a test.
<!-- id: REQ-BEHAVIOUR-001.A3 -->
- For a project (or requirement) with no UI surface, the UI tier comes back empty
  and the call still succeeds — an empty UI tier is a valid result, not an error.
<!-- id: REQ-BEHAVIOUR-001.A4 -->
- A requirement that does not exist returns an explicit not-found result, not a
  silent empty surface.

<!-- id: REQ-BEHAVIOUR-002 -->
## /ss-behaviour MUST author an end-to-end test for each acceptance criterion

`/ss-behaviour <REQ-ID>` produces, for every acceptance criterion of the
requirement, the end-to-end test(s) that exercise that criterion — a Playwright
test for a UI flow, a backend/batch test for a backend path, both when the
criterion touches both — each traceable to the criterion it covers.

## Acceptance
<!-- id: REQ-BEHAVIOUR-002.A1 -->
- For each acceptance criterion of the requirement, at least one end-to-end test
  is authored, and every generated test names the `.A<N>` criterion it covers in
  both its test title and the link it will assert.
<!-- id: REQ-BEHAVIOUR-002.A2 -->
- When a criterion touches the UI tier, a Playwright test exercising that UI flow
  is authored; when it touches the backend/batch tier, a backend/API test is
  authored; a criterion that touches both yields one of each.
<!-- id: REQ-BEHAVIOUR-002.A3 -->
- Generated tests mirror the project's existing test conventions (the UI runner
  and backend runner already in use, and their file locations) rather than
  imposing a fixed stack.
<!-- id: REQ-BEHAVIOUR-002.A4 -->
- When the project has no UI surface, only backend/batch tests are authored and
  no Playwright test is generated or run.

<!-- id: REQ-BEHAVIOUR-003 -->
## Generated tests MUST be previewed, confirmed, linked, and idempotent

The flow shows the exact test files it will create and writes them only after
explicit confirmation, asserting a `tests`-kind link from each test to its
criterion, and a re-run refreshes rather than duplicates.

## Acceptance
<!-- id: REQ-BEHAVIOUR-003.A1 -->
- Before writing, the flow previews the exact test files (path + contents) it will
  create and writes them only after explicit confirmation; declining writes
  nothing.
<!-- id: REQ-BEHAVIOUR-003.A2 -->
- On confirmation, each written test is linked to the `.A<N>` criterion it covers
  with a `tests`-kind spec link.
<!-- id: REQ-BEHAVIOUR-003.A3 -->
- Re-running `/ss-behaviour` on the same requirement refreshes the existing tests
  and links for its criteria without creating duplicate files or duplicate links.
<!-- id: REQ-BEHAVIOUR-003.A4 -->
- The generated tests index cleanly — `specship sync` reports no spec or parse
  error after they are written.

<!-- id: REQ-BEHAVIOUR-004 -->
## Run outcomes MUST feed the existing verify chain

After writing, the flow runs the relevant suite and records each result through
the existing verification path, distinguishing a real failure from an inability
to run, so the links drive `specship check`'s behaviour gate unchanged.

## Acceptance
<!-- id: REQ-BEHAVIOUR-004.A1 -->
- A test that runs and passes moves its `tests` link to `verified`; a test that
  runs and fails moves its link to `broken`.
<!-- id: REQ-BEHAVIOUR-004.A2 -->
- A suite that cannot be executed (missing dependency, no dev server, wrong
  environment) is reported as unrun and leaves the link state unchanged — it is
  never recorded as `broken`.
<!-- id: REQ-BEHAVIOUR-004.A3 -->
- The resulting links feed `specship check`'s behaviour gate with no change to the
  gate: a `broken` link fails the gate when behaviour gating is enabled, and a
  requirement with no `verified` test is reported as unverified.
