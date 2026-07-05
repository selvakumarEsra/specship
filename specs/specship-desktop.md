---
id: SPECSHIP-DESKTOP-DOC
title: SpecShip Desktop
owner: web
priority: high
version: 1
source: specs/specship-desktop/source.md
snapshot: specs/specship-desktop/snapshot.html
tokens: specs/specship-desktop/tokens.css
---

<!-- id: SPECSHIP-DESKTOP-DOC -->
# SpecShip Desktop — full desktop app as a React SPA (Claude Design import)

Imported from the "SpecShip Desktop" Claude Design project (see `source`
frontmatter for the capture record). This document contracts the ENTIRE
desktop app as a React SPA living in a new standalone `ui` module,
pixel-matched to `specs/specship-desktop/snapshot.html` across every screen:
Dashboard, Graph, Specs (with the redesigned detail + inline editor), Drift
queue, Workflows & Runs, the Claude Code analytics screens (Sessions,
Heatmap, Costs, Compare, Tips), Memory, MCP, Chat, Settings, and Design
system. All features are wired to live backend data served by the existing
TypeScript dashboard server.

Relationship to sibling specs: decided — the SPA replaces the
server-rendered dashboard (REQ-DESKTOP-033). The SSR documents
(`LEAN-DASH-DOC`, `MCP-PAGE-DOC`, `DASH-SPECDETAIL-DOC`, …) remain
authoritative for the SSR surface only until the SPA reaches parity and
that surface retires; their route-level and API behaviours carry forward
into this document's screens.

Where this document and `DASH-SPECDETAIL-DOC` overlap, this import's
snapshot is the newer authority for presentation; `DASH-SPECDETAIL-DOC`'s
route-level behaviours (fetch, route skeleton, not-found) remain in force.

All visual values come from the design tokens in `tokens.css`. Those tokens
already exist byte-identical in the dashboard's stylesheet — implementations
MUST reference the existing token names and MUST NOT redeclare the sheet or
hard-code raw values. The snapshot and its sibling source files
(`app.jsx`, `ui.jsx`, `icons.jsx`, `charts.jsx`, `graph.jsx`,
`screens-*.jsx`, `styles.css`) are the zero-loss visual reference — the
implementation phase reads them for pixel fidelity; this spec carries
contract only.

<!-- id: REQ-DESKTOP-001 -->
## The read view MUST render the detail sections in reading order

Given a selected requirement and its detail data, the panel renders, in
order: a breadcrumb (spec source path › spec id, with a copy-id control);
the requirement title as the panel heading; a single meta line (state pill,
priority pill, kind, owner, last-verified); the normative statement as a
hero block whose accent edge takes the requirement's state color token; an
optional "Why it matters" rationale; acceptance criteria; linked code; and
the actions row. A missing optional field renders a neutral placeholder
rather than an empty gap. (This supersedes `DASH-SPECDETAIL-DOC`
REQ-002.A3's omit-absent-fields behaviour for this surface; amending that
document is a tracked follow-up.)

## Acceptance
<!-- id: REQ-DESKTOP-001.A1 -->
- The sections render in the order breadcrumb → title → meta line →
  statement → rationale (when present) → acceptance criteria → linked code
  → actions, with no section rendered blank.
<!-- id: REQ-DESKTOP-001.A2 -->
- The breadcrumb's copy control places the spec id on the clipboard and
  shows a transient confirmed state using the success color token.
<!-- id: REQ-DESKTOP-001.A3 -->
- The statement block's accent edge uses the requirement's state color
  token (e.g. the success token when verified, the warn token when
  drifted), not a fixed color.
<!-- id: REQ-DESKTOP-001.A4 -->
- A spec with no owner or no verified timestamp renders a neutral
  placeholder in the meta line; a broken or drifted state renders its
  pill with the pulse treatment the design specifies.

<!-- id: REQ-DESKTOP-002 -->
## Spec prose MUST render RFC 2119 keywords as class-distinct chips

Everywhere spec prose renders (statement, rationale, criterion text, editor
preview), normative keywords are decorated as inline chips in three
classes: the MUST class (MUST, MUST NOT, SHALL, SHALL NOT, REQUIRED) in the
spec-node color tokens; the SHOULD class (SHOULD, SHOULD NOT, RECOMMENDED)
in the warn tokens; the MAY class (MAY, OPTIONAL) in the muted treatment.
Inline backtick spans render as code chips in the mono font token;
double-asterisk emphasis renders as strong text. The decorator operates on
escaped text: spec bodies are author-controlled file content and MUST NOT
be able to inject live markup into the dashboard.

## Acceptance
<!-- id: REQ-DESKTOP-002.A1 -->
- A body containing one keyword of each class renders three visually
  distinct chips, each using its class's color tokens, in both dark and
  light themes.
<!-- id: REQ-DESKTOP-002.A2 -->
- Keyword matching respects word boundaries: "MUSTARD" and "dismay" render
  as plain prose, not chips.
<!-- id: REQ-DESKTOP-002.A3 -->
- A body containing raw HTML (e.g. a script tag) renders it as literal
  visible text; no element from the body is parsed into the page.
<!-- id: REQ-DESKTOP-002.A4 -->
- Inline code and bold render identically across all four prose surfaces
  (statement, rationale, criterion text, editor preview).

<!-- id: REQ-DESKTOP-003 -->
## Acceptance criteria MUST render per-criterion marks, a segment bar, and a met rollup

Each criterion renders as a row: a status mark, its `A<n>` sub-id, and its
prose. Marks are class-coded — met states (verified, implemented,
completed) show a check glyph on the state's tokens; attention states show
their glyph (drifted → drift glyph; broken, orphaned, failed → dismiss
glyph) on their state tokens; all other states show a hollow-ring mark in
the muted treatment. Above the list, a slim segment bar renders one
equal-width segment per criterion in its state color (pending segments
dimmed), each identifying its criterion and state on hover. The section
label carries an "N / M met" rollup, rendered in the success token when
all are met.

