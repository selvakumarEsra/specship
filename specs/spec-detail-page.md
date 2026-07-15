---
id: DASH-SPECDETAIL-DOC
title: Spec detail page
owner: web
priority: medium
version: 1
brief: spec-detail-page/snapshot.html
---

<!-- id: DASH-SPECDETAIL-DOC -->
# Spec detail page

A dashboard route that renders a single spec/requirement in full, from the
"SpecShip Desktop" design (the right-hand detail pane of the Specs screen).
Reached by selecting a spec in the existing Specs list; opens at `/specs/:id`.
It reads `GET /api/spec/:id` (`SpecDetailResponse { spec, parent, siblings,
children, links }`) and renders the design's sections: header + meta, the
requirement body, acceptance criteria with a met-rollup, and linked code.
Visual fidelity reference: `specs/spec-detail-page/snapshot.html` +
`tokens.css` (the design system the dashboard already uses).

<!-- id: REQ-SPECDETAIL-001 -->
## A `/specs/:id` route MUST render a spec from `GET /api/spec/:id`

A new lazy-loaded route `/specs/:id` resolves the spec id from the path and
fetches `/api/spec/:id` for the active project. It renders the detail while
loading (skeleton), when empty, and on a not-found / errored id — never a blank
screen or an unhandled throw.

implementations:
  - packages/web-ng/src/app/app.routes.ts
  - ui/src/components/spec-detail.tsx:SpecDetail

## Acceptance
<!-- id: REQ-SPECDETAIL-001.A1 -->
- Navigating to `/specs/<valid-id>` fetches `/api/spec/<id>` and renders that spec's detail.
<!-- id: REQ-SPECDETAIL-001.A2 -->
- While the request is in flight the route shows a loading skeleton, not an empty page.
<!-- id: REQ-SPECDETAIL-001.A3 -->
- An id that resolves to no spec (404 / null) renders a "spec not found" state with a link back to the Specs list, and never throws.

<!-- id: REQ-SPECDETAIL-002 -->
## The header MUST show the breadcrumb, title, and a meta row

The detail header renders: a breadcrumb of the spec's source file path and its
id with a copy-id control; the spec title as the page heading; and a meta row
carrying the spec's link state, priority, kind, owner, and last-verified time.
Fields that are absent in the data are omitted, not shown blank.

implementations:
  - packages/web-ng/src/app/pages/spec-detail/spec-detail.html

## Acceptance
<!-- id: REQ-SPECDETAIL-002.A1 -->
- The header shows the spec id with a control that copies the id to the clipboard.
<!-- id: REQ-SPECDETAIL-002.A2 -->
- The meta row shows a state pill whose label and color reflect the spec's worst link state (verified / drifted / broken / orphaned), the priority, the kind, and the owner.
<!-- id: REQ-SPECDETAIL-002.A3 -->
- A meta field with no value (e.g. no owner) is omitted from the row rather than rendered empty.

<!-- id: REQ-SPECDETAIL-003 -->
## The body MUST render the requirement prose with RFC 2119 keywords emphasized

The requirement section renders the spec's body text, with RFC 2119 keywords
(MUST / SHOULD / MAY and their negatives) visually emphasized, and inline code
spans styled as code chips. A rationale ("why it matters") section is rendered
only when the data model supplies separate rationale content.

implementations:
  - ui/src/components/spec-detail.tsx:SpecDetail
  - packages/web-ng/src/app/pages/spec-detail/spec-detail.html

## Acceptance
<!-- id: REQ-SPECDETAIL-003.A1 -->
- The requirement body renders with each RFC 2119 keyword visually distinguished from surrounding prose.
<!-- id: REQ-SPECDETAIL-003.A2 -->
- Inline code spans in the body render as code chips, not plain text.
<!-- id: REQ-SPECDETAIL-003.A3 -->
- When no separate rationale field exists in `SpecDetailResponse`, the "why it matters" section is omitted rather than fabricated. [needs review: is rationale a distinct field, or part of the body?]

<!-- id: REQ-SPECDETAIL-004 -->
## Acceptance criteria MUST list each criterion with a met-rollup

The acceptance section lists the spec's acceptance-kind children, each with its
`.A<N>` id, its text, and a met/unmet indicator derived from that criterion's
link state. The section header shows an "N / M met" rollup over the criteria.

implementations:
  - ui/src/components/spec-detail.tsx:SpecDetail

## Acceptance
<!-- id: REQ-SPECDETAIL-004.A1 -->
- Each acceptance-kind child renders as a row showing its `.A<N>` id and its criterion text.
<!-- id: REQ-SPECDETAIL-004.A2 -->
- A criterion whose link is verified shows a met indicator; one that is not shows an unmet indicator.
<!-- id: REQ-SPECDETAIL-004.A3 -->
- The section header shows "N / M met" where M is the criteria count and N is the verified count; with zero criteria the section is omitted.

<!-- id: REQ-SPECDETAIL-005 -->
## Linked code MUST list each spec→code link with its target, state, and provenance

The linked-code section lists each entry in `links`, showing the linked
`file:symbol`, the link's state, and its provenance (e.g. tree-sitter vs
heuristic). The section header shows the symbol count.

implementations:
  - ui/src/components/spec-detail.tsx:SpecDetail

## Acceptance
<!-- id: REQ-SPECDETAIL-005.A1 -->
- Each link renders its target `file:symbol` and a state indicator matching the link's state.
<!-- id: REQ-SPECDETAIL-005.A2 -->
- The section header shows the count of linked symbols; with zero links the section shows an explicit "no linked code yet" empty state.
<!-- id: REQ-SPECDETAIL-005.A3 -->
- Each link shows its provenance label when present.

<!-- id: REQ-SPECDETAIL-006 -->
## The Specs list MUST navigate to the detail route, and the detail MUST offer its actions

Selecting a spec in the existing Specs list navigates to `/specs/:id`. The
detail page renders an action bar — Implement, Verify, Edit spec, Show in graph
— wired to the corresponding existing affordances (the graph action deep-links
to the Graph page focused on a linked symbol).

implementations:
  - packages/web-ng/src/app/pages/specs/specs.html
  - packages/web-ng/src/app/pages/spec-detail/spec-detail.html

## Acceptance
<!-- id: REQ-SPECDETAIL-006.A1 -->
- Activating a spec row in the Specs list navigates to that spec's `/specs/:id` route by pointer and keyboard.
<!-- id: REQ-SPECDETAIL-006.A2 -->
- The detail page renders Implement, Verify, Edit spec, and Show in graph actions.
<!-- id: REQ-SPECDETAIL-006.A3 -->
- "Show in graph" navigates to the Graph page; when the spec has a linked symbol, it focuses that symbol. [needs review: confirm the Graph route's focus query param]
