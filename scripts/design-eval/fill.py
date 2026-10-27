import re, sys
S = sys.argv[1]
FILL = {
'sidebar': {
'Screens & layout': """### Sidebar frame (232 × 900)

- Frame `div#frame`: `232px` × `900px`, `display: flex`; the page background is `var(--bg-canvas)` = `#0E1014` (`html, body`).
- `nav` fills it: width `var(--sidebar-w)` = `232px`, background `var(--bg-panel)` = `#161A21`, `border-right: 1px solid var(--border-subtle)` (`rgba(255,255,255,0.07)`), `display: flex; flex-direction: column`.
- Top to bottom: brand row (`div.row.gap-8`, padding `15px 16px`); scrolling nav list (`div.scroll-y`, `flex: 1 1 0%`, padding `4px 8px`) with two groups, "Project" and "Claude Code"; footer (`div`, padding `8px`, `border-top: 1px solid var(--border-subtle)`) holding "Design system" and "Settings".
- Copy the Element outline exactly: every element, inline style, text and SVG reference, in order.""",
'Components & states': """### Brand row (`div.row.gap-8`)

- Logo `svg` (26 × 26, first line of the brand row) with `filter: drop-shadow(rgba(91, 147, 242, 0.35) 0px 0px 9px)`; label "SpecShip" `font-weight: 600; font-size: 13.5px; letter-spacing: -0.01em`; row gap `8px` (`.gap-8`).

### Group header (`button.row.gap-6`)

- `width: 100%; padding: 8px 8px 4px`; label `span.eyebrow.grow`: `font-size: var(--fs-xs)`, weight `600`, `text-transform: uppercase`, `letter-spacing: 0.07em`, color `var(--text-muted)` (`#5C6573`); chevron `svg` colored `var(--text-muted)`.

### Nav item (`a`)

- `display: flex; align-items: center; gap: 10px; height: 32px; padding: 0px 10px; border-radius: 7px; margin-bottom: 1px`; icon then `span.grow` label (ellipsis), optional count pill.
- States:
  - default: color `var(--text-secondary)` (`#9AA3B2`), background `transparent`, weight `450`.
  - active ("Dashboard"): color `var(--text-primary)` (`#E8EBF0`), background `var(--bg-active)` (`rgba(255,255,255,0.07)`), weight `600`, icon color `var(--accent)` (`#3B82F6`), and a left bar `span` (`position: absolute; left: 0px; top: 7px; bottom: 7px; width: 2.5px; border-radius: 2px; background: var(--accent)`).

### Count pill (`span.pill.tabular`)

- `font-size: 10px; font-weight: 700; padding: 1px 6px; min-width: 18px; justify-content: center`; `.pill` radius `var(--r-pill)` (`999px`).
- Variants: neutral (Drift queue "7") color `var(--text-secondary)` on `rgba(255, 255, 255, 0.06)`; warn (Runs "1") `var(--warn)` on `var(--warn-soft)`; error (Tips "4") `var(--error)` on `var(--error-soft)`.""",
'Interactions & motion': """- `nav` animates `width 120ms` (collapse to `var(--sidebar-w-collapsed)` = `56px`); not shown in this frame.
- Under `@media (prefers-reduced-motion: reduce)` all durations become `0.001ms`.""",
'Responsive behaviour': """Single fixed layout: the sidebar is a fixed `232px` column at every width shown.""",
'Assets': """- Icons: the `svg … = <svg …>` lines in the Element outline, each pasted as is.
- Fonts: Geist and Geist Mono from the Google Fonts link in Font loading.""",
},
'header': {
'Screens & layout': """### Main column top (1208 × 261)

- Frame `div#frame`: `1208px` × `261px`, column flex; page background `var(--bg-canvas)` = `#0E1014`.
- Top to bottom:
  - Status bar: height `var(--status-h)` = `30px`, gap `14px`, padding `0px 14px`, background `var(--bg-panel-2)` (`#1A1F28`), bottom border `1px solid var(--border-subtle)`.
  - Toolbar: height `44px`, gap `10px`, padding `0px 14px`, background `var(--bg-canvas)`, bottom border `1px solid var(--border-subtle)`.
  - Content (`div.scroll-y`, padding `18px`) with the page header row (gap `12px`, margin-bottom `18px`) and the KPI card row.
- Copy the Element outline exactly: every element, inline style, text and SVG reference, in order.""",
'Components & states': """### Status bar items

- Project switcher `button.row.gap-6`: height `24px`, padding `0px 8px`, radius `6px`, transparent border; path text `span.mono` `11.5px` `var(--text-primary)`.
- Stat pairs: label `span.muted` `11px`; value `span.mono.tabular` `11.5px` `var(--text-secondary)` (drift value `var(--warn)` = `#E5A50A`); separators `span` `1px` × `12px` `var(--border-subtle)`.

### Search button (`button.row.gap-8`)

- `max-width: 380px; height: 30px; padding: 0px 11px`, background `var(--bg-panel)`, border `1px solid var(--border-subtle)`, radius `8px`, color `var(--text-muted)`; `kbd` "⌘K": `font-family: var(--font-mono); font-size: 10px`, background `var(--bg-canvas)`, radius `4px`, padding `2px 6px`.

### Page header

- Icon tile `34px` × `34px`, radius `9px`, background `var(--bg-panel)`, border `1px solid var(--border-subtle)`, icon color `var(--accent)`.
- Title "Dashboard": `font-size: var(--fs-title)` (`22px`), weight `600`, `letter-spacing: -0.01em`; subtitle in `.secondary` (`var(--text-secondary)`).
- Range switch on the right, with "This week" selected, exactly as in the outline.

### KPI card (`button.card`)

- `.card`: background `var(--bg-panel)`, border `1px solid var(--border-subtle)`, radius `var(--r-lg)` (`12px`); four cards in one row, each with an eyebrow label + icon, a big value + sparkline `svg`, and a delta line (`span.row.gap-2.tabular`) colored per the outline.
- States: ghost buttons (`.btn-ghost`) are `transparent` / `var(--text-secondary)` by default; on `:hover` they turn `var(--bg-hover)` / `var(--text-primary)`.""",
'Interactions & motion': """- `.btn` transitions `background 100ms ease, border-color 100ms ease, color 100ms ease`; the project switcher transitions `background 100ms, border-color 100ms`.
- Under `@media (prefers-reduced-motion: reduce)` all durations become `0.001ms`.""",
'Responsive behaviour': """Single fixed layout: a `1208px` main column.""",
'Assets': """- Icons and sparklines: the `svg … = <svg …>` lines in the Element outline, each pasted as is.
- Fonts: Geist and Geist Mono from the Google Fonts link in Font loading.""",
},
}
for name, secs in FILL.items():
    p = f"{S}/design-{name}/design.md"
    s = open(p).read()
    for sec, body in secs.items():
        pat = re.compile(r"(## " + re.escape(sec) + r"\n\n)<!-- design-md:[^\n]*-->")
        s, n = pat.subn(lambda m: m.group(1) + body, s)
        assert n == 1, (name, sec)
    open(p, "w").write(s)
