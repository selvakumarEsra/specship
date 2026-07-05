# SpecShip Desktop — Claude Design import (handoff bundle)

**Imported:** 2026-07-05
**Handoff bundle:** artifacts/default/handoff-2026-07-04T23-45-22-160Z (designer MCP)
**Connector URL:** https://claude.ai/design/p/6d1bd9f2-5e3b-488a-b382-3179cc73d342?file=SpecShip+Desktop.html
**Project ID:** 6d1bd9f2-5e3b-488a-b382-3179cc73d342
**Chosen file:** SpecShip Desktop.html

**Snapshot:** snapshot.html (byte-for-byte capture, with its referenced app.jsx, ui.jsx, icons.jsx, charts.jsx, graph.jsx, data.js, screens-*.jsx, styles.css and favicon assets copied alongside)
**Tokens:** tokens.css (extracted CSS custom properties — dark :root block + light [data-theme="light"] block from styles.css)

**Original prompt:**
> Import this Claude Design project: https://claude.ai/design/p/6d1bd9f2-5e3b-488a-b382-3179cc73d342?file=SpecShip+Desktop.html
> Implement: SpecShip Desktop.html — the full desktop app as a React SPA in a separate `ui` module, pixel-matched across all screens, features wired to live backend data, lightweight dependencies (enterprise private registries), performance first, end-to-end tested.

## Design decision record (verbatim)

# Design handoff — decision record

Project: https://claude.ai/design/p/6d1bd9f2-5e3b-488a-b382-3179cc73d342
Project ID: 6d1bd9f2-5e3b-488a-b382-3179cc73d342
Captured: 2026-07-04T23:45:17.704Z

## Conversation (verbatim — the decisions behind the design)

### You

make the spec details more formatted, structured, human readble , legible . come up with modern idas
Design System (design system)

### Claude

I'll start by exploring the current file and the design system.

Listing files, Reading

The spec detail rendering lives in screens-specs.jsx. Let me read it.

Reading ×2

Let me look at the spec data structure to understand the body format.

Searching

The screenshot is the real SpecShip product — our mock data has simpler bodies. The user wants the spec detail panel to render structured, legible content instead of a raw markdown blob. Let me check the design system and styles.

Listing files, Reading

The design system project is empty — styles.css is the system. Let me check the UI helpers and icons available.

Reading, Searching ×2

I have enough context. Let me read the full specDocs block to enrich it with structured content.

Reading

Now I understand the structure. The mock dumps req.body as a single inline-formatted blob with no acceptance criteria, headers, or RFC keyword treatment. I'll redesign the spec detail into a structured, legible layout and enrich the data to support it.

Updated todos

Now the data enrichment — adding acceptance criteria, RFC-2119 keywords, and rationale:

Editing

Now the CSS for the spec-detail renderer:

Editing

Now the redesigned SpecDetail. I'll replace the function and the mdInline helper (keeping meta for the drift rows):

Editing
Updated todos
SpecShip Desktop.html
SpecShip Desktop.html

Let me navigate to the Specs screen and capture the redesigned detail.

Running JS, Screenshot ×2

This looks excellent — the breadcrumb, meta grid, normative statement block with the MUST keyword badge, and rationale all render cleanly. Let me scroll down to verify the acceptance checklist.

Running JS ×2, Screenshot ×2

The capture ignores inner-scroll offset. Let me verify the acceptance checklist exists in the DOM and check for console errors instead.

Running JS

Working. Let me check a drifted requirement to confirm mixed criterion states and SHOULD keyword render.

Running JS ×3

Still on AUTH-001 (selection is internal state). Let me click the tree row directly.

Running JS ×2

Both keyword variants (MUST blue, SHOULD amber) and the three distinct criterion states (verified green, drifted amber, pending muted ring) render correctly. The redesign works. Let me hand off for verification.

Updated todos

I redesigned the spec detail panel so requirements read like a real spec viewer instead of a markdown dump.

What's new:

Breadcrumb + header — specs/auth.md › REQ-AUTH-001, id chip with copy, state and priority pills.
Meta grid — Kind / Owner / Priority / Siblings / Linked code / Last verified as a clean key-value grid.
Normative statement — the requirement in larger, readable prose inside an accent-edged card, with RFC-2119 keywords auto-highlighted as chips (MUST = blue, SHOULD = amber, MAY = muted) and inline code styled.
Acceptance criteria — each criterion is now its own row with a sub-id (A1), a state-colored status mark (✓ verified / drift / hollow ring for pending), a "n / total met" count, and a slim segment bar summarizing pass state.
Rationale section where it adds context.

I enriched the mock spec data with real acceptance criteria and rationale per requirement to drive it. The background verifier is checking the rest.

Edited 3 files

### You

in the spec detail panel , implement the Edit spec screen
Design System (design system)

### Claude

Let me re-read the current spec screen and UI primitives to build the Edit screen consistently.

Reading ×2

I need to check existing form/input styles before building the editor.

Searching, Reading

Now I'll add editor CSS and build the SpecEditor. First the styles:

Reading, Editing, Searching

I'll add a couple of icons, then build the editor.

Editing

Now wire SpecDetail to hold edit state and render from a working copy, and add the SpecEditor:

Editing

Now key SpecDetail by req.id so switching tree selection resets the editor:

Editing
SpecShip Desktop.html

I'm fixing/building UI, so I'll verify visually once.

SpecShip Desktop.html
Running JS, Reading logs

Clean. Now click "Edit spec" and screenshot.

