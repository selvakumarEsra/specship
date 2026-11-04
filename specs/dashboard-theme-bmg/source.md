# BookMyGame UI — how to build with it

BookMyGame is a **dark-only** sports-booking app (players join and host badminton,
tennis, padel, soccer, squash and pickleball games, paid in **GP** — Gaming Points).
These components are the app's real React Native code compiled for web with
react-native-web; they are exposed on `window.BMG`.

## Setup
- No provider or wrapper is needed. `styles.css` sets the page to `#0A0D10` with
  Space Grotesk; keep every screen on that dark background — the components' text and
  borders are drawn for it and disappear on white.
- Components are styled by **props and inline style objects, never CSS classes**. A
  `style` prop takes a react-native style object (camelCase, unitless numbers = px), e.g.
  `style={{ marginTop: 12, flex: 1 }}`.
- Never put raw text in a component tree: use `Txt` (body, Space Grotesk 400–700) or
  `Display` (headlines and GP amounts, Bricolage Grotesque 400/600/800). `Eyebrow` is the
  uppercase section label; `ScreenTitle` is a screen's top heading.

## Tokens
Use tokens, never hex literals. In JS, `BMG.color`, `BMG.fontSize`, `BMG.space`,
`BMG.radius`, `BMG.sportColor` and `BMG.tint(hex, alpha)`; in your own layout CSS, the
same values as `var(--bmg-*)`:

| JS | CSS var | key values |
|---|---|---|
| `color.bg` / `surfaceRaised` / `sheet` | `--bmg-color-bg`, `--bmg-color-surface-raised`, `--bmg-color-sheet` | app bg, card wash, sheet |
| `color.text` / `textMuted` / `textDim` / `textFaint` | `--bmg-color-text`, `-text-muted`, `-text-dim`, `-text-faint` | text tiers |
| `color.accent` (mint `#2EE59D`), `gold`, `warning`, `danger`, `info`, `violet` | `--bmg-color-accent` … | status / emphasis |
| `color.border`, `color.fill` | `--bmg-color-border`, `--bmg-color-fill` | hairlines, quiet fills |
| `sportColor.Badminton` … `.Pickleball` | `--bmg-sport-badminton` … | one hue per sport |
| `space.xs…2xl` (4–32), `space.gutter` (20) | `--bmg-space-*` | spacing |
| `radius.sm/md/lg/xl/3xl/sheet/pill` | `--bmg-radius-*` | corners (cards ≈ 14–16) |
| `fontSize.h1` (27), `h3` (19), `body` (15), `base` (14), `meta` (13), `tiny` (11) | `--bmg-font-size-*` | type scale |

## Component vocabulary
- Actions: `PrimaryButton` (full-width filled CTA; `tone` recolours, `busy`, `enabled`),
  `GhostButton`, `AccentOutlineButton`, `DashedButton` ("+ Add …"), `FilterPill`, `Touchable`.
- Status: `Badge` (tag that pins itself to the right end of a row), `Chip` (`fg`/`bg`/`border`),
  `CostChip`, `InProgressChip`, `TierChip`, `BadgeChip`.
- Surfaces: `Card`, `StatTile`, `StreakTile`, `InfoNote`, `EmptyCard`, `EmptyState`,
  `ErrorState`, `Skeleton`, `Sheet` (modal bottom sheet).
- Controls: `Segmented`, `Switch`, `StarRow`, `SportTile`.
- People/clubs: `Avatar`, `Emblem` (club initials tile), `FaceStack`.
- Leaderboards: `Podium`, `RankNumeral`, `MoveArrow`.
- Icons need an explicit `color` (`<PinIcon color={color.textFaint} />`); glyphs
  (`TrophyGlyph`, `FlameGlyph`, …) need a `tone`.

Read each component's `.d.ts` for its exact props and its `.prompt.md` for examples.

## Example
```jsx
const { Card, Txt, Eyebrow, Badge, FaceStack, PrimaryButton, color, fontSize } = window.BMG;

<div style={{ background: 'var(--bmg-color-bg)', padding: 'var(--bmg-space-gutter)', display: 'flex', flexDirection: 'column', gap: 12 }}>
  <Card>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Eyebrow>Thu 6 Nov · 7:30 pm</Eyebrow>
      <Badge label="HOSTING" tone={color.accent} />
    </div>
    <Txt weight={600} size={fontSize.xl} style={{ marginTop: 6 }}>Thursday Smash</Txt>
    <Txt size={fontSize.meta} tone={color.textDim}>Bishan Sports Hall · Court 3</Txt>
  </Card>
  <FaceStack faces={[{ initials: 'AK', bg: '#4CC3FF' }, { initials: 'ML', bg: '#A48BFF' }]} total={6} />
  <PrimaryButton label="Join game · 12 GP" onPress={() => {}} />
</div>
```

# BMG (@bmg/components@0.0.0)

This design system is the published @bmg/components React library, bundled as a single
browser global. All 68 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.BMG`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.BMG.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { AccentOutlineButton } = window.BMG;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<AccentOutlineButton />);
```

