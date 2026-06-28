---
slug: acceptance-criteria-indexing
spec: ACCEPTANCE-INDEX-DOC
created: 2026-06-28
---

# Brainstorm: Index acceptance criteria as acceptance-kind child spec nodes

## Problem
The spec-author format reference documents acceptance criteria as a `## Acceptance`
heading followed by id-marked **bullets** (`<!-- id: REQ-X.A1 -->` above `- …`),
and calls `## Acceptance` an "unnumbered subheading, OK … not required by the
parser." But the actual markdown spec extractor is **heading-driven** and
contradicts that: it pairs each id marker with the next *heading*, so:
- `## Acceptance` (a heading with no id above it) raises an **error-severity**
  `spec_missing_id`, and
- the `.A<N>` markers sit above *bullets*, never get consumed by a heading, and
  are flagged `spec_stranded_id` (warning).

Net effect repo-wide: **no acceptance criterion is ever indexed as a node**. None
are queryable (`specship_spec`) or linkable (`specship_link_assert` can't target a
`.A<N>`), and the enforcement behaviour gate — which rolls up a requirement's
*"acceptance children's"* `tests` links (`evaluateEnforcement`) — always sees an
empty set, so it can only ever gate on a requirement's *direct* links. Every spec
in the repo (incl. the merged TRIAGE-DOC and the new BEHAVIOUR-DOC) carries these
diagnostics. We want to fix the extractor so the documented bullet convention
actually works — no convention change, no spec-file edits.

This directly unblocks BEHAVIOUR-DOC (REQ-BEHAVIOUR-002/003 link tests at the
`.A<N>` level).

## Code grounding
- **Root cause — `src/extraction/specs/markdown-spec-extractor.ts`, the heading
  walk (lines ~116–165).** Each `<!-- id -->` marker (`ID_COMMENT`) sets
  `pendingId`; the next line matching `HEADING` (`^#{1,6} title`) consumes it as a
  section. A bullet is not a heading, so a `.A<N>` marker never resolves: a second
  marker trips `spec_stranded_id` (line 125), and a no-id heading like
  `## Acceptance` trips `spec_missing_id` (line 144, severity `error`).
- **The `acceptance` kind already exists** — line ~284:
  `const kind = section.level >= 3 ? 'acceptance' : 'requirement'`. So the
  extractor's model is "acceptance criteria are deeper-level *headings*"; the
  documented + universally-used convention authors them as id-marked *bullets*.
  That mismatch (bullets vs headings) is the whole bug.
- **Consumer that's waiting on this — `src/enforce/enforce.ts`.**
  `RequirementVerification.testsLinks` is documented as "all `tests`-kind links
  for the requirement **and its acceptance children**"; `evaluateEnforcement`'s
  behaviour check reads them. Today the acceptance-children set is always empty.
- **Reference that documents the convention** —
  `~/.claude/skills/spec-author/references/format.md`: shows `## Acceptance`
  marked "OK" and `<!-- id: REQ-AUTH-001.A1 -->` above bullets, and states the ID
  markers make criteria "queryable as individual spec nodes" (which is currently
  false). The fix makes the reference true; the reference itself needs no change.
- **No spec anywhere currently indexes a `kind='acceptance'` node** (verified
  against the live index) — confirming the bug is universal, not spec-specific.
- Likely files touched: `src/extraction/specs/markdown-spec-extractor.ts` (the
  walk + section classification); tests under `__tests__/spec-extraction.test.ts`
  and any asserting spec counts / absence of acceptance nodes; a CHANGELOG entry.

## Approaches considered
1. **Fix the extractor — id-marked bullets become acceptance nodes.** When a
   pending id is followed by a bullet (not a heading), emit an `acceptance`-kind
   node (body = bullet text); treat a `## Acceptance` heading with no id as a
   recognized container (no node, no error). Trade-offs: extractor complexity
   (bullet parsing, container handling, parent derivation), and acceptance node
   counts appear repo-wide — but matches the documented convention AND every
   existing spec, which all index correctly on the next re-index with **zero file
   edits**, and unlocks criterion-level linking + the enforce rollup.
