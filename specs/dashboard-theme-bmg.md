---
id: DASHTHEME-DOC
title: Dashboard theme from the BookMyGame UI design system
owner: dashboard
priority: high
version: 1
epicKey: SSHIP-635
jira: SSHIP-669
depends_on: [DASHSIMPLE-DOC, DASH-LEAN-DOC, SPECSHIP-DESKTOP-DOC]
jira_issue_REQ-DASHTHEME-001: SSHIP-669
jira_fingerprint_REQ-DASHTHEME-001: 471e2f3e73573424
jira_issue_REQ-DASHTHEME-002: SSHIP-674
jira_fingerprint_REQ-DASHTHEME-002: 0882cc044e6b4aee
jira_issue_REQ-DASHTHEME-003: SSHIP-680
jira_fingerprint_REQ-DASHTHEME-003: d6a26ecd74e617cf
jira_issue_REQ-DASHTHEME-004: SSHIP-685
jira_fingerprint_REQ-DASHTHEME-004: 1eadba9dffa1e591
jira_issue_REQ-DASHTHEME-005: SSHIP-690
jira_fingerprint_REQ-DASHTHEME-005: aa6e2dc594abb15a
---

<!-- id: DASHTHEME-DOC -->
# Dashboard theme from the BookMyGame UI design system

The dashboard adopts the look of the **BookMyGame UI** design system from
Claude Design. Its source is snapshotted byte-for-byte in
`specs/dashboard-theme-bmg/snapshot/`: the token stylesheet, page styles,
fonts, the sync record (`_ds_sync.json`) and `SHA256SUMS`. Its usage guide is
kept as `specs/dashboard-theme-bmg/source.md`. That snapshot is the reference
for every value below. Implementations read values from it, not from memory.

BookMyGame UI's components are React Native code compiled for the web. The
dashboard may only depend on `react` and `react-dom` (DASH-LEAN-DOC), so it
adopts the design system's **tokens, fonts and visual language**, re-built in
the dashboard's own shared UI kit. It does not adopt the component library.
The design system is dark-only, so the dashboard becomes dark-only.

This is a theme-layer change: the shared tokens, the theme handling and the UI
kit. Every screen picks it up through that layer, including the DASHSIMPLE
screens still being built.

It supersedes REQ-DASHLEAN-005 (keep the "SpecShip Desktop" visual design),
the light-theme and theme-toggle parts of REQ-DESKTOP-018, and the theme
setting in REQ-DESKTOP-028. REQ-DESKTOP-013's rule that controls take their
states from shared state tokens still holds; only the token values change.

**Non-goals.** Using the `@bmg/components` library or `react-native-web`; a
light variant; BookMyGame's domain tokens (per-sport colours, GP currency
styling, leaderboard medals); and changing any screen's layout or content
(DASHSIMPLE-DOC owns that).

**Test plan.** Component tests in `ui/src/__tests__/` check computed token use
and the removed theme controls. A guard test compares the dashboard's token
values with the snapshot. The existing `check-ui-deps` and `pack-guard` checks
cover dependencies and package size. A screenshot of each kept screen is
reviewed by a human before merge.

<!-- id: REQ-DASHTHEME-001 -->
## The dashboard's colours, spacing, radii and type scale MUST come from the BookMyGame UI tokens

The dashboard's shared tokens MUST take their values from the snapshot's
`--bmg-*` token set: surfaces and background, text tiers, borders and fills,
accent and status colours, spacing, radius and the type scale. Spec states map
to its status colours:

| Spec state | Colour |
|---|---|
| completed / verified | accent |
| pending | warning |
| drifted / broken / orphaned | danger |
| informational | info |

Outside the single token definition file, no stylesheet or component may use a
raw colour literal.

implementations:
  - ui/src/tokens.ts:SEMANTIC_TOKENS
  - ui/src/tokens.ts:SURFACE_TOKENS
  - ui/src/tokens.ts:ADOPTED_BMG_TOKENS
  - ui/src/tokens.ts:SPACE_TOKENS
  - ui/src/tokens.ts:RADIUS_TOKENS
  - ui/src/components/ui.tsx:STATE
  - ui/src/styles/tokens.css

verifies:
  - ui/src/__tests__/theme-tokens.test.tsx:reqDashtheme001A1
  - ui/src/__tests__/theme-tokens.test.tsx:reqDashtheme001A2
  - ui/src/__tests__/theme-tokens.test.tsx:reqDashtheme001A3
  - ui/src/__tests__/theme-tokens.test.tsx:reqDashtheme001A4

## Acceptance
<!-- id: REQ-DASHTHEME-001.A1 -->
- A guard test reads the snapshot's `_ds_bundle.css` and asserts that every
  dashboard colour, spacing and radius token adopted from it has the
  snapshot's value.
<!-- id: REQ-DASHTHEME-001.A2 -->
- The verified, pending and drifted state styles resolve to the accent,
  warning and danger tokens respectively.