## Acceptance
<!-- id: REQ-DESKTOP-003.A1 -->
- The three mark classes are visually distinct by glyph and token; a
  pending criterion renders the hollow ring, never a filled glyph.
<!-- id: REQ-DESKTOP-003.A2 -->
- The segment bar renders exactly one segment per criterion, and each
  segment's hover text names the criterion id and its state label.
<!-- id: REQ-DESKTOP-003.A3 -->
- The rollup counts verified, implemented, and completed criteria as met;
  when N = M it renders in the success token, otherwise in the muted token.
<!-- id: REQ-DESKTOP-003.A4 -->
- Rendering follows the data, not the design sample: a spec with more or
  fewer criteria than the template sample renders exactly that many rows
  and segments, and zero criteria omits the section entirely.

<!-- id: REQ-DESKTOP-004 -->
## Linked code MUST list each link and render zero links as an orphaned alarm

Each spec→code link renders as a row: its link-state pill, a drift-axis
pill in the warn tokens when the link carries a drift axis, the target
`file:symbol` in the mono font token, a provenance pill, and a Reveal
affordance. Reveal navigates to the Graph screen focused on the linked
symbol — the same mechanism as Show in graph. The section label counts
linked symbols. A requirement with zero links renders an error-token card
stating it is orphaned — an alarm state, not a neutral empty.

## Acceptance
<!-- id: REQ-DESKTOP-004.A1 -->
- Each link row shows its state pill, target in mono, and provenance pill;
  long targets ellipsize on one line.
<!-- id: REQ-DESKTOP-004.A2 -->
- A link with a drift axis additionally shows an "<axis> drift" pill in
  the warn tokens; links without an axis show no such pill.
<!-- id: REQ-DESKTOP-004.A3 -->
- A spec with zero links renders the orphaned card using the error color
  tokens and an explanatory message, in place of the list.

<!-- id: REQ-DESKTOP-005 -->
## Workflow-owned actions MUST present as system-run, not click-to-run