2. **Change the convention — acceptance criteria as `###` headings with ids.**
   No extractor change, but rewrite the reference + review checklist and migrate
   every existing spec from bullets to headings. Big blast radius (every spec file
   + the reference + muscle memory), more verbose, fights how criteria are
   naturally written.
3. **Concede in docs — criteria can't be nodes.** Document that `.A<N>` lives in
   the requirement body and isn't queryable. Cheapest, but abandons
   criterion-level linking and leaves the enforce "acceptance children" rollup
   permanently empty.

**Chosen: 1 (fix the extractor).** Makes the documented convention true,
retroactively fixes every spec in the repo with no edits, and unblocks
BEHAVIOUR-DOC's criterion-level test linking. 2 is heavy churn to avoid the change
that is the actual bug; 3 gives up the capability the user explicitly asked to
restore.

## Key decisions
- **Id-marked bullet → `acceptance` node.** A pending `<!-- id -->` followed by a
  bullet (`- ` / `* `) emits an `acceptance`-kind spec node; the body is the
  bullet text including multi-line continuation, up to the next marker / heading.
- **Parent from the id suffix, warn on mismatch.** `REQ-X.A2` → parent `REQ-X`
  (order-independent, taken from the id). When the enclosing requirement section
  differs from the suffix parent, still parent per the id and emit a
  **mismatch warning**. An id with no `.A<N>` suffix → fall back to the enclosing
  requirement.
- **`## Acceptance` is a container.** A heading titled "Acceptance"
  (case-insensitive) with no id raises **no** `spec_missing_id` and produces no
  node. Every **other** no-id heading still errors — the requirement-must-be-
  addressable rule is preserved.

## Edge cases & non-goals
- **Stranded warnings stop** for id-marked bullets — they're now consumed by the
  bullet, not left pending. The "two consecutive id markers with no content
  between" stranded case still warns for genuine misuse.
- **`## Acceptance` is optional** — id-marked bullets directly under a requirement
  (no container heading) also index, parented via the id suffix.
- **Backward-compatible, no migration** — every existing spec auto-corrects on the
  next re-index with zero file edits; acceptance node counts rise (intended). Any
  test asserting spec counts or the absence of acceptance nodes is updated.
- **Multi-line bullets** — a criterion's body spans its continuation lines until
  the next id marker / heading.
- **Non-goals:** no change to the authoring convention (bullets stay); no editing
  or migrating existing spec files; no change to `evaluateEnforcement`'s logic (it
  already reads acceptance children — it simply starts seeing them); no new spec
  kind (`acceptance` exists); criteria stay one level deep (leaves under
  requirements); the format reference needs no rewrite (the fix makes it true).

## Acceptance criteria
- An id-marked bullet under a requirement — with or without a `## Acceptance`
  container heading — indexes as an `acceptance`-kind spec node whose parent is the
  requirement named in its id suffix.
- A `## Acceptance` heading with no id marker produces no node and no
  `spec_missing_id` error; every other heading lacking an id still raises
  `spec_missing_id`.
- The `.A<N>` id markers above bullets no longer raise `spec_stranded_id`.
- When an acceptance bullet's id-suffix parent differs from its enclosing
  requirement section, the node is parented per the id suffix and a mismatch
  warning is emitted.
- An id-marked bullet whose id has no `.A<N>` suffix is parented to the enclosing
  requirement (fallback), still as an `acceptance` node.
- Re-indexing an existing spec that uses the bullet convention (e.g. TRIAGE-DOC,
  BEHAVIOUR-DOC) produces its acceptance nodes and clears the prior
  `spec_missing_id` / `spec_stranded_id` diagnostics, with no edit to the file.
- An acceptance node is queryable via `specship_spec` and is a valid
  `specship_link_assert` target, and `evaluateEnforcement`'s behaviour check now
  includes a requirement's acceptance-child `tests` links in its rollup.
