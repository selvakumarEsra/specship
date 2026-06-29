---
id: DOMAIN-DOC
title: Domain knowledge layer
owner: core
priority: high
version: 1
brief: domain-knowledge/brief.md
---

<!-- id: DOMAIN-DOC -->
# Domain knowledge layer

SpecShip captures **structure** (the AST-derived code graph) and **intent**
(specs, with spec↔code links and drift). It does not capture **domain
semantics** — the project's ubiquitous language, business rules/invariants,
decisions, and constraints — so Claude Code re-derives domain rules every
session and nothing notices when code drifts away from a *stated* rule.

This document specifies a **domain-knowledge layer**: human-confirmed domain
facts, authored as a new `domain` spec-kind, linked to requirement specs (and
through them to code so they inherit drift), seeded by detecting what is
undocumented, captured through a targeted interview, and presented in the
dashboard in a readable, type-grouped view.

The governing principle — shared with the reflection engine (`REFLECT-DOC`) — is
**propose, never auto-apply**: the system may detect gaps and draft facts, but a
domain fact reaches disk only on **explicit human confirmation**. Nothing is
auto-extracted silently; this keeps the layer aligned with SpecShip's
deterministic, trustworthy brand.

**Linking is spec-tier only** in this version: a domain fact links to specs, and
code linkage plus drift are inherited through the spec's existing `implements`
links. **Non-goals** (each a likely follow-on document): a full
gap-detection/insight tips engine, industry-standard *modernization* suggestions,
model auto-extraction at scale, direct domain→code links, and an auto concept
graph.

<!-- id: REQ-DOMAIN-001 -->
## The system MUST support a `domain` spec-kind with a typed fact tag

SpecShip MUST recognize a new spec kind, `domain`, parsed from Markdown under
`specs/domain/`. Each domain fact declares a `type` of exactly one of `term`,
`rule`, `decision`, or `constraint` in its frontmatter; the parser MUST store
that `type` in the spec's existing `metadata` JSON (no new column), persist the
fact in the `specs` table with `kind='domain'`, and project it as a `spec:` node
like every other spec. Domain facts use a dedicated `DOM-<AREA>-NNN` ID scheme,
distinct from `REQ-` requirements. Re-running `specship sync` over an unchanged
fact MUST be idempotent.

implementations:
  - src/types.ts:SpecKind
  - src/extraction/specs/markdown-spec-extractor.ts:parseFrontmatter
  - src/db/spec-queries.ts:SpecQueries.insertSpec

## Acceptance
<!-- id: REQ-DOMAIN-001.A1 -->
- A Markdown file under `specs/domain/` with frontmatter `id: DOM-PAY-001`,
  `kind`/heading resolving to a domain fact, and `type: rule` parses without
  `spec_missing_id` or `spec_bad_frontmatter`, producing a `specs` row with
  `kind='domain'` and `metadata.type='rule'`.
<!-- id: REQ-DOMAIN-001.A2 -->
- The same fact is projected as a node `id='spec:DOM-PAY-001'`, `kind='spec'`,
  and is returned by `specship_search`/`specship_explore`.
<!-- id: REQ-DOMAIN-001.A3 -->
- A `type` value outside `{term, rule, decision, constraint}` still indexes the
  fact but emits a parse **warning** identifying the unknown type — the fact is
  never silently dropped.
<!-- id: REQ-DOMAIN-001.A4 -->
- A second `specship sync` with no file change leaves the fact's `content_hash`
  and row unchanged (idempotent round-trip).

<!-- id: REQ-DOMAIN-002 -->
## Domain facts MUST attach only at the spec tier, never directly to code

A domain fact MUST attach to one or more requirement specs via the existing
`parent_id` / `depends_on` linking, and MUST NOT create direct domain→code links
in this version. Its code association and drift state are inherited transitively
through the linked spec's `implements` links, re-resolved by `SpecLinkResolver`
after each sync. A domain fact captured before any linkable spec exists MUST be
allowed and represented as unlinked/proposed (a gap), never as a parse error.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver
  - src/db/spec-queries.ts:SpecQueries.upsertSpecLink

