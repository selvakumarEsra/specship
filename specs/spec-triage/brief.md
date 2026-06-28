---
slug: spec-triage
spec: TRIAGE-DOC
created: 2026-06-28
---

# Brainstorm: Spec triage — route a fix/enhancement prompt to the right existing spec and add to it

## Problem
When a user has a small change — a bug to fix, an error log, or a one-line
enhancement — the spec-driven flow today only offers "author a new spec"
(`/ss-spec-author`, `/ss-brainstorm`). Nothing helps them *find the existing
spec the change belongs to and extend it*. The result is spec sprawl (a new doc
per tweak) or, worse, the change ships with no spec at all. We want a front door
that takes a short prompt and routes it to the right existing spec, appending a
requirement or acceptance criterion — and only falls back to a new spec when
nothing fits.

## Code grounding
- **Spec retrieval substrate exists, but spec-text search is NOT surfaced.**
  Specs are indexed into an FTS5 table `specs_fts` (id/title/body) via the spec
  layer migration. `SpecQueries` (`src/db/spec-queries.ts`) has `getAllSpecs`,
  `getSpecById`, `getSpecsByKind`, `getSpecsByParent`, `getLinksBySpec`,
  `getLinksByNode`, `upsertSpecLink`. The MCP `specship_search` searches *code
  nodes*, not specs; `specship_spec` (`src/mcp/spec-tools.ts:handleSpecshipSpec`)
  does funnel (no arg) or detail (by id) only — there is **no prose spec
  search**. That's the one genuinely-missing primitive.
- **Error-log → code → spec path mostly already works.** A trace names a
  `file:line`/symbol → `specship_explore`/`specship_search` → `specship_node`,
  which already renders a node's linked specs (`renderLinkedSpecsForNode`,
  `getLinksByNode`). So error-log routing can reuse existing tools.
- **Appending is established.** Spec files are markdown with `<!-- id: REQ-X -->`
  markers; acceptance criteria are `<!-- id: REQ-X.A<N> -->` bullets
  (`src/extraction/specs/markdown-spec-extractor.ts`). The `spec-author` skill
  already "appends new REQs to an existing file." `link_assert`
  (`handleSpecshipLinkAssert`) ties a new REQ to code after implement.
- **`/ss-fix` is NOT this.** `commands/ss-fix.md` repairs a *drifted/broken
  link* for a known SPEC_ID (the `spec-fix` workflow). This intake flow is new.
- Likely files touched: `src/mcp/spec-tools.ts` (add a `query` mode to
  `specship_spec`), `src/db/spec-queries.ts` (an FTS-backed `searchSpecs`),
  a new `commands/ss-triage.md` skill, and the spec-author append path.

## Approaches considered
1. **Retrieval primitive + orchestrating skill** — surface spec-text search as a
   deterministic primitive, a thin skill orchestrates match → preview → append.
   SpecShip does retrieval, the agent does matching/authoring, the human gates.
2. **One opinionated `specship_triage` MCP tool** — bakes prompt→ranked-spec
   matching into SpecShip. Turnkey but fuzzy prose-matching heuristics live in
   the tool, hard to tune, risks confidently routing to the wrong spec.
3. **Pure skill, no new code** — uses only existing tools + judgment. Zero new
   code, but with no surfaced spec-text search, prose-only prompts match weakly.

**Chosen: 1 (retrieval primitive + skill)** — the only missing piece is genuinely
a retrieval primitive (spec-text search); the rest is orchestration. Matches
SpecShip's grain ("adapt the tool to the agent": give the agent better
retrieval, don't build a new matching agent) and its human-gated-write ethos.

## Key decisions
- **Surface:** spec-text search is a **`query` mode on the existing
  `specship_spec`** tool (no arg = funnel, id = detail, query = search over
  `specs_fts`) — no new tool, better adoption. Plus a **new `/ss-triage
  <prompt>` slash command** that runs the full intake → match → preview → append
  flow.
- **Routing by input type:** *enhancement* (prose) → spec query → new **REQ**
  under the matched document; *bug* (prose, ± symbol) → query + code→spec → new
  **acceptance criterion** on the owning requirement; *error log* → parse
  `file:line`/symbol → `specship_explore`/`specship_node` → owning REQ → new
  **acceptance criterion** (regression guard).
- **Write is human-gated:** preview the exact diff (target file + the REQ or
  `.A<N>` block to insert) → `[confirm] / [edit] / [new spec instead] /
  [cancel]` → append via spec-author's append path. Mirrors the reflection-engine
  apply gate.
- **Granularity:** a distinct new concern → a new REQ; a bug/regression an
  existing requirement should have covered → a new acceptance criterion on that
  REQ (keeps its existing code links intact).
- **No confident match:** show the top (weak) candidates + a clear verdict, then
  offer to route to `/ss-spec-author` (or `/ss-brainstorm`), append-anyway, or
  cancel. Never auto-create a spec.

## Edge cases & non-goals
- **Confidence:** the primitive returns *ranked* candidates (FTS rank, optionally
  blended with the code→spec hit for error logs); the skill applies judgment + a
  weak-match floor that triggers the no-match path. SpecShip does not itself
  decide "this is the spec" — it ranks; the human confirms.
- **Empty index / no specs:** the flow reports "no specs to search — author one"
  and routes to `/ss-spec-author`, not an error.
- **Ambiguous match (several close candidates):** present the top N for the
  human to pick rather than auto-choosing.
- **Append idempotency / well-formedness:** the appended REQ/criterion must carry
  a valid `<!-- id: -->` marker and index cleanly (`specship sync` must not
  error); a duplicate-looking append should be flagged, not silently doubled.
- **Non-goals:** not auto-*fixing* the bug (that's `/ss-implement`); not
  rewriting an existing requirement's normative prose in place; not a new
  matching agent (retrieval + skill only); not extending `/ss-fix` (link-repair).

## Acceptance criteria
- `specship_spec` accepts a `query` argument and returns ranked existing specs
  (id, title, kind, snippet) matched over `specs_fts`; no-arg and id behavior are
  unchanged.
- `/ss-triage <prompt>` classifies the input (bug / error log / enhancement),
  retrieves candidate specs (prose via the query mode; error logs via the
  code→spec path), and presents a ranked match with a recommended action.
- On a confident match, the flow previews the exact change (target spec file +
  the new REQ or `.A<N>` block) and writes it only after explicit confirmation;
  `[edit]`, `[new spec instead]`, and `[cancel]` are offered.
- An enhancement appends a new requirement under the matched document; a
  bug/error-log appends a new acceptance criterion on the owning requirement.
- The appended requirement/criterion indexes cleanly (`specship sync` reports no
  spec error) and is ready for `/ss-implement` + `link_assert`.
- When no candidate clears the match floor, the flow states "no confident match",
  shows the weak candidates, and offers `/ss-spec-author` / append-anyway /
  cancel — it never auto-creates a spec.
