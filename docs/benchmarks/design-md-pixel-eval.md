# design.md pixel eval: Haiku and Gemini Flash build real screens pixel-exact

**Date:** 2026-10-27. **Models:** `claude-haiku-5-5` (headless `claude -p --model haiku`)
and `gemini-3.6-flash` (headless `gemini -p`, what the CLI's flash alias
resolved to). Both ran with no MCP servers, no shell and no settings.
**Harness:** `scripts/design-eval/`.

## Question

Can a small model build UI that matches a design pixel for pixel when its only
input is the `design.md` SpecShip writes (DESIGNMD-DOC)? And how does that
compare with the usual handoff, a picture of the design?

## Method

- **Design:** the real "SpecShip Desktop" Claude Design bundle
  (`specs/specship-desktop/`), rendered in headless Chromium at 1440 × 900.
  Two screens were cut from the rendered page as static HTML: the
  **sidebar** (232 × 900, 16 icons, active and badge states) and the
  **main-column header** (1208 × 261: status bar, toolbar, page header,
  range switch, four KPI cards with sparklines).
  - The static cuts match the live render at 100% and 99.4% of pixels exact.
  - A third screen, **login**, is a React + Tailwind app captured the same
    way (see "The three screens" below).
  - Screenshots of the static cuts are the references. Interaction-state
    references hover or focus the same element in the design first.
- **design.md arm:** the folder holds only `design.md`.
  - The file was written by `specship design extract` plus authored
    sections, and passes `specship design check`.
  - Each file is about 50 KB: token table, value inventories, an element
    outline with each element's inline style, text and SVG markup, and the
    stylesheet rules.
