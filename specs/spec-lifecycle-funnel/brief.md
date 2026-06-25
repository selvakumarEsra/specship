---
slug: spec-lifecycle-funnel
spec: SPEC-FUNNEL-DOC   # specs/spec-lifecycle-funnel.md (REQ-FUNNEL-001..006)
created: 2026-06-25
---

# Brainstorm: Spec lifecycle funnel — briefs as first-class graph citizens

## Problem

There is no way to query the spec-driven pipeline end-to-end: which **ideas**
were brainstormed (the `specs/<slug>/brief.md` files `/ss-brainstorm` writes),
which became **specs**, and which are **implemented**. Today:

- **Briefs are absent from the graph.** Querying `"brief"` returns only code
  (`parseBriefField`, the `GET /api/spec/:id/brief` route, `briefHtml`). The web
  UI resolves spec→brief *on demand* by reading a spec file's `brief:`
  frontmatter, but nothing discovers **idea-only briefs** (a `brief.md` whose
  `spec:` is still unset) or walks brief→spec.
- **The only lifecycle command is `specship drifted`**, which shows just the
  *problem* queue (drifted/broken/orphaned) — no inventory, no funnel.

We want briefs indexed into the graph as first-class entities so that "ideas
brainstormed → specs created → implemented" becomes queryable from every
surface (CLI, MCP, web).

## Code grounding

- `src/types.ts:608` — `SPEC_KINDS = ['document','requirement','acceptance']`
  (closed enum); `Spec` type at `src/types.ts:637`. Add `brief` here.
- `src/extraction/specs/markdown-spec-extractor.ts` — `MarkdownSpecExtractor`
  infers kind by **heading depth** + requires `<!-- id: -->` markers. Briefs
  have frontmatter (`slug`/`spec`/`created`) + freeform prose and NO REQ
  markers, so the extractor must **branch on brief.md** (by filename and/or the
  brief frontmatter signature) rather than infer it the usual way.
  `parseFrontmatter` is the existing frontmatter reader to mirror.
- `src/index.ts:488` — default spec root is `<projectRoot>/specs/`; spec
  discovery currently targets top-level `specs/*.md`. It must **recurse** to
  reach `specs/<slug>/brief.md`. Sync path: `syncSpecFile`-style flow around
  `src/index.ts:461–475` (delete prior → extract → `insertSpecsBatch` → resolve
  links).
- `src/db/spec-queries.ts` — `insertSpec` (also projects a thin `spec` node into
  `nodes` so the spec joins graph traversal), `getAllSpecs` (425),
  `getSpecsByParent` (414), `getSpecById` (394), `getLinksBySpec` (661),
  `getLinksByState` (709). Briefs as `kind:'brief'` ride all of this.
- `src/resolution/spec-link-resolver.ts` — `SpecLinkResolver` + its
  orphaned/drifted state model (`SpecLinkResolverStats`, `resolveOneLink`,
  `findLogicalTarget`). The brief↔spec link's one-sided/mismatch warning should
  mirror this.
- `packages/server/src/routes/spec.ts` — `parseBriefField` (reads a spec file's
  `brief:` frontmatter) + `GET /api/spec/:id/brief` (167). Extend for the funnel
  + idea-only briefs. Existing coverage: `__tests__/spec-brief-endpoint.test.ts`.
- `src/bin/specship.ts:1976` — the `drifted` CLI command: the pattern to mirror
  for a new `specship spec` funnel command (text + `--json` + state options).
- `src/mcp/spec-tools.ts` — `specship_spec`, `specship_drifted` MCP tools; add a
  funnel tool here.
- `packages/web-ng/src/app/pages/specs/specs.ts` — the web specs page to extend.

## Approaches considered

1. **A — `specship spec` CLI command, briefs read by a filesystem scan.**
   Smallest; "ideas" come from scanning `specs/**/brief.md` at command time, not
   from the DB. Doesn't make briefs queryable elsewhere.
2. **B — A focused funnel-summary command.** Effectively A's `--summary` mode;
   still no per-surface reuse.