Implement and Verify on the detail (and Fix / Re-verify / Re-attach in the
drift queue) are owned by workflows. They render in the disabled treatment
with a tooltip naming the owning workflow and its trigger (e.g. "Run
automatically by the implementation workflow once Drafted"). "Show in
graph" remains interactive and navigates to the Graph screen focused on
the spec. "Edit spec" opens the inline editor (REQ-DESKTOP-006) — the
editor is enabled; the snapshot's final read-only pass was a mock-demo
gate, and the design decision record's demonstrated editor is the
contract.

## Acceptance
<!-- id: REQ-DESKTOP-005.A1 -->
- Implement and Verify render disabled with a tooltip naming the owning
  workflow; activating them by pointer or keyboard is a no-op.
<!-- id: REQ-DESKTOP-005.A2 -->
- The drift queue's per-link actions (Fix, Re-verify, Re-attach) follow
  the same disabled-with-explanation contract.
<!-- id: REQ-DESKTOP-005.A3 -->
- "Show in graph" navigates to the Graph screen focused on the current
  spec.

<!-- id: REQ-DESKTOP-006 -->
## Edit spec MUST open an inline editor within the detail panel

Activating Edit swaps the read view for the editor in place — the spec
tree stays visible and selectable. A sticky edit bar with the accent edge
shows the editing context (source path · spec id) and carries Cancel and
Save. Cancel discards the working copy and restores the read view. The
working copy is scoped to the spec being edited: selecting a different
spec in the tree discards the draft and shows the new spec's read view.

## Acceptance
<!-- id: REQ-DESKTOP-006.A1 -->
- Edit opens the editor in the same panel; the tree remains visible and
  interactive.
<!-- id: REQ-DESKTOP-006.A2 -->
- Cancel restores the read view with the persisted values; no edit
  survives.
<!-- id: REQ-DESKTOP-006.A3 -->
- Changing the tree selection while editing discards the draft and renders
  the newly selected spec's read view.
<!-- id: REQ-DESKTOP-006.A4 -->
- Re-entering the editor after Cancel starts from the persisted values,
  not the discarded draft.

<!-- id: REQ-DESKTOP-007 -->
## The editor MUST track dirtiness and gate Save on it

The editor compares the working copy against a snapshot taken when it
opened. Save is disabled until a real difference exists; while dirty, an
unsaved-changes indicator (warn-token dot plus the text "Unsaved changes")
appears in the edit bar and the footer reflects the edited state.
Dirtiness is by value: reverting an edit back to the original returns the
editor to clean.

## Acceptance
<!-- id: REQ-DESKTOP-007.A1 -->
- A freshly opened editor has Save disabled and shows no unsaved-changes
  indicator.
<!-- id: REQ-DESKTOP-007.A2 -->
- Editing any field enables Save and shows the indicator with its text
  label (never the dot alone).
<!-- id: REQ-DESKTOP-007.A3 -->
- Reverting the edited field to its original value disables Save and hides
  the indicator again.

<!-- id: REQ-DESKTOP-008 -->
## Spec status MUST be system-managed; saving re-queues the spec as Drafted

The editor exposes no user-operable status picker. It renders a read-only
status field: a drafted spec shows the drafted pill with "queued for
implementation"; any other state shows the transition current-state →
drafted with a lock affordance. Saving re-enters the spec into the
lifecycle at drafted so the implementation workflow picks it up. State is
recomputed by re-indexing on save; the UI presents the recomputed result
as the spec re-entering the funnel at drafted.

## Acceptance
<!-- id: REQ-DESKTOP-008.A1 -->
- No status control in the editor accepts user input; the status field is
  visibly locked.
<!-- id: REQ-DESKTOP-008.A2 -->
- Editing a non-drafted spec shows the current state and the drafted state
  as a transition, using each state's pill treatment.
<!-- id: REQ-DESKTOP-008.A3 -->
- After a successful save, the tree row and read view render the spec as
  re-queued (drafted), not its pre-edit state.

<!-- id: REQ-DESKTOP-009 -->
## The editor MUST edit the spec as structured fields with a live keyword preview

The editor renders: Title (prominent input), Priority (segmented control
over P0–P3), Kind (select over requirement / constraint / guideline /
invariant / non-functional), Owner (mono input with an "unassigned"
placeholder), the Normative statement (mono textarea) behind a Write /
Preview toggle, and an optional Rationale textarea. Preview renders the
statement with exactly the read view's decoration (REQ-DESKTOP-002) and a
keyword legend; an empty statement previews an explicit "nothing to
preview" note. Rationale remains a derived field in the data model; the
editor edits it as presentation text without expanding the spec format.

## Acceptance
<!-- id: REQ-DESKTOP-009.A1 -->
- All fields above are present and editable; status is the only
  non-editable field (REQ-DESKTOP-008).
<!-- id: REQ-DESKTOP-009.A2 -->
- For identical text, Preview renders keyword chips, code chips, and bold
  identically to the read view.
<!-- id: REQ-DESKTOP-009.A3 -->
- The keyword legend (MUST / SHOULD / MAY classes) is visible alongside
  the statement editor.
<!-- id: REQ-DESKTOP-009.A4 -->
- Toggling Preview with an empty statement shows the explicit empty-state
  note, not a blank block.

<!-- id: REQ-DESKTOP-010 -->
## The criteria editor MUST support add, edit, and remove with automatic renumbering

Each criterion row renders a dot-coded state picker (pending /
implementing / implemented / verified / drifted / broken), a text input,
and a remove control. "Add criterion" appends a row. Sub-ids display as
A1…An by position and renumber automatically on add and delete. Zero rows
render a "no criteria yet" hint. Rows whose text is empty are dropped
(with renumbering) at save time, never while the user is typing.

## Acceptance
<!-- id: REQ-DESKTOP-010.A1 -->
- Adding a criterion appends a row numbered one past the current count.
<!-- id: REQ-DESKTOP-010.A2 -->
- Deleting a middle row renumbers the remaining rows contiguously from A1.
<!-- id: REQ-DESKTOP-010.A3 -->
- A row's state picker changes only that row's state, reflected in its
  dot color token.
<!-- id: REQ-DESKTOP-010.A4 -->
- Saving with empty-text rows drops them and renumbers; a blank criterion
  is never persisted. With zero rows the editor shows the hint, not an
  empty card.

<!-- id: REQ-DESKTOP-011 -->
## Saving MUST persist the draft without losing untouched spec content

Save normalizes the working copy (trims title, owner, statement, and
rationale; drops empty criteria; renumbers), serializes it back into the
spec's source file, and persists via the dashboard's existing spec write
API (whole-file overwrite followed by re-index). Because the write
replaces the whole file, serialization MUST preserve everything the editor
did not touch — sibling requirements, frontmatter, and embedded id
markers. On success the panel returns to the read view rendering the
updated spec. On failure the draft is never lost: a rejected or failed
write keeps the editor open with the draft intact and surfaces the error
in the error tokens; a write that succeeds but fails to re-index surfaces
a "saved but not yet indexed" hint rather than claiming full success.

implementations:
  - server/src/routes/spec.ts

## Acceptance
<!-- id: REQ-DESKTOP-011.A1 -->
- After a successful save, the read view shows the updated values and the
  source file on disk reflects them, with content outside the edited
  requirement byte-preserved.
<!-- id: REQ-DESKTOP-011.A2 -->
- A failed write (network error or server rejection) keeps the editor open
  with the draft intact and shows an error using the error tokens.
<!-- id: REQ-DESKTOP-011.A3 -->
- A write that succeeds while re-indexing fails shows the "saved but not
  yet indexed" hint instead of the normal success return.
<!-- id: REQ-DESKTOP-011.A4 -->
- The persisted content reflects save-time normalization: trimmed fields,
  no empty criteria, contiguous A-numbering.

<!-- id: REQ-DESKTOP-012 -->
## The Specs panel MUST render explicit empty, loading, and error states

With no spec selected the panel renders a guidance empty state: the spec
glyph, a "pick a spec from the tree" heading, and an indexing hint carrying
a copyable `specship init -i` command. While detail data loads, the panel
renders skeleton shimmer placeholders — never a blank pane. A failed
detail fetch renders an error state with a retry affordance. Unknown state
strings in the data render with the neutral info treatment rather than
throwing. Route-level not-found remains covered by `DASH-SPECDETAIL-DOC`.

implementations:
  - ui/src/components/spec-detail.tsx:SpecDetail

## Acceptance
<!-- id: REQ-DESKTOP-012.A1 -->
- With no selection, the empty state shows the guidance heading and the
  copyable command.
<!-- id: REQ-DESKTOP-012.A2 -->
- While loading, skeleton blocks render in place of the sections; the
  panel is never blank.
<!-- id: REQ-DESKTOP-012.A3 -->
- A failed fetch renders a visible error with a retry affordance and no
  unhandled throw.
<!-- id: REQ-DESKTOP-012.A4 -->
- A spec or link whose state string is unrecognized renders with the info
  tokens instead of crashing the panel.

<!-- id: REQ-DESKTOP-013 -->
## Interactive controls MUST take their visible states from the shared state tokens

Hover uses the hover background token (rows, ghost buttons) or the
elevated-surface plus strong-border pair (secondary buttons); pressed
interactions use the active background token; the selected tree row uses
the accent-soft token with the accent token on its id; keyboard focus
renders the global focus-visible ring in the accent token, and text inputs
the focus border token with the accent-soft glow; disabled controls render
the dimmed disabled treatment with a not-allowed cursor. Control state
transitions use the design system's standard motion treatment — no
bespoke per-component timings.

## Acceptance
<!-- id: REQ-DESKTOP-013.A1 -->
- A tree row renders three distinguishable treatments — default, hovered
  (hover token), selected (accent-soft token) — and selection survives
  hover.
<!-- id: REQ-DESKTOP-013.A2 -->
- Focused text inputs show the focus border token and accent-soft glow;
  placeholders render in the muted token.
<!-- id: REQ-DESKTOP-013.A3 -->
- Disabled buttons are visibly dimmed, show the not-allowed cursor, and do
  not react to hover.
<!-- id: REQ-DESKTOP-013.A4 -->
- Every focusable control (buttons, rows, inputs, selects, segmented
  options) shows the focus-visible ring under keyboard navigation.

<!-- id: REQ-DESKTOP-014 -->
## The detail surfaces MUST be fully operable with assistive technology

Keyboard alone completes the full path: navigate the tree, open a spec,
activate Edit, edit every field in visual order, and Save or Cancel.
Icon-only controls (copy id, remove criterion) carry accessible names.
State is never encoded by color alone: pills carry text labels, criterion
marks differ by glyph shape, and the segment bar has the "N / M met" text
equivalent. Normative prose and criterion text render in the primary and
secondary text tokens, which meet AA contrast on the panel surfaces in
both themes; the muted and faint tokens (a known, intentional sub-AA
divergence) MUST NOT carry normative content. When the user prefers
reduced motion, shimmer, pulse, and transitions are disabled — the design
system zeroes them globally. Segmented pickers (the Write / Preview toggle
and the priority picker) expose radiogroup semantics: one group, one
selected member, arrow-key movement.

## Acceptance
<!-- id: REQ-DESKTOP-014.A1 -->
- A keyboard-only pass completes: select a spec → open the editor → edit a
  field → save, with focus order following visual order.
<!-- id: REQ-DESKTOP-014.A2 -->
- Icon-only controls expose accessible names to assistive tech.
<!-- id: REQ-DESKTOP-014.A3 -->
- With color removed, each criterion state class is still distinguishable
  by its glyph shape, and the met rollup is readable as text.
<!-- id: REQ-DESKTOP-014.A4 -->
- With reduced motion set, no shimmer, pulse, or transition animation
  plays anywhere in the panel or editor.
<!-- id: REQ-DESKTOP-014.A5 -->
- Statement and criterion prose render only in the primary or secondary
  text tokens, in both dark and light themes.

<!-- id: REQ-DESKTOP-015 -->
## The detail panel MUST degrade gracefully at narrow widths

The design's shell defines two named breakpoints — narrow (the sidebar
collapses to an icon rail) and compact (the sidebar becomes an overlay
drawer); their values live in the snapshot, not this spec. Within them,
the contract the snapshot establishes: the content column clamps to a
readable measure rather than running full-bleed; the meta line and action
row wrap instead of overflowing; the criteria segment bar compresses
proportionally; long ids, paths, and link targets ellipsize on a single
line. The editor's metadata grid SHOULD collapse to a single column when
the panel is narrow.

