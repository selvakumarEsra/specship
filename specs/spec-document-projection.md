---
id: SPEC-PROJECTION-DOC
title: Spec document projection
owner: core
priority: high
brief: spec-document-projection/brief.md
---

<!-- id: SPEC-PROJECTION-DOC -->
# Spec document projection

A spec file's **document** must enter the graph as a `document`-kind entity with
no parent, distinct from its requirements. Today it does not: when a file uses
the canonical pattern — a frontmatter `id:` plus an H1 carrying the same id via
`<!-- id: -->` — the extractor emits the id twice (once as the document, once as
a top-level requirement parented to itself), and the second write clobbers the
first. Every document in the repo is therefore stored as a self-parented
`requirement`, which corrupts any document → requirements traversal: callers get
the document returned as its own child, and cannot exclude it by kind.

This document specifies the correct projection. It is the contract a
`document → requirements` walk depends on (notably the lifecycle rollup in
REQ-FUNNEL-003).

<!-- id: REQ-PROJECTION-001 -->
## A spec document MUST project as a parentless `document`, never a self-parented requirement

When a spec file declares a document id (a frontmatter `id:`) and its H1 carries
that same id, the indexed graph MUST contain exactly one spec entity for that
id, classified as a `document`, with no parent. The H1 MUST NOT additionally be
projected as a `requirement` parented to itself (or to the document id). The
document's body MUST be the introductory prose the H1 heads — the content
between the H1 and the first requirement — not an empty string. Documents and
requirements that already project correctly MUST be unaffected.

## Acceptance
<!-- id: REQ-PROJECTION-001.A1 -->
- A file with frontmatter `id: X` and an H1 marked `<!-- id: X -->` yields exactly one spec with id `X`, of kind `document`, with no parent.
<!-- id: REQ-PROJECTION-001.A2 -->
- Enumerating that document's child requirements does NOT include the document itself.
<!-- id: REQ-PROJECTION-001.A3 -->
- The document spec's body is the H1's introductory prose (non-empty when the file has intro text between the H1 and the first requirement), not blank.
<!-- id: REQ-PROJECTION-001.A4 -->
- Documents and requirements that already projected correctly are unchanged — same ids, kinds, and parents as before the fix (no regression).
<!-- id: REQ-PROJECTION-001.A5 -->
- Re-indexing a project that previously stored the self-parented mis-projection yields the corrected projection, with no leftover self-parented `requirement` row for the document id.
<!-- id: REQ-PROJECTION-001.A6 -->
- When a file's frontmatter `id` and its H1's embedded id differ, the frontmatter id remains the `document` and the differently-id'd H1 stays a top-level requirement under it — behavior is preserved, no new error.

<!-- id: REQ-PROJECTION-002 -->
## A lone H1 with an id and no frontmatter id MUST project as the document

When a spec file has no frontmatter `id:` but a single top-level H1 carries an
embedded id, that H1 MUST project as the `document` (kind `document`, no parent),
not as a requirement — matching the extractor's stated intent that the document
id comes from the first H1 with an embedded id OR a frontmatter `id:`.

## Acceptance
<!-- id: REQ-PROJECTION-002.A1 -->
- A file with no frontmatter `id:` and one top-level H1 marked with an id yields a `document`-kind, parentless spec for that H1's id.
<!-- id: REQ-PROJECTION-002.A2 -->
- Requirements appearing below that H1 are parented to it.
<!-- id: REQ-PROJECTION-002.A3 -->
- A file with neither a frontmatter `id:` nor any H1 id produces no document node — only its requirements — unchanged from current behavior.