3. **C — Index briefs into the graph as first-class nodes.** Briefs become
   queryable from CLI, MCP, and web off one indexed source.
**Chosen: C, as a new spec kind `brief`** — the variant of C that delivers
"every surface for free": briefs ride the existing spec-node projection, so
`specship_explore` / `specship_spec` / `getAllSpecs` / the web page surface them
without per-surface re-plumbing. (A dedicated `briefs` table was rejected: it
keeps the spec graph REQ-only but forces re-plumbing every surface — the
opposite of why C was chosen.)

## Key decisions

- **Brief model:** add `brief` to `SPEC_KINDS`. Each `specs/<slug>/brief.md`
  becomes a spec row with id `brief:<slug>`, `kind:'brief'`, body = the brief
  markdown, projected as a graph node. Title from the `# Brainstorm: <feature>`
  H1 (fallback: slug).
- **Discovery:** spec-file discovery recurses so nested `brief.md` is scanned and
  kept fresh by the same index/sync pipeline as `specs/*.md`.
- **Brief↔spec link (both, reconciled):** link when EITHER the brief's `spec:`
  (resolve a REQ id up to its parent document) OR the spec document's `brief:`
  points across. A one-sided or mismatched pointer → a **drift-style warning**,
  mirroring `SpecLinkResolver`'s orphaned/drifted model. The link is NOT 1:1 with
  the document — one brief can spawn a single REQ inside a multi-REQ doc.
- **Lifecycle state:** `idea` (no resolvable spec) → `specified` (spec resolves)
  → implementation rollup derived from the linked spec's REQ `spec_links`
  (implemented / verified / drifted), reusing `getLinksBySpec`.
- **Surfaces (all three):**
  - **CLI** `specship spec` funnel command — inventory + per-spec detail + the
    idea→spec→implemented rollup, `--json`, mirroring `drifted`.
  - **Web** specs page extended with the funnel + idea-state briefs.
  - **MCP** funnel tool (opted in despite the repo's caution that agents
    under-pick new MCP tools).

## Edge cases & non-goals

Edge cases:
- **Idea-only brief** (`spec:` unset or pointing at a non-existent spec) → shows
  as `idea` state, never dropped.
- **`spec:` names a REQ, not the doc** → resolve the REQ up to its parent
  document for the link; the funnel still attributes the brief to that doc.
- **Mismatched pointers** (brief.spec and spec.brief disagree) → drift-style
  warning, not a silent pick.
- **A brief that maps to a doc with other REQs** (e.g. REQ-SDD-004 in
  SDD-INSTALL-DOC) → the brief links to that REQ/doc without claiming the
  sibling REQs.
- **Malformed / missing brief frontmatter** → skipped gracefully, never fails
  the index of real specs.

Non-goals:
- Does NOT change how `/ss-brainstorm` writes briefs (frontmatter format
  unchanged).
- Briefs are **read-only in the graph** — indexed, not authored through it.
- Does NOT auto-create specs from briefs or vice versa.
- MUST NOT regress REQ/document/acceptance kind-inference for real spec files.

## Acceptance criteria

- After indexing, a `specs/<slug>/brief.md` appears in the graph as a
  `kind:'brief'` spec node (id `brief:<slug>`), discoverable via `specship_spec`
  / `getAllSpecs`.
- A brief whose `spec:` resolves (directly or via a REQ→document walk) is linked
  to that spec and reports `specified`; a brief with no resolvable spec reports
  `idea`.
- A one-sided or mismatched brief↔spec pointer surfaces as a drift-style warning
  rather than a silent link or a hard error.
- The `specship spec` CLI command lists every spec with its requirements rolled
  up by link-state, plus a funnel header counting ideas → specs → implemented /
  verified; `--json` emits the same data structured.
- The web specs page shows the funnel and renders idea-state briefs (briefs with
  no spec yet).
- An MCP funnel tool returns the idea→spec→implemented rollup.
- Re-indexing after editing a brief updates its node/state; deleting a brief
  removes it. Indexing a project with malformed brief frontmatter does not fail
  the indexing of valid spec files.
- REQ/document/acceptance extraction for existing spec files is unchanged
  (regression check).