## Acceptance
<!-- id: REQ-DESKTOP-015.A1 -->
- At a narrow panel width, no section overflows horizontally; the meta
  line and action row wrap onto additional lines.
<!-- id: REQ-DESKTOP-015.A2 -->
- Long source paths and link targets ellipsize rather than widening or
  wrapping their row.
<!-- id: REQ-DESKTOP-015.A3 -->
- At a wide panel width, the content column stays clamped to its readable
  measure rather than stretching full width.

<!-- id: REQ-DESKTOP-016 -->
## Detail interactions MUST NOT incur avoidable waits

Selecting a tree row paints the detail through the app's instant-navigation
path (prefetch and swap) with no blank flash. Opening the editor requires
no additional network round-trip — it edits the already-loaded detail.
Typing in the statement editor echoes without perceptible lag even for
long bodies, and the Write / Preview toggle renders synchronously
(decoration is a pure text transformation). The loading skeleton
(REQ-DESKTOP-012) appears only when data is genuinely not yet available,
never as a routine flash on selection.

## Acceptance
<!-- id: REQ-DESKTOP-016.A1 -->
- Selecting a tree row swaps in the detail without a full-page reload or
  blank intermediate frame.
<!-- id: REQ-DESKTOP-016.A2 -->
- Opening the editor issues no network request; fields are populated from
  the loaded detail.
<!-- id: REQ-DESKTOP-016.A3 -->
- The Write / Preview toggle renders the preview in the same interaction,
  with no spinner or skeleton.
<!-- id: REQ-DESKTOP-016.A4 -->
- With a statement body an order of magnitude longer than the design
  sample, keystrokes still echo without visible lag.

<!-- id: REQ-DESKTOP-017 -->
## The SPA MUST live in a standalone `ui` module with a lean, registry-safe dependency footprint

The app is a React single-page application in its own top-level module
`ui/` at the repository root, built to static assets that the dashboard
server serves — no separate UI process. Runtime dependencies are limited to react and
react-dom. Charts, icons, sparklines, and the graph canvas render with the
module's own SVG components, ported from the design bundle's `charts.jsx`,
`icons.jsx`, and `graph.jsx` — no third-party chart, component, or CSS
framework. Every dependency (including build tooling) MUST install from a
mirrored private npm registry: no install-time network access outside the
registry, no install-time source compilation. The built app MUST make zero
runtime requests to external origins — fonts and scripts are bundled or
self-hosted, replacing the snapshot's CDN references.

