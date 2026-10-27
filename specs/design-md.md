---
id: DESIGNMD-DOC
title: design.md — a pixel-exact design reference any model can build from
owner: specship
priority: high
jira_issue_REQ-DESIGNMD-001: SSHIP-505
jira_fingerprint_REQ-DESIGNMD-001: 2c51f0660e896434
jira_issue_REQ-DESIGNMD-002: SSHIP-512
jira_fingerprint_REQ-DESIGNMD-002: bb0f2555dcb62a9a
jira_issue_REQ-DESIGNMD-003: SSHIP-516
jira_fingerprint_REQ-DESIGNMD-003: 798550d77f1ec806
jira_issue_REQ-DESIGNMD-004: SSHIP-520
jira_fingerprint_REQ-DESIGNMD-004: a5bd43554475df18
jira_issue_REQ-DESIGNMD-005: SSHIP-526
jira_fingerprint_REQ-DESIGNMD-005: 597809b713f36837
jira_issue_REQ-DESIGNMD-006: SSHIP-530
jira_fingerprint_REQ-DESIGNMD-006: 54e1eb80f99196a6
jira_issue_REQ-DESIGNMD-007: SSHIP-535
jira_fingerprint_REQ-DESIGNMD-007: 64c129bfac433d3d
jira_issue_REQ-DESIGNMD-008: SSHIP-543
jira_fingerprint_REQ-DESIGNMD-008: 38802f7a494f1e08
---

<!-- id: DESIGNMD-DOC -->
# design.md — a pixel-exact design reference any model can build from

A developer or business user hands SpecShip a Claude Design project or a Figma
file. Today the import keeps the raw snapshot and a `tokens.css`, and the spec
deliberately carries contract only (no hex, no pixels). A strong model can
re-derive the exact look from the raw HTML; a low-end model (Haiku, Gemini
Flash) cannot: it rounds values, invents near-miss colors, and misses hover and
focus states buried in a 2,000-line snapshot.

`design.md` closes that gap. It is one Markdown file per imported design, at
`specs/<slug>/design.md`, that states every visual value **verbatim** in a fixed
layout so an implementer looks a value up instead of inferring it. The values
are extracted **deterministically** by the CLI (`specship design extract`),
never transcribed by a model. A checker (`specship design check`) rejects a
design.md that is incomplete, stale, or vague. A shipped `design-md` skill
drives the import for both sources and keeps the file maintained as the design
changes. This follows the low-end-model rule (LOWEND-DOC): move work a cheap
model gets wrong out of the model and into deterministic code.

Non-goals: no screenshot pixel-diff of the built UI against the design (a later
visual-regression requirement). No calls to the Figma REST API of SpecShip's
own: Figma is read only through the Figma MCP server. No change to the spec's
contract-only rule: the spec still references tokens by name; design.md holds
the values. No Gemini CLI skill install: Gemini users get the same CLI commands.

<!-- id: REQ-DESIGNMD-001 -->
## The extractor MUST capture every literal visual value from a design source deterministically

`specship design extract <source...>` reads a design source and renders the
generated part of design.md. Supported sources: a Claude Design snapshot
(`.html`, plus the local stylesheets it links), standalone `.css`, a Figma code
export (`.tsx`/`.jsx`/`.html`), and a Figma variables export (`.json`).

implementations:
  - src/design-md/extract.ts:extractDesign
  - src/design-md/css.ts:parseCss
  - src/design-md/render.ts:renderGeneratedBlock

verifies:
  - __tests__/design-md.test.ts:customPropertiesAreCapturedVerbatim
  - __tests__/design-md.test.ts:emptyCustomPropertiesAreKept
  - __tests__/design-md.test.ts:rulesKeepStatesMediaAndKeyframes
  - __tests__/design-md.test.ts:outlineKeepsAllClassesAndAttributes
  - __tests__/design-md.test.ts:inlineStyleEntitiesAreDecoded
  - __tests__/design-md.test.ts:interElementSpaceIsKept
  - __tests__/design-md.test.ts:valueInventoriesCountUsage
  - __tests__/design-md.test.ts:extractionIsDeterministic
  - __tests__/design-md.test.ts:figmaSourcesContributeTokens
  - __tests__/design-md.test.ts:missingSourceFailsWithoutWriting