<!-- id: REQ-DASHTHEME-001.A3 -->
- A scan of `ui/src` outside the token definition file finds no hex, `rgb()`
  or `hsl()` colour literals.
<!-- id: REQ-DASHTHEME-001.A4 -->
- No per-sport, GP, gold, silver or bronze token from the design system is
  defined in the dashboard.

<!-- id: REQ-DASHTHEME-002 -->
## The dashboard MUST use the design system's fonts, served locally

Body text MUST use Space Grotesk, and headings and large numerals MUST use
Bricolage Grotesque. Both are loaded from font files shipped with the
dashboard, never from a network font service, so the dashboard still renders
correctly offline. Code, symbol names and IDs keep a monospace face, since the
design system defines none. The fonts the dashboard ships today are removed
once nothing uses them.

## Acceptance
<!-- id: REQ-DASHTHEME-002.A1 -->
- The body font-family resolves to Space Grotesk, and headings to Bricolage
  Grotesque.
<!-- id: REQ-DASHTHEME-002.A2 -->
- The built dashboard contains both font files and makes no request to any
  font host. A build with the network disabled renders the fonts.
<!-- id: REQ-DASHTHEME-002.A3 -->
- Code views and spec IDs render in a monospace font.
<!-- id: REQ-DASHTHEME-002.A4 -->
- No previously shipped font file remains in the built dashboard unless
  something still references it.
<!-- id: REQ-DASHTHEME-002.A5 -->
- The published package stays within the `pack-guard` size budget. If the
  font swap needs the budget raised, the raise and its measured cause are
  recorded next to the budget, as that file's policy requires.

<!-- id: REQ-DASHTHEME-003 -->
## The dashboard MUST be dark-only, with no theme switch

The dashboard MUST render only the design system's dark theme. The light
theme, the theme toggle in the top bar and the theme option in Settings are
removed. A stored light or system theme preference from an earlier version is
ignored without error, and an operating system set to light mode does not
change the dashboard.

implementations:
  - ui/src/theme.ts:applyTheme

## Acceptance
<!-- id: REQ-DASHTHEME-003.A1 -->
- The top bar has no theme toggle, and Settings has no theme option.
<!-- id: REQ-DASHTHEME-003.A2 -->
- With a stored `light` preference, the dashboard renders dark and logs no
  error.
<!-- id: REQ-DASHTHEME-003.A3 -->
- With `prefers-color-scheme: light` emulated, the dashboard renders dark.
<!-- id: REQ-DASHTHEME-003.A4 -->
- No light-theme token values remain in the stylesheets.

<!-- id: REQ-DASHTHEME-004 -->
## The shared UI kit MUST be rebuilt in the design system's style with no new dependencies

The dashboard's shared components MUST follow the design system's visual
language: buttons (primary, ghost, outline), cards, badges and chips, stat
tiles, segmented controls, switches, and empty and error states. They are
built with React and CSS only. The Design system screen MUST show the new
tokens and every kit component in its default, hover, pressed, disabled and
loading states, as it does today. Runtime dependencies stay exactly `react`
and `react-dom`.

implementations:
  - ui/src/components/ui.tsx:StatePill
  - ui/src/components/ui.tsx:Pill
  - ui/src/components/ui.tsx:Segmented
  - ui/src/components/ui.tsx:Empty

## Acceptance
<!-- id: REQ-DASHTHEME-004.A1 -->
- The UI dependency check passes with runtime dependencies exactly `react` and
  `react-dom`, and nothing imports `react-native-web` or `@bmg/components`.
<!-- id: REQ-DASHTHEME-004.A2 -->
- The Design system screen renders every kit component in each of its states
  using the new tokens.
<!-- id: REQ-DASHTHEME-004.A3 -->
- Every kept screen renders with the kit and no unstyled control. The existing
  screen tests pass with only token or font changes to their assertions.
<!-- id: REQ-DASHTHEME-004.A4 -->
- Interactive states (hover, pressed, focus, disabled) still come from shared
  state tokens, per REQ-DESKTOP-013.

<!-- id: REQ-DASHTHEME-005 -->
## Superseded visual requirements MUST be marked in their specs

The requirements this document replaces MUST carry a dated SUPERSEDED note
naming the requirement that replaces them, so the spec set never contradicts
the shipped look.

## Acceptance
<!-- id: REQ-DASHTHEME-005.A1 -->
- `specs/lean-dashboard.md` marks REQ-DASHLEAN-005 superseded by
  DASHTHEME-DOC.
<!-- id: REQ-DASHTHEME-005.A2 -->
- `specs/specship-desktop.md` marks the theme-toggle and light-theme parts of
  REQ-DESKTOP-018 and the theme setting of REQ-DESKTOP-028 superseded by
  REQ-DASHTHEME-003.
<!-- id: REQ-DASHTHEME-005.A3 -->
- `specship lint specs` reports no errors after the notes are added.