implementations:
  - ui/src/App.tsx:App
  - ui/src/components/charts.tsx:Sparkline
  - ui/src/components/icons.tsx:Icon
  - ui/src/components/graph.tsx:GraphCanvas
  - scripts/check-ui-deps.mjs:assertRuntimeDepsAllowlist
  - scripts/check-ui-deps.mjs:assertNoExternalOrigins
  - server/src/server.ts:resolveDefaultWebDir

## Acceptance
<!-- id: REQ-DESKTOP-017.A1 -->
- The `ui` module builds to static assets with a single npm script, and
  the dashboard server serves the built app with no second process or
  port.
<!-- id: REQ-DESKTOP-017.A2 -->
- The module's runtime dependency list is exactly react and react-dom;
  charts, icons, and the graph render from the module's own SVG
  components.
<!-- id: REQ-DESKTOP-017.A3 -->
- A clean install of the module completes against a registry mirror with
  no network access outside the registry and no source-compilation step.
<!-- id: REQ-DESKTOP-017.A4 -->
- The built app makes zero requests to external origins at runtime — all
  fonts, scripts, and styles load from the app's own origin.
<!-- id: REQ-DESKTOP-017.A5 -->
- Introducing a runtime dependency beyond the allowlist fails the build's
  dependency check.

<!-- id: REQ-DESKTOP-018 -->
## The app shell MUST render the sidebar, status strip, and top bar per the snapshot, with deep-linkable routes

The sidebar renders two collapsible groups — Project (Dashboard, Graph,
Specs, Drift queue, Runs) and Claude Code (Sessions, Heatmap, Costs,
Compare projects, Memory, MCP, Tips) — plus Design system and Settings
pinned at the bottom, with live count badges (drift count on Drift queue,
running-run count on Runs, non-info tip count on Tips) and a collapse
mode that reduces it to an icon rail. The status strip carries the
project switcher (all indexed projects with per-project drift badges),
live node/edge/drift counts, index freshness, and a refresh control. The
top bar carries the sidebar toggle, a search affordance that opens the
command palette, and the theme toggle. Every screen has its own routed,
deep-linkable URL; the active nav item renders the accent-bar treatment.
Theme (dark / light / system) and nav collapse state persist across
sessions.

implementations:
  - ui/src/App.tsx:App
  - ui/src/App.tsx:Sidebar
  - ui/src/App.tsx:NavItem
  - ui/src/App.tsx:ProjectSwitcher
  - ui/src/App.tsx:StatusStrip
  - ui/src/App.tsx:TopBar
  - ui/src/App.tsx:ThemeToggle
  - ui/src/components/command-palette.tsx:CommandPalette
  - server/src/routes/projects.ts:attachDriftCounts

## Acceptance
<!-- id: REQ-DESKTOP-018.A1 -->
- Every screen is reachable from the sidebar; the active item shows the
  accent-bar treatment; badges show live counts and disappear at zero.
<!-- id: REQ-DESKTOP-018.A2 -->
- Loading a screen's URL directly renders that screen — deep links
  survive reload and are shareable.
<!-- id: REQ-DESKTOP-018.A3 -->
- The status strip's counts match the backend status API, and refresh
  re-fetches them and updates the freshness label.
<!-- id: REQ-DESKTOP-018.A4 -->
- The theme toggle switches dark/light immediately, persists across
  reload, and in system mode follows the OS preference.
<!-- id: REQ-DESKTOP-018.A5 -->
- Sidebar collapse and group open/closed states persist across reload.

<!-- id: REQ-DESKTOP-019 -->
## The command palette and keyboard shortcuts MUST work app-wide

The palette opens with the platform command-key + K, searches pages, graph
nodes, spec requirements, and recent prompts from live data as the user
types, and navigates to the selection on Enter. Escape closes it without
navigating. Command-key + 1–7 jumps to the first seven nav items. The
g-then-g / g-then-s / g-then-d chords navigate to Graph, Specs, and the
Drift queue, and are suppressed while focus is in an editable field.

implementations:
  - ui/src/components/command-palette.tsx:CommandPalette
  - ui/src/hooks.ts:useGlobalShortcuts
  - server/src/routes/claude.ts:registerClaudeRoutes

## Acceptance
<!-- id: REQ-DESKTOP-019.A1 -->
- The palette opens on the shortcut, filters across all four result types
  as typed, and Enter navigates to the selected result.
<!-- id: REQ-DESKTOP-019.A2 -->
- Arrow keys move the palette selection; Escape closes without
  navigating.
<!-- id: REQ-DESKTOP-019.A3 -->
- Chords never fire while typing in an input, textarea, or the chat
  composer.
<!-- id: REQ-DESKTOP-019.A4 -->
- On a project with an empty index the palette shows its "no matches"
  state, not an error.

<!-- id: REQ-DESKTOP-020 -->
## The Dashboard screen MUST render the overview modules per the snapshot with live data

The dashboard renders the snapshot's module grid: cost stat tiles (last
session cost, saved this week, token breakdowns), cost ranking, cache
analytics, the tool-call heatmap strip, recent prompts, the recent
neighborhood module, a drift queue summary, and the tips rail with Apply /
Dismiss / View-in-Tips actions, plus cross-links (Open graph, Open
heatmap) that navigate to their screens. Every module binds to live
backend data and follows the shared loading / empty / error pattern
(REQ-DESKTOP-012 generalized by REQ-DESKTOP-030).

