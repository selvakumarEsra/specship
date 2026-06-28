---
id: ACCEPTANCE-INDEX-DOC
title: Index acceptance criteria as acceptance-kind child spec nodes
owner: core
priority: high
version: 1
brief: acceptance-criteria-indexing/brief.md
---

<!-- id: ACCEPTANCE-INDEX-DOC -->
# Acceptance-criteria indexing

The documented spec convention authors acceptance criteria as a `## Acceptance`
heading followed by id-marked bullets (`<!-- id: REQ-X.A1 -->` above `- …`), but
the markdown spec extractor is heading-driven and never indexes them: the
`## Acceptance` heading raises an error-severity `spec_missing_id`, and the
`.A<N>` markers above bullets are flagged `spec_stranded_id`. As a result no
acceptance criterion anywhere is a spec node — none are queryable, none are
linkable, and the enforcement behaviour gate's "acceptance children" rollup is
always empty.

This makes the documented bullet convention actually work by fixing the
extractor — no convention change and no edits to existing spec files. Every spec
that already uses the convention corrects itself on the next re-index.

<!-- id: REQ-ACCEPTANCE-001 -->
## Id-marked bullets MUST index as acceptance-kind nodes parented by their id suffix

When an embedded id marker is followed by a list bullet rather than a heading,
the extractor emits an `acceptance`-kind spec node for that criterion, parented to
the requirement named in the id's suffix.

implementations:
- src/extraction/specs/markdown-spec-extractor.ts:parseAcceptanceParentId

## Acceptance
<!-- id: REQ-ACCEPTANCE-001.A1 -->
- An `<!-- id: REQ-X.A1 -->` marker immediately above a bullet produces an
  `acceptance`-kind spec node whose body is that bullet's text, including any
  continuation lines up to the next id marker or heading.
<!-- id: REQ-ACCEPTANCE-001.A2 -->
- The node's parent is the requirement named in the id suffix (`REQ-X.A1` →
  `REQ-X`), independent of the surrounding document order.
<!-- id: REQ-ACCEPTANCE-001.A3 -->
- An id marker above a bullet no longer raises `spec_stranded_id`; the genuine
  case (two consecutive id markers with no content between them) still warns.
<!-- id: REQ-ACCEPTANCE-001.A4 -->
- When the id has no `.A<N>` suffix, the node is still created and is parented to
  the enclosing requirement section as a fallback.

<!-- id: REQ-ACCEPTANCE-002 -->
## A no-id "Acceptance" heading MUST be a container, not an error

A heading titled "Acceptance" with no id marker is recognized as a structural
container — it yields no node and no error — while the rule that every other
heading must carry an id is preserved.

implementations:
- src/extraction/specs/markdown-spec-extractor.ts:isAcceptanceContainerHeading

## Acceptance
<!-- id: REQ-ACCEPTANCE-002.A1 -->
- A heading titled "Acceptance" (case-insensitive) with no id marker above it
  produces no spec node and does not raise `spec_missing_id`.
<!-- id: REQ-ACCEPTANCE-002.A2 -->
- Every other heading that lacks an id marker still raises `spec_missing_id`, so
  requirements remain addressable.
<!-- id: REQ-ACCEPTANCE-002.A3 -->
- The `## Acceptance` heading is optional: id-marked bullets placed directly under
  a requirement, with no container heading, index the same way.

<!-- id: REQ-ACCEPTANCE-003 -->
## Existing specs MUST gain queryable, linkable acceptance nodes with no file edits

Re-indexing a spec that already uses the bullet convention produces its acceptance
nodes and clears the prior diagnostics without any change to the file, and those
nodes are usable everywhere a spec node is expected.

## Acceptance
<!-- id: REQ-ACCEPTANCE-003.A1 -->
- Re-indexing an existing spec that uses the convention (e.g. a current
  requirement with `## Acceptance` bullets) creates its acceptance nodes and clears
  the prior `spec_missing_id` / `spec_stranded_id` diagnostics, with no edit to the
  file.
<!-- id: REQ-ACCEPTANCE-003.A2 -->
- An acceptance node is returned by `specship_spec` (as a child of its
  requirement) and is a valid `specship_link_assert` target by its `.A<N>` id.
<!-- id: REQ-ACCEPTANCE-003.A3 -->
- The enforcement behaviour check includes a requirement's acceptance-child
  `tests` links in its verification rollup, so a `tests` link asserted against a
  `.A<N>` criterion counts toward that requirement's behaviour gate.
<!-- id: REQ-ACCEPTANCE-003.A4 -->
- When an acceptance bullet's id-suffix parent differs from its enclosing
  requirement section, the node is parented per the id suffix and a mismatch
  warning is emitted (not an error).