## Acceptance
<!-- id: REQ-DESIGNMD-001.A1 -->
- Every CSS custom property in the source's `<style>` blocks and linked local stylesheets is listed with its declaring selector, its name and its value exactly as written, including an empty value (`--x: ;`). (evidence: unit)
<!-- id: REQ-DESIGNMD-001.A2 -->
- Every style rule is listed verbatim under its selector, including pseudo-class state rules (`:hover`, `:focus-visible`, `:disabled`, `[aria-*]`), rules inside `@media` (with the media condition), `@keyframes` blocks. Each element's every class, rendering attributes (placeholder, value, alt, ARIA state, disabled/checked), inline `style=""` declarations and text sit on its line of the element outline, and each inline SVG's markup is written verbatim on its own outline line. (evidence: unit)
<!-- id: REQ-DESIGNMD-001.A3 -->
- Value inventories list each distinct color, font family, font size, font weight, line height, letter spacing, spacing length, radius, shadow, duration/easing and breakpoint with its usage count and the selectors that use it. (evidence: unit)
<!-- id: REQ-DESIGNMD-001.A4 -->
- Extracting the same source bytes twice produces byte-identical output. The only provenance it records is the source path and SHA-256, never a timestamp. (evidence: unit)
<!-- id: REQ-DESIGNMD-001.A5 -->
- A Figma variables export (a JSON object of name → value, nested groups flattened with `/`) becomes token rows. A Figma code export contributes its Tailwind arbitrary values (`bg-[#0F172A]`, `w-[320px]`) and inline style literals to the inventories. (evidence: unit)
<!-- id: REQ-DESIGNMD-001.A6 -->
- A missing or unreadable source exits non-zero, names the path, and writes nothing. (evidence: unit)

<!-- id: REQ-DESIGNMD-002 -->
## design.md MUST follow one fixed layout with a generated block and authored sections

A low-end model does best when every design reference has the same shape: the
same headings in the same order, a value always found in the same place.

implementations:
  - src/design-md/render.ts:renderDesignMd
  - src/design-md/render.ts:REQUIRED_SECTIONS

verifies:
  - __tests__/design-md.test.ts:newFileHasEveryRequiredSection
  - __tests__/design-md.test.ts:generatedBlockRecordsItsSource
  - __tests__/design-md.test.ts:fidelityRulesAreStated

## Acceptance
<!-- id: REQ-DESIGNMD-002.A1 -->
- A newly written design.md has these headings in order: Source, Fidelity rules, Screens & layout, Components & states, Interactions & motion, Responsive behaviour, Assets, Generated reference, Change log. (evidence: unit)
<!-- id: REQ-DESIGNMD-002.A2 -->
- The generated reference sits between `<!-- design-md:generated:start -->` and `<!-- design-md:generated:end -->` markers. Its first line records each source's project-relative path and SHA-256. (evidence: unit)
<!-- id: REQ-DESIGNMD-002.A3 -->
- The Fidelity rules section tells the implementer that the Generated reference is authoritative (structure exactly as the Element outline nests it; the outline wins over authored prose), to use every value verbatim, never round or approximate, to reuse a project token only when its value is exactly equal, and to add no CSS (resets, normalizers) the design does not have. (evidence: unit)

<!-- id: REQ-DESIGNMD-003 -->
## Re-extraction MUST keep design.md current without losing authored content

Designs change. Re-importing must update the values and show what moved, while
keeping the screen walkthroughs, state notes and decisions people wrote.

implementations:
  - src/design-md/maintain.ts:updateDesignMd
  - src/design-md/maintain.ts:diffInventories

verifies:
  - __tests__/design-md.test.ts:updateReplacesOnlyTheGeneratedBlock
  - __tests__/design-md.test.ts:updateLogsValueChanges
  - __tests__/design-md.test.ts:updateRefusesAFileWithoutMarkers

## Acceptance
<!-- id: REQ-DESIGNMD-003.A1 -->
- `extract --update <design.md>` replaces only the bytes between the generated markers. Every byte outside them is unchanged. (evidence: unit)
<!-- id: REQ-DESIGNMD-003.A2 -->
- When values changed, one dated Change log entry lists the custom properties and inventory values that were added, removed, or changed (old → new). When nothing changed, no entry is added and the file is byte-identical. (evidence: unit)
<!-- id: REQ-DESIGNMD-003.A3 -->
- `--update` on a file without the generated markers exits non-zero and leaves the file untouched. (evidence: unit)

<!-- id: REQ-DESIGNMD-004 -->
## The checker MUST fail a design.md that is incomplete, stale or vague

