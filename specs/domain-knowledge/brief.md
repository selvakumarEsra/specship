---
slug: domain-knowledge
spec: DOMAIN-DOC
created: 2026-06-26
---

# Brainstorm: Domain knowledge — capture, linking & a readable Domain page

## Problem

SpecShip captures **structure** (AST → the code graph) and **intent** (specs →
requirements with spec↔code links and drift). It does **not** capture **domain
semantics**: the project's ubiquitous language, business rules/invariants,
decisions, and constraints — the *why* behind the code that an AST can never
express. Two costs follow:

1. Claude Code works without the project's domain context, so it re-derives or
   guesses domain rules every session.
2. Nothing notices when code drifts away from a *stated* domain rule — there is
   no link from "captures must be idempotent" to the code that must uphold it.

We want a **human-confirmed domain-knowledge layer** that (a) is seeded from
existing material (specs + code graph), (b) is filled in by *asking the user
targeted questions* about what's undocumented, (c) links to specs (and through
them to code) so it inherits drift, and (d) is presented in the dashboard in a
**highly readable** format. The layer must align with SpecShip's deterministic,
trustworthy brand — the model may *propose*, but facts are only written on
**explicit human confirmation**; nothing is auto-extracted silently.

This brief covers **v1 only**. Industry-standard *modernization suggestions* and
*richer self-improvement* (learning from accept/reject, watching edit direction)
are deliberately deferred to follow-on specs.

## Code grounding

Found via `specship_explore`/`specship_search` and a direct dashboard survey.
The feature reuses existing primitives rather than inventing new machinery.

**Spec system (the backbone — domain facts ARE specs):**
- `src/types.ts` — `SPEC_KINDS`/`SpecKind` (already includes `brief`; **add
  `domain`**); `SpecLinkKind = implements|tests|validates|documents|depends_on`;
  `EdgeKind` already has `documents`/`validates`. `NodeKind` includes `spec`.
- `src/extraction/specs/markdown-spec-extractor.ts` — the only spec extractor:
  `parseFrontmatter`, `HEADING`/`ID_COMMENT` regex, `extractImplementationRefs`
  (`implementations:` block → `SpecLinkCandidate`, `kind='implements'`). The
  `type` tag would be parsed here from frontmatter.
- `src/db/spec-queries.ts` — `SpecQueries` (`insertSpec`/`insertSpecsBatch`,
  `upsertSpecLink`, `getLinksBy*`, `findLogicalLink`). `insertSpec` also projects
  one `nodes` row per spec: `id = spec:<specId>`, `kind='spec'`,
  `qualified_name=specId`, `language='unknown'`.
- `src/resolution/spec-link-resolver.ts` — `SpecLinkResolver`: re-resolves
  `spec_links` after sync and does **drift detection** (compares
  `node_sig_at_link` to current signature → `drifted`/axis `code`; vanished →
  `orphaned`; `STICKY_STATES={verified,broken}`). **Domain facts inherit this
  for free via their linked specs.**
- `src/index.ts` — wiring: `getSpecQueries()`, `getSpecLinkResolver()`,
  `getSpecFunnel()` (`computeSpecFunnel`).

**Storage (SQLite):**
- `specs` table — `id, kind, title, body, format, source_path, start/end_line,
  parent_id, content_hash, version, superseded_by, owner, priority,
  **metadata (JSON)**, created_at, updated_at`. The `type` tag
  (term|rule|decision|constraint) is a natural fit for **`metadata` JSON** (no
  new column needed), or a real column via `src/db/migrations.ts` (guarded
  `ALTER`, `hasColumn`) — spec-author to decide.
- `spec_links` table — carries `kind, state, drift_axis, provenance, confidence,
  metadata`. Linking is via `parent_id` (domain doc → child requirement) and/or
  `depends_on` links.
- `src/db/schema.sql` (+ `copy-assets` into `dist/`) — only touch if a new
  column/table is chosen.