## Acceptance
<!-- id: REQ-DOMAIN-002.A1 -->
- A domain fact with a `depends_on` link to `REQ-PAY-004` surfaces that
  requirement's resolved code links transitively in `specship_spec` output.
<!-- id: REQ-DOMAIN-002.A2 -->
- When code linked to `REQ-PAY-004` changes signature, the domain fact's chain
  reflects `drifted` in the drift queue (inherited, with no domain-specific
  drift mechanism added).
<!-- id: REQ-DOMAIN-002.A3 -->
- A domain fact with no spec link indexes successfully and is reported as a gap
  (unlinked/proposed), not an error.

<!-- id: REQ-DOMAIN-003 -->
## The system MUST surface a gap-seed of undocumented entities and specs

SpecShip MUST provide a read-only pass **in the core library** that lists the
code entities — nodes of kind `class`, `struct`, `interface`, `route`, or
`component` — and the specs that have **no** linked domain fact, plus a coverage
rollup of `{documented, gaps}` measured over that combined universe of entities
**and** specs. This pass writes nothing; it exists to target the capture
interview and to drive the dashboard coverage strip.

implementations:
  - src/index.ts:SpecShip

## Acceptance
<!-- id: REQ-DOMAIN-003.A1 -->
- Given a repo containing `class Payment` with no domain fact referencing it,
  the gap-seed result includes `Payment`.
<!-- id: REQ-DOMAIN-003.A2 -->
- An entity that already has a linked domain fact is excluded from the gap list.
<!-- id: REQ-DOMAIN-003.A3 -->
- The pass returns a coverage rollup of `{documented, gaps}` whose denominator is
  the union of in-scope code entities (class/struct/interface/route/component)
  and specs, and performs no writes.

<!-- id: REQ-DOMAIN-004 -->
## The `/ss-domain` capture command MUST write only human-confirmed facts via a grounded, targeted interview

A new `/ss-domain` command MUST ground in the repo via `specship_explore`, use
the gap-seed to ask **per-type**, targeted questions about undocumented
entities/specs, and write a domain fact under `specs/domain/` **only after
explicit human confirmation** — consistent with the propose-never-auto-apply
principle. Manual authoring of an equivalent Markdown file MUST be a first-class
alternative that produces the same indexed result after `specship sync`.

implementations:
  - commands/ss-domain.md

## Acceptance
<!-- id: REQ-DOMAIN-004.A1 -->
- Running `/ss-domain` through to the end without an explicit confirmation
  writes zero files.
<!-- id: REQ-DOMAIN-004.A2 -->
- On explicit confirmation, it writes a well-formed domain fact under
  `specs/domain/` linked to the chosen spec, that indexes cleanly.
<!-- id: REQ-DOMAIN-004.A3 -->
- Hand-creating the same domain Markdown file and running `specship sync`
  yields an equivalent indexed fact (command and manual authoring converge).
<!-- id: REQ-DOMAIN-004.A4 -->
- The interview's questions reference specific gap-seed entities/specs rather
  than generic "describe your domain" prompts.

<!-- id: REQ-DOMAIN-005 -->
## Domain facts MUST surface to the agent through existing tools, with no new MCP tool

Because domain facts are `spec:` nodes, they MUST be returned by the existing
`specship_explore` and `specship_spec` tools; the feature MUST NOT add a new MCP
tool (per the project rule that agents under-pick new tools). At most, a single
pointer MAY be added to the MCP server instructions.

implementations:
  - src/mcp/server-instructions.ts:SERVER_INSTRUCTIONS

## Acceptance
<!-- id: REQ-DOMAIN-005.A1 -->
- `specship_spec` on a requirement returns its linked domain facts.
<!-- id: REQ-DOMAIN-005.A2 -->
- `specship_explore` naming a documented domain term or entity includes the
  domain fact body in its output.
<!-- id: REQ-DOMAIN-005.A3 -->
- The MCP tool list is unchanged in count — no new tool name is registered.

<!-- id: REQ-DOMAIN-006 -->
## The dashboard MUST present a dedicated Domain page with type-grouped readable cards

