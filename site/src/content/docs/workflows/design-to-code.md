---
title: Design-to-code
description: Turn a Claude Design (or Figma) design into a drafted SpecShip spec and an implementation — with the design captured byte-for-byte as a zero-loss reference.
---

SpecShip can take a design straight through to code: snapshot it for fidelity, draft a spec for the contract, and hand off to implementation. The whole path starts from one command, **`/specship:spec design`**, and runs on the bundled `claude-design-implement` workflow.

> **Designer is an opt-in, experimental integration.** Enable it with `specship install --with-designer`; a plain install doesn't expose the `designer_*` tools. The tools drive [claude.ai/design](https://claude.ai/design) through a debug Chrome session, so they can break when the site changes. They only launch Chrome when you actually invoke a designer tool — `specship install` and MCP startup never touch it. One-time setup: run `designer setup` to create the debug-Chrome profile and log in.

## `/specship:spec design` — three entry shapes

`/specship:spec design <URL | intent>` routes on what you give it:

### A `claude.ai/design` URL — you've already settled on a design

Point it at a Claude Design file URL (`https://claude.ai/design/p/<id>/?file=<File>.html`). It derives a slug from the file name and runs:

```bash
specship workflow run claude-design-implement \
  --input CONNECTOR_URL="<URL>" \
  --input FILE_LABEL="<File Name>" \
  --input SLUG="<slug>"
```

Add `--input OWNER=…` / `--input PRIORITY=high|medium|low` to fill the spec's frontmatter; otherwise they surface as `[needs review]` at the review gate.

### A `figma.com` URL

Goes through Figma's remote MCP server. If it isn't installed, you're told to add it (`claude mcp add --transport http figma https://mcp.figma.com/mcp`) and the flow stops — the URL is never blind-fetched. With it present, the design is imported and fed into the same workflow via its `HANDOFF_DIR` input.

### No URL — taste the design first

With a bare intent (or nothing), it runs the human-tasted **design loop** before it specs anything. There are two human gates:

- **Gate 1 (aesthetic).** The agent drives `claude.ai/design` through the `designer_*` tools while you taste the variants on the live surface, iterating until you say "that's it." Claude Design has the taste; the agent is translation + plumbing, seeding the prompt with what the repo actually does (entities, operations, states, failure modes) pulled via `specship_explore`. If the designer session isn't up or you're not signed in, it tells you to run `designer setup` and stops.
- **Gate 2 (contract).** `designer_handoff` fetches the chosen bundle to disk, then `claude-design-implement` runs against it — no re-fetch:

```bash
specship workflow run claude-design-implement \
  --input HANDOFF_DIR="<path to handoff-<ts>/>" \
  --input CHOSEN_FILE="<variant>.html" \
  --input FILE_LABEL="<File Label>" \
  --input SLUG="<slug>"
```

Whichever way you came in, the workflow pauses so you can walk the spec's `[needs review]` markers, and every authoring path finishes with SpecShip's standard post-write review (`specship lint` on the new spec plus a quality pass) before handing off to `/specship:spec implement`.

## What the workflow does

`claude-design-implement` runs in its own worktree and has five nodes:

