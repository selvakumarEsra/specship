---
id: DOCS-DRIFT-DOC
title: Docs are generated or gated — never silently stale
owner: specship
priority: medium
---

<!-- id: DOCS-DRIFT-DOC -->
# Docs are generated or gated — never silently stale

The `site/` Starlight docs have shipped fictional commands (a `specship
claude` CLI, removed installer targets, removed tools) inherited from
aspirational upstream content — for a product whose thesis is detecting
contract-vs-code drift, its own docs drifting is self-refuting. Decision
(2026-07-11 product review, Q10): reference material is generated from
source so drift becomes a build failure; narrative pages are gated by the
product's own drift detection.

<!-- id: REQ-DOCSD-001 -->
## Reference docs MUST be generated from source at site build

The CLI command/flag reference (from the commander program), the MCP tool
list (from the tool registry), the `SPECSHIP_*` env var table, and the
supported language/framework matrix are emitted by a generation step into
the site's reference pages. Hand-edited copies of these facts are removed.

implementations:
  - scripts/generate-reference-docs.mjs:cliCommandsBlock
  - scripts/generate-reference-docs.mjs:mcpToolsBlock
  - scripts/generate-reference-docs.mjs:envVarsBlock
  - scripts/generate-reference-docs.mjs:languagesBlock

## Acceptance
<!-- id: REQ-DOCSD-001.A1 -->
- Adding a CLI subcommand or MCP tool changes the generated reference on the
  next site build with no manual doc edit.
<!-- id: REQ-DOCSD-001.A2 -->
- The generated pages carry a "generated — do not edit" marker.

<!-- id: REQ-DOCSD-002 -->
## The site build MUST fail on reference drift

If a generated page in the working tree differs from a fresh generation
(stale committed output), or generation fails, the site build fails — a
doc'd command that doesn't exist can no longer publish.

## Acceptance
<!-- id: REQ-DOCSD-002.A1 -->
- Removing a CLI subcommand without regenerating the committed reference
  fails the site build/check.

<!-- id: REQ-DOCSD-003 -->
## Narrative doc pages MUST be drift-gated by the spec layer

Feature narrative pages declare which spec they document (page ↔ spec
assertion). CI runs the drift gate so a page whose feature's spec moved to
`drifted`/`broken` surfaces in the queue like any other stale contract.
[needs review: assertion syntax for a docs page — frontmatter `spec:` key
on the Starlight page vs an `implementations:`-style pointer in the spec.]

## Acceptance
<!-- id: REQ-DOCSD-003.A1 -->
- A narrative page's spec going drifted appears in the drift queue with the
  page identified as the stale surface.

<!-- id: REQ-DOCSD-004 -->
## One-time purge of remaining aspirational content

A single audit pass verifies every claim in `site/` against `src/` and
removes or corrects content describing features that do not exist in the
current build. Completion is recorded in the changelog.

## Acceptance
<!-- id: REQ-DOCSD-004.A1 -->
- Following any install/usage instruction on the published site succeeds
  against the current release (no fictional commands or tools remain).