**Gap-seed (what's undocumented):** read `nodes` of kind
`class|struct|interface|route|component` and `specs` that have **no** linked
`domain` fact → a coverage list. New read-only pass; could live in core
(library) or the server route.

**Capture command:** a new `/ss-domain` command (sibling of `/ss-brainstorm` and
`/ss-spec-author`) under `commands/`. Grounds via `specship_explore`, uses the
gap-seed to ask **per-type** questions, writes only human-confirmed facts as
markdown, links to spec(s).

**Dashboard UI (Angular, `packages/web-ng/`):**
- Pages are lazy-loaded standalone components (`.ts/.html/.scss`) under
  `src/app/pages/`; existing siblings: `specs/`, `drift/`, `improvements/`(tips).
- `src/app/app.routes.ts` — add a `domain` route.
- `src/app/shell/sidebar/sidebar.{ts,html}` — add the nav item.
- `src/app/api/types.ts` — `Spec.kind` union (`'document'|'requirement'|
  'acceptance'|'contract'|'data_schema'|'brief'`) **gains `'domain'`**;
  `SpecLink.state` already covers `drafted|implementing|implemented|verified|
  drifted|broken|orphaned`. Add a `DomainResponse` (facts grouped by type +
  coverage) type + an api service method.
- New page = **type-grouped readable cards** (see chosen UI below).

**Server (`packages/server/`):**
- New `GET /api/domain` route handler in `src/routes/` (mirror `claude.ts`/specs
  route shape — the tips engine already returns advice-shaped `Tip[]`
  `{severity,title,why,evidence,fix,saving}`, a useful precedent for later
  suggestion work).
- **Constraint (MEMORY):** `packages/server` must **never** runtime-`import`
  from the bare `@selvakumaresra/specship` package — it silently serves a stale
  build. Use server-local modules / the dynamic loader (`getSpecFunnel` is the
  pattern).

**MCP surfacing:** domain facts are `spec:` nodes, so `specship_explore` /
`specship_spec` already return them — **no new MCP tool** (the repo's
"adapt the tool to the agent, don't add tools the agent under-picks" rule).
Optionally one bullet in `src/mcp/server-instructions.ts`.

## Approaches considered

1. **A — Graph-native domain layer.** Mint `domain` concept *nodes* + new edges
   to code/specs, auto-seeded from code. *Trade-off:* deepest and most automatic,
   but auto-extracting "concepts" is fuzzy — the interpretive guessing SpecShip's
   deterministic brand avoids; high risk of polluting the graph.
2. **B — Spec-native knowledge base + elicitation loop.** Domain knowledge is a
   first-class `domain` *spec-kind*, authored through a grounded interview that
   captures **human-confirmed** facts linked to specs. *Trade-off:* reuses the
   strongest primitive (specs + drift + funnel), keeps quality/brand; less
   "automatic magic" and the interview quality is the hard part.
3. **C — Insight/suggestion engine first.** Extend the tips engine to mine
   specs+graph for gaps + modernization suggestions. *Trade-off:* fastest visible
   value on a proven shape; but reactive, not a durable knowledge base.

**Chosen: B as the backbone, with C's *minimal gap-seed* folded into v1; A
deferred.** B reuses SpecShip's spec↔code+drift machinery and keeps writes
human-confirmed (on-brand). The minimal gap-seed makes the v1 interview
*targeted* ("you have a `Payment` entity — what are its rules?") instead of
generic, without building the full insight/tips engine. A (auto concept-graph)
is deferred until enough human-confirmed content exists to bootstrap it safely.

## Key decisions

- **Linking tier — spec-tier only** (`domain → spec → code`). A domain fact hangs
  off one or more specs; code linkage and drift are **inherited** through the
  spec's existing `implements` links. No direct domain→code links in v1 (less
  noise, reuses 100% of drift machinery). Gaps surface as "concept with no spec."
- **Fact shape — one `domain` spec-kind with a `type` tag**: `term` (glossary),
  `rule` (business rule/invariant), `decision` (ADR-style: decision + rationale +
  alternatives), `constraint` (regulatory/security/perf bound). The interview
  tailors its questions per type.
- **Invocation — hybrid, never silent auto-write:** (1) automated **detection**
  (gap-seed on sync, passive — surfaces questions, writes nothing); (2) ad-hoc
  **capture** via `/ss-domain` interview, the dashboard, or direct markdown edit
  (re-synced); (3) model may **propose**, facts land only on human confirmation.
- **UI — dedicated "Domain" dashboard page, type-grouped readable cards.** A
  coverage strip (`N documented · M gaps`); per-type sections; each fact a
  readable card = statement/body + `governs <spec> → <code>` + verify/drift chip
  + a **Review** action when drifted + a **+ Capture** button. (Chosen over a
  reading-only handbook and over folding into the Specs page — see UI mock in the
  brainstorm; the card view balances readability with surfacing link/drift state.)
- **Self-improve (v1, minimal) = drift.** When linked code changes, the fact's
  chain flips `drifted` and re-prompts review. Richer self-improvement is a
  follow-on.
- **Decomposition:** this spans core + server + UI, so spec-author may write it as
  a **spec set** (a domain doc-spec with child requirements) rather than one REQ.

## Edge cases & non-goals

**Edge cases the spec must resolve:**
- A fact captured **before its spec exists** → an `unlinked`/`proposed` state;
  shows as a gap; allowed (don't block capture on a spec existing).
- `type` stored in `specs.metadata` JSON vs a dedicated column (migration via
  `migrations.ts`) — pick one.
- **Coverage metric** denominator: what set of entities/specs counts as the
  "documentable" universe for `N documented · M gaps`.
- **Drift axis** for a domain fact: body/rule text changed (`spec` axis) vs the
  linked code changed (`code` axis) — reuse `drift_axis`.
- ID scheme for domain facts (e.g. `DOM-PAYMENT-001` vs reusing the REQ scheme).
- Where the markdown lives (e.g. `specs/domain/`), so `specship sync` picks it up.

**Non-goals (explicit — each a likely follow-on spec):**
- Full gap-detection **insight/tips engine** (severity, evidence, dashboard tips
  card beyond the simple coverage list).
- **Industry-standard / modernization suggestions.**
- **Model auto-extraction at scale** (v1 capture is human-driven via interview).
- **Direct domain→code links** (we chose spec-tier only).
- **Auto concept-graph** (Approach A).

## Acceptance criteria

1. A `domain` spec-kind (with `type` ∈ {term,rule,decision,constraint}) **parses,
   stores, and round-trips** through `specship sync`, and is projected as a
   `spec:` node.
2. A **gap-seed** surfaces code entities (`class|struct|interface|route|
   component`) and specs that have **no** linked domain fact.
3. **`/ss-domain`** runs an interview grounded in the repo (via
   `specship_explore`), targets gaps, and writes a **human-confirmed**,
   spec-linked domain fact (manual markdown authoring also works and re-syncs).
4. A captured fact **surfaces in `specship_explore`/`specship_spec`** for the
   linked spec/code, with **no new MCP tool** added.
5. The **dedicated Domain dashboard page** renders facts **grouped by type** with
   a coverage strip and verify/drift chips, each card showing what it governs
   (spec → code) and linking through to the spec/code.
6. Changing the linked code flips the fact's chain to **`drifted`** and it appears
   in the drift queue and as a **Review** affordance on the Domain page.
7. No regression to existing spec parsing, sync, drift, or the specs/drift pages;
   `packages/server` adds the `/api/domain` route **without** bare-importing the
   `@selvakumaresra/specship` package.