implementations:
  - src/design-md/check.ts:checkDesignMd
  - src/design-md/check.ts:runDesignCheckCli

verifies:
  - __tests__/design-md.test.ts:missingSectionIsAnError
  - __tests__/design-md.test.ts:vagueWordingIsAnError
  - __tests__/design-md.test.ts:uncoveredSourceValueIsAnError
  - __tests__/design-md.test.ts:changedSourceIsStale
  - __tests__/design-md.test.ts:cleanFilePasses

## Acceptance
<!-- id: REQ-DESIGNMD-004.A1 -->
- A missing required section, a section heading that appears twice, missing generated markers, or a required authored section left empty is an error. (evidence: unit)
<!-- id: REQ-DESIGNMD-004.A2 -->
- Approximate wording outside the generated block is an error naming the line: "approximately", "roughly", "about <number>", "~<number>", "similar to", "etc.", "TBD". (evidence: unit)
<!-- id: REQ-DESIGNMD-004.A3 -->
- When the recorded sources are readable, any color literal or custom property in them that is absent from the generated block is an error. (evidence: unit)
<!-- id: REQ-DESIGNMD-004.A4 -->
- A source whose SHA-256 differs from the recorded one is an error that names the `specship design extract --update` command to run. (evidence: unit)
<!-- id: REQ-DESIGNMD-004.A5 -->
- A complete, current, precise file exits 0. `--json` returns the findings as data. (evidence: unit)

<!-- id: REQ-DESIGNMD-005 -->
## The design-md skill MUST drive the import for Claude Design and Figma and ship with the install

implementations:
  - skills/design-md/SKILL.md
  - src/installer/targets/claude.ts:writeSkillsEntries

verifies:
  - __tests__/design-md.test.ts:skillShipsWithTheInstall
  - __tests__/design-md.test.ts:skillCoversBothSources
  - __tests__/design-md.test.ts:skillEndsOnAPassingCheck

## Acceptance
<!-- id: REQ-DESIGNMD-005.A1 -->
- `specship install` copies the `design-md` skill and its references into the Claude skills directory, and uninstall removes them. (evidence: unit)
<!-- id: REQ-DESIGNMD-005.A2 -->
- The skill reads a `claude.ai/design` link through the designer tools or a handoff bundle, and a `figma.com` link through the Figma MCP (design context, variables, screenshot, metadata), saving each source verbatim. When the needed MCP server is missing it gives the setup command and stops, and it never plain-fetches the link. (evidence: unit)
<!-- id: REQ-DESIGNMD-005.A3 -->
- The skill finishes only when `specship design check` passes on the file it wrote. (evidence: unit)

<!-- id: REQ-DESIGNMD-006 -->
## The design import and implement workflows MUST use design.md

implementations:
  - src/workflows/defaults/claude-design-implement.yaml
  - src/workflows/defaults/spec-implement.yaml
  - commands/specship/spec.md

verifies:
  - __tests__/design-md.test.ts:workflowsUseDesignMd
  - __tests__/design-md.test.ts:implementReadsDesignMd
  - __tests__/design-md.test.ts:specDesignRouteNamesDesignMd

## Acceptance
<!-- id: REQ-DESIGNMD-006.A1 -->
- The `claude-design-implement` workflow writes `specs/<slug>/design.md` with `specship design extract`, runs `specship design check`, and records `design:` in the spec frontmatter. (evidence: unit)
<!-- id: REQ-DESIGNMD-006.A2 -->
- The `spec-implement` workflow tells the implementer that when the spec frontmatter names a `design:` file, it reads that file before any UI edit and uses its values verbatim. (evidence: unit)
<!-- id: REQ-DESIGNMD-006.A3 -->
- `/specship:spec design` names design.md as the reference the implementer builds from. (evidence: unit)

<!-- id: REQ-DESIGNMD-007 -->
## A UI change MUST update its design.md in the same change

design.md is only trustworthy if it describes the UI that ships. When code
that a design-backed spec governs changes the UI, the same change records it
in that spec's design.md, and `specship postcheck` (which
`/specship:spec implement` runs) refuses to pass otherwise. A spec is
design-backed when its frontmatter names `design:`. The UI files it governs
are the UI-type files in its `implementations:` blocks, plus every UI file
changed while implementing that spec.

implementations:
  - src/design-md/upkeep.ts:checkDesignUpkeep
  - src/design-md/upkeep.ts:designBindings
  - src/spec-quality/postcheck.ts:checkDesign
  - src/workflows/defaults/spec-implement.yaml
  - skills/design-md/SKILL.md

