---
name: design-md
description: Turn a Claude Design project (claude.ai/design link or handoff bundle) or a Figma file (figma.com link) into specs/<slug>/design.md, a pixel-exact design reference that even a small model (Haiku, Gemini Flash) can build the UI from without guessing. Use this when someone shares a design to build or update, asks to "capture", "document" or "import" a design, or the design changed and design.md must catch up. Also use it to implement UI from an existing design.md.
---

# design.md: a pixel-exact design reference

design.md is one Markdown file per design, at `specs/<slug>/design.md`. It
states every visual value **verbatim** in a fixed layout, so whoever builds the
UI looks a value up instead of inferring it. A small model given the raw design
rounds `13.5px` to `14px`, swaps `#5B93F2` for "blue-500", and forgets the
hover state. Given design.md, it doesn't have to decide anything.

There are two halves, and the split is the point:

- **Values come from code, not from you.** `specship design extract` reads the
  source and writes the *Generated reference*: every custom property, color,
  font, size, spacing, radius, shadow, transition, breakpoint and style rule,
  verbatim, with usage counts. **Never type a value into design.md yourself.**
  Copy it from the generated block, which copied it from the source.
- **Structure comes from you.** You write the *authored* sections (screens,
  components and states, motion, responsive, assets). They explain how the
  values assemble, and they cite selectors and values from the generated block.

`specship design check` decides when you're done. It fails on a missing
section, an empty authored section, approximate wording, a stale source, or a
source value missing from the reference.

## The loop

### 1. Capture the source verbatim

Pick a slug from the design's name (kebab-case). Save everything under
`specs/<slug>/`. Read `references/sources.md` for each source's exact steps:

| The user gave you | Capture with | Save as |
|---|---|---|
| `claude.ai/design/...` link | designer tools: `designer_session` → `designer_snapshot` | `snapshot.html` + every local stylesheet it links |
| a designer handoff bundle (`handoff-<ts>/`) | copy from `project/` (no fetch) | `snapshot.html` + linked CSS, decision record into `source.md` |
| `figma.com/design/...` link | Figma MCP: `get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot` | `figma/<frame>.tsx`, `figma/variables.json`, `figma/<frame>.png`, `figma/metadata.xml` |
| exported HTML/CSS files | copy as-is | keep the file names |

Hard rules:
- **Never plain-fetch a design link.** A `claude.ai/design` URL returns a
  1 KB loader shell, and a Figma URL returns a login page. If the tools
  are missing, stop and give the setup step:
  - designer tools: run `designer setup` once.
  - Figma MCP: `claude mcp add --transport http figma https://mcp.figma.com/mcp`.
- Save tool output **byte for byte**. Don't reformat, summarise or "clean up"
  a snapshot.

### 2. Extract

```bash
specship design extract specs/<slug>/snapshot.html \
  --out specs/<slug>/design.md --title "<Design name>" --origin "<the link>"
```

For Figma, pass the captured files instead:

```bash
specship design extract specs/<slug>/figma/<frame>.tsx specs/<slug>/figma/variables.json --out ...
```

If the generated block says **Missing linked stylesheet**, capture that file
next to the snapshot and run extract again with `--update`. The reference is
incomplete until then.

### 3. Write the authored sections

Fill **Screens & layout**, **Components & states**, **Interactions & motion**,
**Responsive behaviour** and **Assets**. `references/authored-sections.md`
gives the exact shape of each, with an example. The rules:

- Every number, color and font you write must appear in the Generated
  reference (or Figma `metadata.xml` for frame sizes). Cite the selector:
  "Card padding `16px 20px` (`.card`)".
- Name every state the source styles: `:hover`, `:focus-visible`, `:active`,
  `:disabled`, `[aria-*]`, `.is-*` classes. For each one, list the values
  that change.
- Look at the screenshot or rendered snapshot for order, alignment and
  grouping. Only the generated block gives you the numbers.
- No approximate words: approximately, roughly, about 12, ~12, similar to,
  etc., TBD. `check` rejects them. If the source doesn't say, write
  "Not specified in the design; ask the designer" rather than inventing a value.
- Delete each `<!-- design-md: … -->` hint once its section is written.

### 4. Check until clean

```bash
specship design check specs/<slug>/design.md
```

Fix every error and run it again. **You are finished only when it passes.**

### 5. Connect it to the spec

Add `design: specs/<slug>/design.md` to the frontmatter of the spec that
covers this UI. `/specship:spec implement` then has the implementer read
design.md before any UI edit. The spec keeps the contract (behaviour,
accessibility, data). design.md keeps the pixels. Never copy values into the
spec.

## When the design changes

Capture the new source over the old files (step 1), then:

```bash
specship design extract <same sources> --update specs/<slug>/design.md
```

Only the generated block is replaced. Your authored sections are kept, and a
dated **Change log** entry lists every token and value that was added, removed
or changed (`old → new`). Go through that entry and update each authored
sentence that cites a changed value. Then run `check` again.

## When code changes the UI

design.md describes the UI that ships, so it changes in the same commit as
the UI code. That applies to a new component, a changed state, layout or
token, and a copy change.

1. Update the authored sections that describe what moved.
2. Add a dated line under **Change log**: what changed and the requirement
   id. For example, `- 2026-10-27: Sign In button gains a loading state
   (REQ-AUTH-004).`
3. If the design source changed too (a new snapshot or Figma export), run
   `specship design extract <sources> --update <design.md>` first. Only the
   generated block is replaced, and the value changes are logged for you.
4. Run `specship design check <design.md>`.

`specship postcheck` enforces this, and `/specship:spec implement` runs it.
The check fails if a change touches UI files that a design-backed spec
governs, but that spec's design.md gets no new Change log entry, or no
longer passes `check`. A spec is design-backed when its frontmatter has
`design:`. The UI files it governs are the `.tsx`/`.jsx`/`.vue`/`.svelte`/
`.css`/`.html` files in its `implementations:` blocks. While you implement
that spec, every UI file you change counts.

## Building UI from design.md

This applies to you, or to any implementer you brief:

1. Read design.md top to bottom once: Fidelity rules first.
2. Rebuild the **Element outline** element by element: same nesting, each
   element's inline style exactly, text exactly, and each `svg … = <svg …>`
   pasted as is. For class selectors, use the declarations in **Style rules
   (verbatim)** exactly. Use the **Design tokens** table to keep
   `var(--…)` names when the project's stack supports CSS variables.
3. Reuse a project token only when its value is exactly equal. Otherwise add
   the value as written.
4. Build every state in **Components & states**, and every breakpoint in
   **Responsive behaviour**.
5. Add no CSS the design doesn't have. No resets, no normalizers, no
   `button { font: inherit }` "fixes". Leave an element design.md doesn't
   style on the browser default: the design was rendered with that default,
   and one invented reset moves every pixel after it.
6. Anything design.md doesn't state is a question, not a guess.
7. **Verify, then fix, until it matches.** Render your UI to static HTML. A
   plain `.html` build already is; for a framework, save the rendered page.
   Then run:

   ```bash
   specship design verify <build.html> --against specs/<slug>/design.md
   ```

   It compares your build's element outline with design.md's, line by line
   (nesting, tags, classes, attributes, text and SVG), and checks that your
   stylesheet rules keep design.md's order wherever a later rule would
   override an earlier one. Fix each reported line or rule pair and run it
   again. **You are done when it matches.** A small model that
   misnests one container gets caught here and fixes it in one pass.