Running JS, Screenshot ×2

Status shows "Drafted" but AUTH-001 is verified — let me check the select value.

Running JS

That's just html-to-image misrendering the native select (value is correctly "verified", dot is green). Let me check the acceptance editor and preview by scrolling.

Running JS ×2, Screenshot ×2

Screenshot tool resets nested scroll on clone. Let me verify the lower sections via DOM instead.

Running JS

Add likely fired but DOM hadn't flushed in the same tick. Let me re-check after a delay and test renumber-on-delete.

Running JS

Add works (now 4 rows). Let me test preview tab and the save flow.

Running JS ×2

Delete/renumber and preview both work. Now test the save round-trip.

Running JS ×4

Everything works: edit bar, write/preview toggle with live RFC-keyword highlighting, status/priority/kind/owner fields, add/remove/renumber acceptance criteria with per-criterion state pickers, dirty tracking, and Save round-trips back to the read view with updates persisted.

Finishing up

Implemented the Edit spec screen. Clicking "Edit spec" now opens a full inline editor in the detail panel:

Sticky edit bar — breadcrumb (specs/auth.md · REQ-AUTH-001), an unsaved-changes indicator, and Cancel / Save (Save disabled until something changes).
Title + a metadata grid: Status (dot-coded dropdown), Priority (P0–P3 segmented), Kind, Owner.
Normative statement with a Write / Preview toggle — preview renders the same RFC-2119 keyword highlighting (MUST/SHOULD/MAY) and code styling as the read view, plus a live keyword legend.
Rationale textarea.
Acceptance criteria editor — each row has a state picker, editable text, and remove button; "Add criterion" appends a row, and IDs auto-renumber (A1, A2…) on add/delete.

Save writes back into the spec and returns to the read view with changes reflected; Cancel discards. Switching specs in the tree resets the editor.

Edited 3 files

### You

using all the features in specship Desktop create a modern landing page that illustrate the key features in a single page and attrcts the target audience to use it
Design System (design system)

### Claude

I'll explore the design system and the SpecShip app to understand the product deeply before building the landing page.

Listing files, Reading

The design system dir reads empty but the local styles.css IS the system. Let me read the styles and app shell to learn the full feature set and visual language.

Reading ×2

This is a rich devtool. Let me look at the logo and the icons available so the landing page uses the real brand mark.

Reading ×2

I have a complete picture of the product. Brand mark is "Wake" (lead spec node + trailing code/test/route nodes); palette is the four node colors; Geist + Geist Mono; dark, graph-as-hero aesthetic.

The product is a desktop companion for developers using AI coding agents (Claude Code): a live knowledge graph of code/specs/tests, spec drift detection, an MCP server that saves tokens, cost analytics, workflows with approval gates, and memory management. Let me set up and build.

Updated todos

Now the landing CSS:

Writing

Now the landing page HTML:

Writing
Updated todos
SpecShip Landing.html

Let me capture the hero to verify the graph renders, then hand off.

SpecShip Landing.html

Strong hero. Let me check the graph visual and a few sections.

Screenshot ×2

The page isn't scrolling — styles.css locks html, body { height:100%; overflow:hidden }. I need to override that for the landing.

Editing
SpecShip Landing.html
Screenshot, Running JS

The scroll works — the html-to-image screenshot tool just resets scroll on its clone. Let me use real pixel captures.

Screenshot

Capture keeps resetting scroll (preview limitation). Let me verify the sections rendered correctly via DOM inspection instead.

Running JS, Reading logs

All sections rendered cleanly: hero graph (9 nodes/labels + 9 edges), sparkline path set, 7 bento cells, 4 showcases, 5-step pipeline, drift rows, stats. No console errors. The scroll-reset is purely a capture-tool limitation; the page scrolls fine (8554px document).

To confirm mid-page visuals look right, let me hide the hero so a top-anchored capture shows the graph showcase.

Screenshot ×2

The capture tool always resets to scroll 0, so I can't grab mid-page shots from here — but DOM inspection confirms every section, the graph, sparkline, bento, pipeline, and stats all render with no console errors. I'll reload to clear my runtime edits and hand off to the verifier, which screenshots in its own context.

Finishing up

Built a single-page landing for SpecShip Desktop that walks through every feature in the app.

Structure:

Hero — "Give your coding agent a map of the codebase," with a live animated knowledge-graph constellation (nodes draw in, float, and the drifted spec node pulses amber), dual CTA, and a copyable npx specship init -i command.
Problem band — the two pains it solves (context burns / specs drift), each with a real log fragment.
Bento grid — all 8 surfaces (graph, drift, MCP, cost, tips, workflows, memory) color-coded to the node palette.
Four deep-dive showcases with genuine product fragments: the knowledge graph (legend + node counts), a drifted spec card with RFC-2119 keyword highlighting and a drift queue, the MCP before/after (82.4k → 600 tokens), and a cost dashboard with sparkline + by-model bars.
Workflow pipeline with the approval gate, count-up stats band, final download CTA, and footer.

It reuses the app's design tokens (styles.css), Geist/Geist Mono, and the real "Wake" logomark — so it reads as the same product. Everything's local-CSS/vanilla-JS (no React), with scroll-reveal and reduced-motion handling. Links back to the live app at SpecShip Desktop.html.

One note: the GitHub stars, version, and download links are placeholders (#) — point them at real URLs when you have them.

Created 2 files

### You

in specship landing page, add a blog section with modern blog look n feel that will make the user read full details
Design System (design system)