- **Screenshot arm:** the folder holds only the reference PNG.
- **Same for both arms:** the same prompt shape ("one self-contained
  index.html, pixel for pixel in a W×H viewport"), and every run in its own
  empty folder.
- **Score:** the build is screenshotted at the screen's exact size, after
  `document.fonts.ready`.
  - `exact`: share of pixels identical to the reference.
  - `±16`: share within 16/255 on every channel. This is a weak signal on a
    dark UI, because background pixels match almost anywhere.

## Results (final extractor, everything on small models)

In the final run, **Haiku wrote the authored sections of every design.md
itself**, following only the `design-md` skill and its reference
($0.03–0.04 per file). All three files passed `specship design check`.
Haiku and Gemini Flash then built from those files. Each build was scored
at rest and, where the design has them, in its interaction states:
- **header:** hover on a ghost button.
- **login:** hover on Sign In, and focus on the email field.

| Builder | Screen | Builds | Exact pixels: rest / hover / focus |
|---|---|---|---|
| Haiku | sidebar | 3 | **100%** ×3 |
| Haiku | header | 3 | **100% / 100%** ×3 |
| Haiku | login | 3 | **100% / 100% / 100%** ×2; 97.45% ×1 (see below) |
| Gemini Flash | sidebar | 3 | **100%** ×3 |
| Gemini Flash | header | 3 | **100% / 100%** ×3 |
| Gemini Flash | login | 3 | **100% / 100% / 100%** ×3 |
| Haiku, screenshot only | all 3 | 3 | 0.01% · 0.05% · 1.16% (rest) |
| Gemini Flash, screenshot only | all 3 | 3 | 0.00% · 0.02% · 1.10% (rest) |

- **17 of 18 design.md builds are pixel-identical to the design**, in
  every state measured.
- **More states, same builds:** the login Sign In button **disabled**
  (`disabled:opacity-50`) and a header ghost button **pressed** scored
  100% on every build, except the one misnested build below (97.45%).
- **The exception:** one Haiku login build closed the card's `<div>` one
  line early, so the sign-up footer landed outside the card.
  - design.md had it right in both places: the outline and Haiku's own
    prose put the footer inside the card.
  - It is a builder slip on one of 18 runs, not missing information.
- **Narrow screen:** the login design is responsive. Its card padding
  (`p-6` / `md:p-8`) and heading size (`text-2xl` / `md:text-3xl`) change
  at 768px. Rendered at a 375px phone width, every login build matched the
  design 100%, except the unfixed misnested build (93.34%). Its verified fix
  is 100%.
- **Verify, then fix:** `specship design verify` caught the misnested
  build mechanically, naming line 46 (`div.text-center.mt-8`, one level too
  shallow). It passed the 17 identical builds; its pass/fail matched the
  pixel scores on all 18.
  - Haiku was given that output and asked to fix its build. One pass
    ($0.016) produced a structural match and **100% in all four states**
    (rest, hover, focus, disabled).
  - With the skill's verify-until-it-matches step, **all 18 builds end
    pixel-identical**.
- **Loading and error states, captured live:** the login app's real
  loading state (spinner, "Signing in…", buttons disabled) and error state
  were triggered in the browser, captured, and run through the same
  pipeline.
  - Haiku wrote both design.md files; Haiku and Flash built each 3 times.
  - 11 of 12 builds were pixel-identical. The 12th (99.99%, the spinner)
    had put `.border-t-transparent` before `.border-white`, so the later
    rule turned the spinner into a full ring.
  - That led to a Fidelity rule (keep the rule order) and a rule-order
    check in `verify`, which reports an inversion only when both rules
    write an overlapping property with different values on an element both
    match.
  - Haiku fixed that build from `verify`'s output in one pass ($0.035):
    100%.
- **Across all 30 builds** (sidebar, header, login, login-loading,
  login-error × Haiku and Flash × 3), the verify-then-fix loop ends every
  build pixel-identical. Two needed one fix each.
  - `verify` is stricter than pixels in two builds: it flags an added
    `body.dark` class and a trimmed icon path that happen to render the
    same. They are real markup differences, and fixing them is harmless.
- **Screenshot builds** look roughly right, but almost no pixel is exact.
  Icons are redrawn, sparkline shapes differ, controls wrap, and fonts and
  colors are near misses. The screenshot builds of the header have no
  hover score: they lack the design's ghost-button element entirely.

### The three screens

- **sidebar** (232 × 900) and **header** (1208 × 261) come from the
  real "SpecShip Desktop" Claude Design bundle (`specs/specship-desktop/`).
  That design is React-rendered, so its styling sits in inline styles and
  its icons are inline SVG.
- **login** (1280 × 800, with hover and focus states) is a React + Tailwind
  app: `figma_spec_test`, rendered with Vite.
  - React + Tailwind is the format the Figma MCP's `get_design_context`
    returns, so this exercises the Figma-style path.
  - It renders the code, captures the DOM and compiled CSS
    (`scripts/design-eval/capture.cjs`), then extracts.
  - It is **not** a live Figma file. The Figma MCP was not signed in.

## Live capture: a real claude.ai/design project

**Kairo v4** (`claude.ai/design/p/7a992845-…?file=Kairo+v4.dc.html`, the
user's own project) was captured live with the `designer` tools.
- `designer_session` adopted the signed-in tab, and `designer_snapshot`
  read the rendered HTML from inside the preview frame: 349 KB.
- The capture was frozen to a static snapshot that matches the live render
  at 99.99%.
- Haiku wrote design.md. `check` caught a leftover duplicate section, and
  Haiku fixed it from `check`'s output.
- Haiku and Flash built it 3 times each:

| Builder | Builds | Exact pixels | `verify` |
|---|---|---|---|
| Haiku | 3 | 100% ×3 | 1 pass; 2 flagged a dropped `span` wrapper → one Haiku fix each → pass, still 100% |
| Gemini Flash | 3 | 100% ×3 | pass ×3 |
| Screenshot only (Haiku, Flash) | 2 | 0.04%, 0.00% | — |

The live capture exposed four problems the static bundles never did, all
fixed in SpecShip:
- **Fonts:** live DOM writes quotes in inline styles as `&quot;`, and the
  parser split on its `;`, turning every inline font stack into `&quot`.
  The first run scored 82.25% on all 6 builds; Haiku had concluded two
  fonts were unused. Attribute values are now entity-decoded.
- **A real space between inline elements** (`</span> <span>`) was dropped
  ("Why now:You"). It is now kept: a whitespace-only text node with no
  newline renders, while pretty-print whitespace is still skipped. The
  second run scored 99.33% on 3 builds; the third, 100% on all 6.
- **`verify` and spaces:** an edge-space difference next to a sibling now
  fails `verify`, because there it renders.
- **Repeated sections:** `check` now names a section heading that appears
  twice, instead of a misleading "section is empty".

## How we got to 100%: what the runs exposed

Each miss was traced to its cause and fixed in SpecShip, not in the prompt:

| Miss | Cause | Fix |
|---|---|---|
| First design.md would have missed the look | Inline styles and SVG icons weren't tied to their elements | The outline carries each element's inline style, text in order, and SVG markup |
| 95.94% | The builder added a `button` font reset | Fidelity rule: add no CSS the design does not have |
| 99.93% | The builder pasted the wrong icon via an id lookup | Each SVG is written on its own outline line |
| Login about 81% | The outline kept only 4 classes per element, so Tailwind utilities like `bg-gray-950` were lost; placeholder text was dropped | Every class, plus placeholder, value, alt, ARIA state and boolean attributes |
| Login about 90% | `<html class="dark">` was never recorded, so the theme was wrong | `<html>` is the outline's root line |
| Login 90.47% (invisible, ≤16/255) | The CSS reader dropped empty custom properties (`--tw-blur: ;`) that Tailwind composes `backdrop-filter` from | Empty custom properties are kept |
| Header 91.03% | Haiku's prose said the delta line sat inside the value row; the outline said below it | Fidelity rule: the outline wins over prose; authoring guidance says to follow the outline's nesting |
| Login 99.79% | Trimming text dropped the space in "account? Sign up" | Text keeps one edge space |
| 99.31% | Harness: screenshot before the web font loaded | Wait for `document.fonts.ready`; freeze animations at their end state |

## Limits

- **Small sample:** three screens (two from one Claude Design, one
  React + Tailwind app), 18 design.md builds in the final run plus the
  earlier rounds.
- **Interaction states:** hover, focus, disabled and pressed were
  measured.
  - The header design has no `:active` rule, so pressed shows its hover
    style.
  - A 375px phone width was measured on the responsive login design.
  - The login app's loading and error states were captured live and
    measured.
- **Authored sections:** these don't drive the pixel result here, because
  the extracted outline already carries every element. They matter more
  for behaviour (states, motion) than for a static screenshot.
- **Live capture:** the Claude Design path was run live (Kairo v4, above).
  The Figma MCP path was not, because Figma was never signed in.
  - The Claude Design came from the bundle already in the repo.
  - The Figma-style screen came from a local React + Tailwind app.
  - In this session the global install's designer tools fail on a missing
    `selectors.json`, Chrome's debugging port wasn't running, and the Figma
    MCP was waiting on browser sign-in.