The desktop UI MUST add a **Domain** page (route + sidebar entry)
that renders domain facts grouped into `Terms`, `Rules`, `Decisions`, and
`Constraints` sections. A coverage strip MUST show `documented · gaps`. Each fact
MUST render as a readable card showing its statement/body, what it governs
(linked spec → code), and a verify/drift state chip; a drifted fact MUST expose a
**Review** affordance and a **Capture** action MUST be available. The UI `Spec`
kind union MUST gain `'domain'`.

implementations:
  - packages/web-ng/src/app/pages/domain/domain.ts
  - packages/web-ng/src/app/app.routes.ts:routes
  - packages/web-ng/src/app/shell/sidebar/sidebar.ts
  - packages/web-ng/src/app/api/types.ts:Spec

## Acceptance
<!-- id: REQ-DOMAIN-006.A1 -->
- Navigating to `/domain` renders facts grouped under `Terms` / `Rules` /
  `Decisions` / `Constraints` headings.
<!-- id: REQ-DOMAIN-006.A2 -->
- The coverage strip shows documented vs. gap counts that match the gap-seed.
<!-- id: REQ-DOMAIN-006.A3 -->
- A drifted fact shows a drift chip and a Review affordance; a verified fact
  shows a verified chip.
<!-- id: REQ-DOMAIN-006.A4 -->
- Each card links through to its linked spec and code symbol.
<!-- id: REQ-DOMAIN-006.A5 -->
- An empty domain layer renders an empty state that prompts capture, without
  errors.

<!-- id: REQ-DOMAIN-007 -->
## The server MUST expose `GET /api/domain` without bare-importing the package

The dashboard server MUST add a `GET /api/domain` route returning domain facts
grouped by type plus the coverage rollup. The handler MUST NOT runtime-import the
bare `@specship/specship` package (which silently serves a stale build);
it MUST use server-local modules or the dynamic loader. Existing routes MUST keep
working.

implementations:
  - packages/server/src/routes/domain.ts

## Acceptance
<!-- id: REQ-DOMAIN-007.A1 -->
- `GET /api/domain` returns `200` with a payload of facts grouped by type and a
  `{documented, gaps}` coverage rollup.
<!-- id: REQ-DOMAIN-007.A2 -->
- The route module contains no `import … from '@specship/specship'`
  runtime import.
<!-- id: REQ-DOMAIN-007.A3 -->
- Existing `/api/specs` and `/api/claude/tips` responses are unchanged
  (no regression).

<!-- id: REQ-DOMAIN-008 -->
## The Domain page MUST show each fact's governed spec and live inherited state

`GET /api/domain` MUST enrich every returned fact with the requirement spec(s) it
governs (its `depends_on` / `parent_id` targets) and the inherited code-link
state derived from the linked spec's `implements` links (`verified` / `drifted` /
`broken` / `none`). The dashboard Domain page MUST render, per card, a
`governs <spec> → <symbol>` reference and a state chip reflecting that inherited
state, and MUST expose the **Review** affordance when the inherited state is
`drifted`. A fact whose linked spec resolves to code MUST NOT display
"No linked code yet".

implementations:
  - packages/server/src/routes/domain.ts
  - packages/web-ng/src/app/pages/domain/domain.ts

## Acceptance
<!-- id: REQ-DOMAIN-008.A1 -->
- `GET /api/domain` returns, for each fact, its governed spec id(s) and an
  inherited link state (one of `verified` / `drifted` / `broken` / `none`).
<!-- id: REQ-DOMAIN-008.A2 -->
- A domain fact whose `depends_on` spec resolves to `verified` code shows a
  `verified` chip and a `governs <spec> → <symbol>` reference on its card — not
  "No linked code yet".
<!-- id: REQ-DOMAIN-008.A3 -->
- A domain fact whose inherited code has `drifted` shows a `drifted` chip and the
  **Review** affordance.
<!-- id: REQ-DOMAIN-008.A4 -->
- A fact with no resolvable linked spec still renders without error, shown as
  unlinked ("No linked code yet").