implementations:
  - ui/src/pages/dashboard.tsx:DashboardPage
  - ui/src/components/dashboard-modules.tsx:TipsRail

## Acceptance
<!-- id: REQ-DESKTOP-020.A1 -->
- All modules render in the snapshot's arrangement with live values; no
  module renders blank.
<!-- id: REQ-DESKTOP-020.A2 -->
- Tip Apply and Dismiss act on the tip and persist across reload.
<!-- id: REQ-DESKTOP-020.A3 -->
- Module cross-links navigate to the Graph and Heatmap screens.
<!-- id: REQ-DESKTOP-020.A4 -->
- With no ingested transcript data, cost modules render explicit guidance
  toward enabling ingest rather than zeros presented as truth.

<!-- id: REQ-DESKTOP-021 -->
## The Graph screen MUST render the interactive knowledge graph with a selection detail rail

The graph canvas renders the live indexed graph with force and
hierarchical layouts, edge-type filters, and nodes colored by kind using
the node color tokens on the dot-grid canvas. Selecting a node opens the
detail rail: callers, callees, linked specs, linked code, and the
workflow-gated Implement affordance (REQ-DESKTOP-005's contract). A focus
query parameter deep-links to a node — the command palette, Show in
graph, and Reveal all land here. An overview module surfaces
most-connected and anchored nodes.

implementations:
  - ui/src/pages/graph.tsx:GraphPage
  - ui/src/components/graph-rail.tsx:GraphDetailRail
  - ui/src/components/graph.tsx:forceLayout

## Acceptance
<!-- id: REQ-DESKTOP-021.A1 -->
- The canvas renders live nodes and edges colored by kind token; layout
  and edge-type toggles re-render without a page reload.
<!-- id: REQ-DESKTOP-021.A2 -->
- Selecting a node populates the rail with its callers, callees, and
  linked specs; empty lists render their explicit "No callers" / "No
  callees" states.
<!-- id: REQ-DESKTOP-021.A3 -->
- Navigating with a focus parameter centers and highlights that node.
<!-- id: REQ-DESKTOP-021.A4 -->
- An unindexed or empty project renders the guidance empty state, not a
  blank canvas.

<!-- id: REQ-DESKTOP-022 -->
## The Specs screen shell and Drift queue MUST render the live spec inventory

The Specs screen renders the document-grouped requirement tree with
per-requirement state pills and filters; selecting a requirement loads the
detail contract (REQ-DESKTOP-001…016). The Drift queue screen lists every
drifted, broken, and orphaned link with its axis pill and the
workflow-gated repair actions (REQ-DESKTOP-005), and its count matches the
sidebar badge.

implementations:
  - ui/src/pages/specs.tsx:SpecsPage
  - ui/src/pages/drift.tsx:DriftPage

## Acceptance
<!-- id: REQ-DESKTOP-022.A1 -->
- The tree renders every indexed spec document and requirement with its
  state pill; selecting one loads its detail.
<!-- id: REQ-DESKTOP-022.A2 -->
- Filters narrow the tree without losing the current selection when it
  still matches.
<!-- id: REQ-DESKTOP-022.A3 -->
- The Drift queue lists the live drifted/broken/orphaned links; zero
  items renders a clean all-healthy state.
<!-- id: REQ-DESKTOP-022.A4 -->
- The sidebar Drift-queue badge equals the queue's row count.

<!-- id: REQ-DESKTOP-023 -->
## The Workflows and Runs screens MUST render live workflow executions with gate actions

The Workflows screen lists the available workflow definitions with a
launch affordance. The Runs screen lists recent executions (status,
duration, model, cost, when); opening a run renders its node graph with
per-node progression and cost, the run event stream, and run-total cost.
A run paused at an approval gate exposes Approve and Reject; a running
run exposes Cancel; completed runs expose Inspect artifacts.

implementations:
  - ui/src/pages/workflows.tsx:WorkflowsPage
  - ui/src/pages/runs.tsx:RunsPage
  - ui/src/components/run-detail.tsx:RunDetail

## Acceptance
<!-- id: REQ-DESKTOP-023.A1 -->
- The runs list renders live executions with status pills; opening one
  shows its node progression and event stream.
<!-- id: REQ-DESKTOP-023.A2 -->
- Approve and Reject on a gate-paused run call the engine and the run
  advances or revises accordingly.
<!-- id: REQ-DESKTOP-023.A3 -->
- A failed run surfaces its failure state and error context; an empty
  run history renders an explicit empty state.

<!-- id: REQ-DESKTOP-024 -->
## The Claude Code analytics screens MUST render ingested transcript data per the snapshot

Sessions, Heatmap, Costs, Compare projects, and Tips render from ingested
Claude Code transcript data: the sessions list and per-session detail
with prompts and quality signals; the busiest-file / tool-call heatmap;
cost series with by-model and cache-effectiveness breakdowns; the
cross-project comparison table; and the tips list with severity grouping
and Apply / Dismiss. Model and project filters apply across these
screens.

implementations:
  - ui/src/pages/sessions.tsx:SessionsPage
  - ui/src/pages/heatmap.tsx:HeatmapPage
  - ui/src/pages/costs.tsx:CostsPage
  - ui/src/pages/compare.tsx:ComparePage
  - ui/src/pages/tips.tsx:TipsPage

## Acceptance
<!-- id: REQ-DESKTOP-024.A1 -->
- Each of the five screens renders its snapshot layout from live ingested
  data.
<!-- id: REQ-DESKTOP-024.A2 -->
- The model and project filters narrow the rendered data.
<!-- id: REQ-DESKTOP-024.A3 -->
- With transcript ingest disabled or no data ingested, each screen
  renders explicit guidance pointing at the Settings ingest toggle —
  never fabricated numbers.
<!-- id: REQ-DESKTOP-024.A4 -->
- Tip dismissal persists and updates the sidebar Tips badge.

<!-- id: REQ-DESKTOP-025 -->
## The Memory screen MUST render the effective memory and its sources

The screen lists the memory sources in scope (global and project
CLAUDE.md files and their imports) with per-file scope, line count, and
modified time; renders the composed effective-memory view; and offers
copy-contents and reload actions.

implementations:
  - ui/src/pages/memory.tsx:MemoryPage

## Acceptance
<!-- id: REQ-DESKTOP-025.A1 -->
- Real memory files on disk render with scope, line count, and modified
  time; the effective view composes them in load order.
<!-- id: REQ-DESKTOP-025.A2 -->
- Copy places the file's contents on the clipboard with a confirmed
  state.
<!-- id: REQ-DESKTOP-025.A3 -->
- Reload re-reads from disk and reflects external edits.
<!-- id: REQ-DESKTOP-025.A4 -->
- A machine with no memory files renders the explicit empty state.

<!-- id: REQ-DESKTOP-026 -->
## The MCP screen MUST render the configured MCP servers with live status

The screen inventories MCP servers from the machine's client
configurations with per-server status (connected, active, idle, failed,
disabled), configuration detail, call statistics, and an example call;
enable/disable round-trips to the owning configuration file with
confirmation; Add server opens guided configuration. Decided: the
inventory reads Claude Code's configuration surfaces only
(`~/.claude.json` and the project's `.mcp.json`) — no Claude
Desktop/Cursor readers, per this fork's Claude-Code-only house rule; the
snapshot's multi-client column renders only the Claude Code client.

implementations:
  - ui/src/pages/mcp.tsx:McpPage
  - server/src/routes/mcp.ts:deriveState

## Acceptance
<!-- id: REQ-DESKTOP-026.A1 -->
- Configured servers render from the real configuration files with live
  status pills.
<!-- id: REQ-DESKTOP-026.A2 -->
- A server's detail shows its configuration and call statistics.
<!-- id: REQ-DESKTOP-026.A3 -->
- Enable / disable writes the configuration change after confirmation
  and reflects the new state.
<!-- id: REQ-DESKTOP-026.A4 -->
- An unreachable or crashing server renders the failed treatment, never a
  blank screen or crash.

<!-- id: REQ-DESKTOP-027 -->
## The Chat screen MUST render the project chat wired to the server's chat API

The chat surface renders the snapshot's composer with context chips
(project, indexed files, MCP tools, tool access level), seeded suggested
actions (summarize the drift queue, look up a spec and its link state,
kick off the spec-implement workflow), attachment of files or spec ids,
and a show-context affordance. Messages round-trip through the dashboard
server's chat API; the sibling chat document's behaviour contract remains
authoritative for answer semantics.

implementations:
  - ui/src/pages/chat.tsx:ChatPage

## Acceptance
<!-- id: REQ-DESKTOP-027.A1 -->
- The seeded suggestions render and send as messages when activated.
<!-- id: REQ-DESKTOP-027.A2 -->
- A sent message round-trips to the chat API and renders the response,
  including any tool-call context the response carries.
<!-- id: REQ-DESKTOP-027.A3 -->
- Attaching a spec id inserts a reference chip the message carries.
<!-- id: REQ-DESKTOP-027.A4 -->
- A chat backend failure renders an error bubble and preserves the
  composer's unsent text.

<!-- id: REQ-DESKTOP-028 -->
## The Settings and Design system screens MUST render live configuration and the token gallery

Settings renders Appearance (theme, density, boot animation), Backend
information, the Claude Code section (transcript-ingest toggle), Editor
preferences, and About (real version and backend identity). The Design
system screen renders the living token gallery — type scale, buttons in
every state, pills, and semantic colors — sourced from the shared tokens.

implementations:
  - ui/src/pages/settings.tsx:SettingsPage
  - ui/src/pages/designsystem.tsx:DesignSystemPage
  - server/src/routes/config.ts:registerConfigRoutes

## Acceptance
<!-- id: REQ-DESKTOP-028.A1 -->
- Appearance changes apply immediately and persist across reload.
<!-- id: REQ-DESKTOP-028.A2 -->
- The transcript-ingest toggle round-trips to the server's configuration
  and analytics screens react to its state.
<!-- id: REQ-DESKTOP-028.A3 -->
- About shows the real product version and active database backend.
<!-- id: REQ-DESKTOP-028.A4 -->
- The Design system gallery renders every documented control state from
  the shared tokens in both themes.

<!-- id: REQ-DESKTOP-029 -->
## The backend MUST be the existing TypeScript dashboard server, extended with the missing JSON APIs

Decided: TypeScript, not a second stack. The SPA consumes the dashboard
server's JSON API from the same origin; where a screen needs data the
server does not yet expose (run gate actions, chat, analytics, memory,
MCP inventory), the endpoint is added to the same server. No Python
runtime, no second server process, and no cross-origin configuration are
introduced. Layout: the server lives in a clean top-level `server/`
module beside `ui/` — the `packages/` nesting is dissolved as part of
this work, and its remaining residents (the SSR-era e2e package, the npm
shim) are relocated or retired with it.

implementations:
  - server

## Acceptance
<!-- id: REQ-DESKTOP-029.A1 -->
- Every screen's data loads from the dashboard server's endpoints on the
  app's own origin.
<!-- id: REQ-DESKTOP-029.A2 -->
- One CLI invocation serves both the API and the built SPA on a single
  port.
<!-- id: REQ-DESKTOP-029.A3 -->
- The product introduces no second language runtime; new endpoints are
  TypeScript in the existing server.
<!-- id: REQ-DESKTOP-029.A4 -->
- Every new endpoint lands with tests following the server's existing
  test conventions.
<!-- id: REQ-DESKTOP-029.A5 -->
- The repository exposes `ui/` and `server/` as sibling top-level
  modules; no dashboard code remains under `packages/`.

<!-- id: REQ-DESKTOP-030 -->
## Every surface MUST render live data or an explicitly labeled sample state — never silent mock

Screens bind to live APIs. Where a data domain's backend is not yet
implemented, the affected module renders in sample mode with a visible
SAMPLE badge — the design bundle's mock dataset is never silently
presented as real, and is excluded from the production build. A failed
API call renders the module-level error-with-retry treatment while the
rest of the screen stays functional.

implementations:
  - ui/src/components/ui.tsx:SampleBadge
  - scripts/check-ui-deps.mjs:assertNoMockDataset
  - ui/src/components/dashboard-modules.tsx:Module

## Acceptance
<!-- id: REQ-DESKTOP-030.A1 -->
- On a project with a live index and ingested transcripts, no SAMPLE
  badge appears on any screen backed by a real endpoint.
<!-- id: REQ-DESKTOP-030.A2 -->
- Every module without a real backend shows the SAMPLE badge.
<!-- id: REQ-DESKTOP-030.A3 -->
- A failing endpoint degrades only its module to the error-with-retry
  treatment; sibling modules keep rendering.
<!-- id: REQ-DESKTOP-030.A4 -->
- The production bundle contains no copy of the design bundle's mock
  dataset.

<!-- id: REQ-DESKTOP-031 -->
## The app MUST meet its performance budgets — no slowness, no sluggishness

Initial JavaScript payload at most 250 KB gzipped, enforced at build
time. First load renders an interactive Dashboard in under one second
against a local server. Switching screens renders in under 100
milliseconds with no network waterfall — screen data is prefetched or
cached, and repeat visits within a session render from cache. Graph and
heatmap interactions (pan, zoom, hover) sustain smooth motion on a
repo-scale index; any main-thread stall over 200 milliseconds during
interaction is a failure.

implementations:
  - scripts/check-ui-deps.mjs:assertInitialJsBudget
  - ui/src/hooks.ts:useApi
  - ui/src/components/graph.tsx:forceLayout

## Acceptance
<!-- id: REQ-DESKTOP-031.A1 -->
- The build fails when the gzipped initial JS payload exceeds the budget.
<!-- id: REQ-DESKTOP-031.A2 -->
- Cold load to interactive Dashboard completes in under one second
  against a local server with a real indexed project.
<!-- id: REQ-DESKTOP-031.A3 -->
- Screen switches render within their budget and issue no duplicate
  fetches for data already cached this session.
<!-- id: REQ-DESKTOP-031.A4 -->
- Graph pan/zoom on a repo-scale index produces no main-thread stall
  over 200 milliseconds.

<!-- id: REQ-DESKTOP-032 -->
## An end-to-end suite MUST drive the built app against a real server

A Playwright suite runs the built SPA served by a real dashboard server
over a real indexed project: it visits every screen, asserts each renders
its key content with zero console errors, and exercises the core flows —
navigate all screens, select a spec and read its detail, edit and save a
spec and observe the re-queued state, toggle the theme and observe
persistence, and open the command palette and navigate. The suite runs
headless via an npm script and its failure fails the build.

implementations:
  - e2e/tests/screens-render.spec.ts
  - e2e/tests/spec-edit-save.spec.ts
  - e2e/tests/theme-palette.spec.ts
  - e2e/tests/dashboard-detail-nav.spec.ts
  - e2e/tests/dashboard-data.spec.ts
  - e2e/scripts/prepare-and-serve.mjs
  - e2e/lib/screens.mjs
  - src/bin/specship.ts
  - .github/workflows/e2e.yml
  - .github/workflows/release.yml

## Acceptance
<!-- id: REQ-DESKTOP-032.A1 -->
- The suite boots the server and built app, visits every routed screen,
  and asserts key content and zero console errors on each.
<!-- id: REQ-DESKTOP-032.A2 -->
- The spec edit flow persists to disk and the re-queued state renders
  after save.
<!-- id: REQ-DESKTOP-032.A3 -->
- The suite runs headless from a single npm script and exits non-zero on
  any failure.
<!-- id: REQ-DESKTOP-032.A4 -->
- Continuous integration treats an E2E failure as a build failure.

<!-- id: REQ-DESKTOP-033 -->
## The SPA MUST replace the server-rendered dashboard

Once the SPA covers the screens this document contracts, the dashboard
server serves the SPA as the dashboard — the server-rendered surface
retires. The SSR rendering path (templates and bindings) is removed from
the server module rather than left as a dead second surface. Behaviours
the SSR documents contracted that remain product contract (the spec write
API, the JSON data endpoints) carry forward unchanged under this
document. Retiring the surface also retires or re-links the sibling SSR
spec documents so the removal does not fill the drift queue.

implementations:
  - server/src/server.ts:createServer
  - server/src/cli.ts
  - src/bin/specship.ts

## Acceptance
<!-- id: REQ-DESKTOP-033.A1 -->
- The dashboard root serves the SPA; no route serves the server-rendered
  templates.
<!-- id: REQ-DESKTOP-033.A2 -->
- The SSR template and binding code is removed from the server module —
  no dormant second dashboard surface ships.
<!-- id: REQ-DESKTOP-033.A3 -->
- The carried-forward API behaviours (spec write, JSON data endpoints)
  keep their existing tests green after the removal.
<!-- id: REQ-DESKTOP-033.A4 -->
- After retirement, the spec funnel shows no needs-attention entries
  caused by the removal — the SSR documents' links are retired or
  re-attached, not left orphaned.