verifies:
  - __tests__/design-md-upkeep.test.ts:uiChangeWithoutChangeLogFails
  - __tests__/design-md-upkeep.test.ts:uiChangeWithChangeLogPasses
  - __tests__/design-md-upkeep.test.ts:ownSpecCountsEveryUiFile
  - __tests__/design-md-upkeep.test.ts:staleOrVagueDesignMdFails
  - __tests__/design-md-upkeep.test.ts:nonUiOrUngovernedChangesAreIgnored
  - __tests__/design-md-upkeep.test.ts:postcheckRunsTheDesignGate
  - __tests__/design-md-upkeep.test.ts:implementWorkflowAndSkillSayKeepItCurrent

## Acceptance
<!-- id: REQ-DESIGNMD-007.A1 -->
- A change to a UI file named in a design-backed spec's `implementations:`, where that spec's design.md Change log is unchanged since the run base, is a postcheck failure that names the changed files and the design.md. (evidence: unit)
<!-- id: REQ-DESIGNMD-007.A2 -->
- The same change with a new Change log entry in the design.md passes. (evidence: unit)
<!-- id: REQ-DESIGNMD-007.A3 -->
- While implementing a design-backed requirement, a change to any UI file counts, even one not yet listed in `implementations:`. (evidence: unit)
<!-- id: REQ-DESIGNMD-007.A4 -->
- A touched design.md that fails `specship design check` (stale source, vague wording, missing section) is a postcheck failure, even with a new Change log entry. (evidence: unit)
<!-- id: REQ-DESIGNMD-007.A5 -->
- Changes to non-UI files, to UI files no design-backed spec governs, or in a project with no design-backed specs produce no design finding. (evidence: unit)
<!-- id: REQ-DESIGNMD-007.A6 -->
- `specship postcheck` runs this check and reports it. The `spec-implement` workflow tells the implementer to update design.md with the UI change, and the design-md skill tells anyone changing UI code to do the same. (evidence: unit)

<!-- id: REQ-DESIGNMD-008 -->
## A build MUST be verifiable against design.md's structure

The pixel eval's last miss was a builder slip, not missing information: a
small model closed a container one line early. `specship design verify`
catches that class of error mechanically. It extracts the built page's
element outline with the same extractor that wrote design.md and compares it
line by line, and checks that the stylesheet rules keep the design's cascade
order where it matters, so a builder can check its own work and fix it before
finishing.

implementations:
  - src/design-md/verify.ts:verifyBuild
  - src/design-md/verify.ts:compareOutlines
  - src/design-md/check.ts:runDesignVerifyCli
  - skills/design-md/SKILL.md

verifies:
  - __tests__/design-md.test.ts:verifyPassesAFaithfulBuild
  - __tests__/design-md.test.ts:verifyReportsMisnesting
  - __tests__/design-md.test.ts:verifyChecksRuleOrder
  - __tests__/design-md.test.ts:verifyIgnoresEquivalentDifferences
  - __tests__/design-md.test.ts:verifyCliExitCodes
  - __tests__/design-md.test.ts:skillVerifiesUntilItMatches

## Acceptance
<!-- id: REQ-DESIGNMD-008.A1 -->
- A build whose element outline equals design.md's Element outline passes with exit 0. (evidence: unit)
<!-- id: REQ-DESIGNMD-008.A2 -->
- A build with an element at the wrong nesting depth, or with a missing, extra or renamed element, class, attribute or text, fails with exit 1. The same applies to stylesheet rules in a different cascade order, but only when both rules write an overlapping property (shorthands included) with different values, on an element the design has that both match. The output names the first differing outline lines, or the inverted rule pair, with what was expected and what was built. (evidence: unit)
<!-- id: REQ-DESIGNMD-008.A3 -->
- Differences that render the same never fail, though they are reported as notes: SVG attribute order, a class attribute repeated on an SVG root, inline-style differences on an otherwise identical element, and edge spaces at the start or end of an element's content. An edge space next to a sibling element renders, so losing or adding one there fails. (evidence: unit)
<!-- id: REQ-DESIGNMD-008.A4 -->
- A design.md with no Element outline, or an unreadable build or design.md, exits non-zero with the reason. (evidence: unit)
<!-- id: REQ-DESIGNMD-008.A5 -->
- The design-md skill tells the builder to run `verify`, fix what it reports, and finish only when it matches. (evidence: unit)