1. **snapshot** — captures the design source **byte-for-byte** into `specs/<slug>/snapshot.html` (from the handoff bundle on disk, or from the live URL via the designer tools — a plain fetch of a Claude Design URL returns only a loader shell). Writes `specs/<slug>/source.md` as the import record (URL or bundle, date, the original prompt / decision record), writes the pixel-exact [design reference](#designmd--the-pixel-exact-reference) `specs/<slug>/design.md` and checks it, and extracts design tokens into `specs/<slug>/tokens.css`, mapped onto your project's existing token system.
2. **draft_spec** — drafts `specs/<slug>.md` covering the behavioural contract, accessibility, responsive behaviour and interaction states — **no pixel values or hex colors** (those stay in design.md, the snapshot and the tokens). The spec's frontmatter points at `design: specs/<slug>/design.md`.
3. **gap_review** — `approval`. Answer the gap-fill questions in your approval comment; reject with feedback to have the draft revised.
4. **write_spec** — writes the spec and runs `specship sync`. Re-importing an iteration appends new requirements and keeps existing REQ IDs stable.
5. **handoff** — prints the spec path, its REQ IDs, the reference files, and the exact next command: `/specship:spec implement <first REQ ID>`.

The implementation step builds the UI from `specs/<slug>/design.md`: `/specship:spec implement` reads the spec's `design:` file before any UI edit and uses its values as written. The spec covers the contract only.

## design.md — the pixel-exact reference

A strong model can work the exact look out of a raw 2,000-line snapshot. A small one (Haiku, Gemini Flash) rounds `13.5px` to `14px`, picks a "close" blue, and forgets the hover state. `design.md` takes that guesswork away. It is one Markdown file per design, with the same sections in the same order every time, and every value written exactly as the design has it:

- **Generated reference.** `specship design extract` reads the source and writes everything it can find:
  - every design token (CSS custom property, or Figma variable);
  - every color, font family, size, weight, line height, letter spacing, spacing, size, radius, border, shadow, transition and breakpoint, with how often it's used and which selectors use it;
  - every style rule verbatim, including `:hover`, `:focus-visible`, `:disabled` and `@media` rules;
  - the keyframes, font links, asset references and an element outline.

  Code does this reading, not a model, so the same source always gives the same bytes.
- **Authored sections.** Screens & layout, Components & states, Interactions & motion, Responsive behaviour and Assets explain how those values fit together, and cite the selectors. The `design-md` skill writes them.
- **`specship design check`.** This fails the file when:
  - a section is missing or an authored section is still empty;
  - the prose uses approximate wording ("roughly 12px", "~8px", "similar to", "TBD");
  - the source has changed since extraction;
  - a color or token in the source is missing from the reference;
  - a stylesheet the design links to was never captured.

You can use it without the workflow:

```bash
# Claude Design snapshot (local stylesheets it links are read too)
specship design extract specs/<slug>/snapshot.html --out specs/<slug>/design.md --title "<Name>"

# Figma: the code and variables saved from the Figma MCP server
specship design extract specs/<slug>/figma/frame.tsx specs/<slug>/figma/variables.json --out specs/<slug>/design.md

specship design check specs/<slug>/design.md
```

After building, check the result against design.md's structure:

```bash
specship design verify path/to/build.html --against specs/<slug>/design.md
```

`verify` compares the built page's element outline with design.md's, line by
line: nesting, tags, classes, attributes, text and icons. It also checks that
style rules which override each other keep the design's order. It names each
line or rule pair that differs. Differences that render the same (attribute order, a style moved
into a stylesheet) are notes, not failures. The `design-md` skill has the
builder verify and fix until it matches.

When the design changes, capture it again and run `specship design extract <sources> --update specs/<slug>/design.md`. Only the generated reference is replaced, so your authored sections stay. A dated Change log entry lists every token and value that was added, removed or changed (old → new).

### Keeping it current when the UI changes

design.md describes the UI that ships, so it changes in the same commit as
the UI code. A spec is design-backed when its frontmatter names
`design: specs/<slug>/design.md`. `specship postcheck <REQ-ID>`, which
`/specship:spec implement` runs, fails when both of these hold:

- the change touches UI files that a design-backed spec covers:
  - the `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css` or `.html` files in its
    `implementations:` blocks;
  - while implementing that spec, any UI file;
- and that spec's design.md either:
  - has no new Change log entry, or
  - no longer passes `specship design check`.

The implement workflow tells the implementer to make that update in the same
change:

1. Revise the sections that describe what moved.
2. Add a dated Change log line naming the requirement.
3. If the design source itself changed, re-extract with `--update`.

If the implementer misses it, the workflow's postcheck repair step fixes
it.

The `design-md` skill (installed with SpecShip for Claude Code) runs the whole loop for you when you share a `claude.ai/design` or `figma.com` link. It captures the source through the designer tools or the Figma MCP server, never with a plain fetch. It then extracts, writes the authored sections, and finishes only when `check` passes.

## Why the five-file split

The workflow writes five files rather than one spec:

| File | Role | Drift-tracked? |
|---|---|---|
| `specs/<slug>/snapshot.html` | Byte-for-byte design capture | No (frozen reference) |
| `specs/<slug>/design.md` | Every visual value written exactly, in a fixed layout; what the implementer builds from | No (re-extracted with `--update`) |
| `specs/<slug>/source.md` | Import audit record | No (metadata) |
| `specs/<slug>/tokens.css` | Design tokens as CSS variables | No (reference data) |
| `specs/<slug>.md` | The contract: REQs + acceptance criteria | **Yes — the drift gate** |

Specs that name pixel values flag drift on every theme tweak; specs that name token symbols (`MUST use --error`) survive token-value changes silently. The split keeps the [drift queue](/specs/links-and-drift/) meaningful. When the designer iterates, re-running keeps existing REQ IDs stable, so in-flight implementation work survives — and `git diff` separates a *visual* change (the snapshot) from a *contract* change (the spec).

## The design tools

Exposed as `mcp__specship__designer_*` once Designer is enabled, vendored from `@pro-vi/designer` (MIT):

| Tool | Purpose |
|---|---|
| `designer_session` | Open / resume / status a Claude Design session. |
| `designer_prompt` | Send a design prompt and iterate on variants. |
| `designer_ask` | Ask Claude Design a question about the current design. |
| `designer_list` | List the files / variants in the session. |
| `designer_snapshot` | Snapshot a design's source byte-for-byte to disk. |
| `designer_handoff` | Fetch the project export bundle (all variants + a `decision-record.md`) to disk. |

`specship install --with-designer` auto-allows these tools, so the taste loop doesn't prompt on every iteration.