## Tokens

129 CSS custom properties from @bmg/components. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (81): `--bmg-color-canvas`, `--bmg-color-bg`, `--bmg-color-surface`, …
- **spacing** (10): `--bmg-sport-padel`, `--bmg-space-gutter`, `--bmg-space-gutter-wide`, …
- **typography** (22): `--bmg-font-size-balance`, `--bmg-font-size-display`, `--bmg-font-size-hero`, …
- **radius** (11): `--bmg-radius-xs`, `--bmg-radius-sm`, `--bmg-radius-chip`, …
- **other** (5): `--bmg-sport-badminton`, `--bmg-sport-tennis`, `--bmg-sport-soccer`, …

## Components

### buttons
- `AccentOutlineButton` — The accent-outlined secondary CTA (Browse clubs, Find more clubs).
- `DashedButton` — The dashed + Host a game / + Create a club affordance.
- `FilterPill` — The sport filter pill  the one selected style for every sport filter
- `GhostButton`
- `PrimaryButton`
- `Touchable` — The one pressable in the app. It carries every state REQ-BMG-002 requires:

### icons
- `ActivityIcon` — The bell used by Activities.
- `AreaPinIcon` — The player profile's area pin (snapshot Player profile).
- `CalendarIcon`
- `CameraIcon`
- `CheckIcon`
- `ChevronDown`
- `ChevronLeft`
- `ChevronRight`
- `ClubsIcon`
- `GamesIcon`
- `ImagePlaceholderIcon` — The empty-image glyph on a club's cover drop target.
- `LockIcon` — The padlock before keeps some details private.
- `MoreIcon` — The three-dot More tab glyph.
- `PinIcon`
- `SearchIcon` — The close-out player search glass.
- `SlotImageIcon` — The design tool's image-slot glyph on an empty club cover.
- `TrophyIcon` — A trophy, for Leaderboards (REQ-R10-028).
- `WalletIcon`
- `WhatsAppBubble` — The outline bubble the sign-in CTA uses  no handset, per the snapshot.
- `WhatsAppMark`
- `YouIcon`

### identity
- `Avatar` — A member's face: their profile photo, clipped to a circle, when one is
- `Emblem` — Square emblem tile used for clubs and avatars.
- `FaceStack` — Overlapping initials avatars, capped at three plus a +n bubble.

### chips-badges
- `Badge` — The outlined badge on a card  RANKED (gold, filled: REQ-THEME7-003) and
- `BadgeChip` — An earned badge (gold medal) or the next one, filled to its progress.
- `Chip` — Small label chip. Mirrors DCLogic.chip(fg, bg, border).
- `CostChip` — The cost badge on a game card  turns salmon when you cannot afford it.
- `InProgressChip` — The one In progress chip (REQ-THEME7-010): the amber outlined chip on the
- `TierChip` — Gold  Badminton 1240 with a shield glyph in the tier colour.

### glyphs
- `CalendarGlyph`
- `FlameGlyph`
- `KudosGlyph`
- `MedalGlyph`
- `PartnerGlyph`
- `TargetGlyph`
- `TierGlyph`
- `TrophyGlyph`

### cards-feedback
- `Card` — Card surface used for games, clubs and ledger groups.
- `EmptyCard` — The centred empty card every list falls back to (REQ-BMG-002.A4).
- `EmptyState` — A line glyph in a lit tile, a title, one line and one action.
- `ErrorState` — REQ-BMG-005  a region whose fetch failed shows the danger treatment and a
- `InfoNote` — The informational note shown where an action is gated by permission. The
- `Skeleton` — Pulsing placeholder block  the loading state that replaces a blank screen.
- `StatTile` — Uppercase eyebrow + value stat tile used on Wallet and Profile.
- `StreakTile` — The play-streak tile: an SVG flame and a 4-segment bar toward the 4-week badge.

### utilities
- `CssGradient` — A gradient written the way the snapshot writes it (REQ-DV5-006).
- `HScroll` — A horizontal chip/pill row. Native: a plain horizontal ScrollView.
- `QrCode` — A QR code drawn as one SVG path  no network round-trip, works on web and
- `RadialGlow` — The soft lamp behind a hero figure  the snapshot's

### typography
- `Display`
- `Eyebrow` — Uppercase eyebrow label used above sections and inside cards.
- `ScreenTitle`
- `Txt`

### leaderboards
- `MoveArrow` —  /  with the number of places moved since you last looked.
- `Podium` — The top three on a stepped podium 1 in the middle on the hero gradient.
- `RankNumeral` — A ladder row's rank: a metal chip for the top three, the gold rank chip after.

### controls
- `Segmented` — A segmented control: the Games tab's Your clubs  Open games look (the
- `SportTile` — One tile of the onboarding sport grid  the snapshot's sportOptions. The
- `StarRow` — The five-star rating control. Each star is its own button so the whole row
- `Switch` — The pill switch used by club visibility and notification settings.

### overlays
- `Sheet` — The design's bottom sheet. REQ-BMG-003.A2: opening moves focus into the
