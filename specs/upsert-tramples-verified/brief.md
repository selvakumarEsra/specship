---
slug: upsert-tramples-verified
created: 2026-07-15
label: bug
---
# Spec re-extraction demotes verified links back to implemented

Editing a spec file (e.g. appending a new requirement) re-extracts every
requirement in the file, and `applyDeclarationCandidates` re-upserts each
`implementations:` declaration with `state: 'implemented'` — silently
trampling the sticky `verified` state on requirements whose own body did not
change. Observed 2026-07-15: adding REQ-JIRAPUB-009 to `specs/jira-publish.md`
demoted 13 verified REQ-JIRAPUB-001..008 links to `implemented` (verified
count 22 → 11). Sticky states should survive a declaration re-upsert when the
requirement's content hash is unchanged; a changed hash should go through the
normal drifted(spec) transition, never a silent reset.

## Grounding
- src/resolution/spec-link-resolver.ts:SpecLinkResolver.applyDeclarationCandidates
- src/db/spec-queries.ts:SpecQueries.upsertSpecLink
