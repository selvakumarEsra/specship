---
slug: spec-document-projection
spec: SPEC-PROJECTION-DOC   # specs/spec-document-projection.md (REQ-PROJECTION-001..002)
created: 2026-06-25
---

# Brainstorm: Fix document mis-projection in the markdown spec extractor

## Problem

Every spec **document** is stored in the graph as `kind=requirement` with
`parent_id` pointing at **itself**, instead of `kind=document` with no parent.
Confirmed across all three docs in this repo (OFFLINE-DOC, SDD-INSTALL-DOC,
SPEC-FUNNEL-DOC) by reading the raw `specs` table.

Consequence: any **doc → requirements walk** (`getSpecsByParent(docId)`) returns
the document as its own child, so callers that enumerate a document's
requirements get an off-by-one that includes the document itself — and they
can't filter it out by kind, because the document is mis-typed `requirement`
too. This silently corrupts drift/hierarchy queries and directly threatens the
funnel rollup in REQ-FUNNEL-003.

### Root cause (confirmed)

The canonical spec pattern (which `format.md` itself prescribes) puts the **same
id in two places**: frontmatter `id: X` *and* the H1 marker `<!-- id: X -->`.
The extractor then emits **two specs with the same id**:

1. The frontmatter branch (`markdown-spec-extractor.ts:155–185`) emits the
   document correctly: `id=X`, `kind='document'`, `parentId=undefined`.
2. The section loop (`192–244`) treats the H1 as a `level=1` section →
   `kind = level>=3 ? 'acceptance' : 'requirement'` = **requirement**, and its
   parent search finds no shallower section so `parentId = docId = X` →
   **self-parented**.

`SpecQueries.insertSpec` uses `INSERT OR REPLACE` keyed on `id`, so spec #2
clobbers spec #1 — leaving the self-parented `requirement`.

## Code grounding

- `src/extraction/specs/markdown-spec-extractor.ts`
  - `extract()` — frontmatter-document branch (155–185, correct) and the section
    loop (192–244) that re-emits the H1 as a self-parented requirement.
    `kind = section.level >= 3 ? 'acceptance' : 'requirement'` (223); parent
    search (210–218); the document-body range is computed as content *before*
    the first heading (`firstSection.headingLineIdx`, 156–159).
  - Docstring (28–31) already states the intent: "The document spec
    (kind='document') has no parent and gets ID from the first H1 with an
    embedded ID — OR a document-level `id:` field in the frontmatter."
- `src/db/spec-queries.ts:insertSpec` — `INSERT OR REPLACE INTO specs ... id`
  (the clobber); `getSpecsByParent` (the walk that returns the self-child);
  `deleteSpecsByFile` (called by sync before re-insert → re-index repairs).
- `src/index.ts` — `syncSpecFile`-style flow (≈461–475): delete prior specs for
  the file → extract → `insertSpecsBatch`. A forced re-index overwrites bad rows.
- `src/types.ts:608` — `SPEC_KINDS = ['document','requirement','acceptance']`.
- Tests: spec extraction tests live alongside the extractor; the parameterized
  spec tests should gain a document-projection assertion.

## Approaches considered

1. **Fix the document clobber only** — recognize the top H1-with-id as the
   document; do not re-emit it as a self-parented requirement.
2. **Clobber fix + project acceptance bullets as nodes** — additionally model
   `.A` bullets as `kind=acceptance` nodes. Larger; changes the heading/bullet
   model and what `## Acceptance` means.
3. **Rework the whole section/kind model** — explicit H1=document /
   H2=requirement / bullets=acceptance, replacing the `level>=3` heuristic.
   Largest blast radius.
**Chosen: 1** — the document clobber is a clear, contained corruption with real
downstream impact and a low-risk fix. Acceptance-bullet projection is a separate
modeling question (what consumes acceptance nodes? does `## Acceptance` stay a
non-node?) and is explicitly out of scope here.

## Key decisions

- **The top H1-with-id is the document.** When a top-level (`level=1`) section's
  id equals the document id, it MUST NOT be emitted as a requirement — it is the
  document, already emitted by the frontmatter branch. Result: exactly one spec
  with that id, `kind=document`, `parent=null`.
- **Document body sourced from the H1 section.** The fix MUST take the document
  body from the H1's section body (the intro prose that follows the H1), not the
  current "content before the first heading" range — which is empty when the H1
  carries the id, silently blanking the document body.
- **Lone H1-with-id, no frontmatter id → still a document.** When there is no
  frontmatter `id:` but a single top H1 carries an embedded id, it MUST be
  emitted as `kind=document` / `parent=null` (matches the extractor's docstring).
  Secondary to the core fix.
- **Re-index self-repairs.** A forced re-index (delete-by-file → re-insert)
  overwrites the previously mis-projected rows; no separate migration step.

## Edge cases & non-goals

Edge cases:
- Frontmatter `id: X` + H1 `<!-- id: X -->` (the canonical, bug-triggering case)
  → one `document` spec, no self-parent.
- Frontmatter `id: X` + H1 with a *different* id `Y` → document `X`
  (`kind=document`); the H1 `Y` is a top-level requirement under `X` (unusual but
  not corrupt). Preserve current behavior; do not collapse `Y` into the document.
- Frontmatter `id:` present but **no H1** (requirements start at H2) → unchanged:
  document from frontmatter, requirements parented to it.
- Multiple H1s → only the H1 whose id equals the document id is the document;
  others remain top-level requirements.

Non-goals:
- Does NOT project acceptance `.A` bullets as nodes (separate follow-up).
- Does NOT change the `level>=3 ? acceptance : requirement` kind heuristic for
  non-document headings.
- Does NOT change general duplicate-id handling beyond the document/H1 collision.
- Does NOT alter `format.md`'s authoring pattern — the same-id frontmatter+H1
  pattern stays valid; it just stops producing a corrupt projection.

## Acceptance criteria

- After indexing a spec file with frontmatter `id: X` and an H1 marked
  `<!-- id: X -->`, the `specs` table holds exactly one row with id `X`, and that
  row is `kind=document` with `parent_id` null (not a self-parented requirement).
- `getSpecsByParent(X)` returns only the document's real child requirements — it
  does NOT include `X` itself.
- The document spec's body is the H1's intro prose (non-empty when the file has
  intro text between the H1 and the first requirement), not blank.
- Requirements and their parenting are unchanged for documents that already
  parsed correctly (no regression in existing requirement ids / parents).
- A spec file with a lone top H1 carrying an id and no frontmatter `id:` produces
  a `kind=document` / parentless spec for that H1.
- Re-indexing a project that previously stored the mis-projected rows results in
  the corrected projection with no leftover self-parented `requirement` row for
  the document id (delete-by-file → re-insert repairs it).
