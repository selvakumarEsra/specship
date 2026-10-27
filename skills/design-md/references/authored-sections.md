# Writing the authored sections

The Generated reference has the values. The authored sections say how they
assemble into screens and components. Write them so a small model can build the
UI by following them in order.

Shared rules:
- Follow the **Element outline**'s nesting exactly. When you write
  "Anatomy", list only the direct children of that element, in outline
  order, and say which parent each part sits in. A part that is a sibling of
  a row is never "in" that row. The outline is authoritative: if your prose
  and the outline disagree, a builder follows the outline, and your prose
  was wrong.
- Every value you write appears in the Generated reference, or in
  `figma/metadata.xml` for frame sizes. Copy it exactly: `13.5px` stays
  `13.5px`, and `#5B93F2` keeps its case.
- Cite the selector (or Figma layer name) behind every value, in backticks.
- One bullet per fact. Short, declarative, no adjectives that carry no value
  ("nice", "subtle", "slightly").
- When the source doesn't specify something, write: "Not specified in the
  design; ask the designer."
- `specship design check` rejects these words: approximately, roughly,
  about <n>, ~<n>, similar to, etc., TBD, something like.

## Screens & layout

One `###` per screen or frame. Cover:
- the frame size and the background,
- the layout model: grid or flex, direction, columns, gaps, max-width,
  alignment,
- the regions top to bottom, or left to right, each with its size and the
  selector that styles it.

```markdown
### Spec detail (1440 × 900)

- Background `#0B0D11` (`#boot-splash`); text `#E8EBF0`.
- Two columns: sidebar `280px` fixed (`div.col`) + content `1fr`; no gap.
- Content padding `28px 32px 56px` (`div.scroll-y`), scrolls vertically.
- Top to bottom: header row (`div.row.gap-8`, padding `15px 16px`), metadata line
  (`div.sp-metaline`, margin-top `32px`), criteria list.
```

## Components & states

One `###` per component. Cover:
- its selector or selectors,
- its anatomy: the child parts in order,
- its exact box: size, padding, radius, border, shadow,
- its typography: family, size, weight, line height, letter spacing, color,
- then **one bullet per state**, naming the values that change. Cover every
  state the source styles: default, `:hover`, `:focus-visible`, `:active`,
  `:disabled`, `[aria-selected]` / `[aria-expanded]`, `.is-*`, loading, empty,
  error.

```markdown
### Nav item (`a` in the sidebar)

- Height `32px`; padding `0px 10px`; gap `10px`; radius `6px`.
- Label `13px` / weight `450`, color `#8A93A3`.
- States:
  - default: background transparent.
  - `:hover`: background `rgba(255,255,255,0.06)`, label `#E8EBF0`.
  - `[aria-current=page]`: background `rgba(91,147,242,0.12)`, label weight `600`.
  - `:focus-visible`: outline `2px solid #5B93F2`, offset `2px`.
```

## Interactions & motion

For each transition or animation, give:
- the trigger,
- the animated properties,
- the duration, easing and delay,
- the keyframes name.

If there are none, write "None in this design."

## Responsive behaviour

For each breakpoint in the Generated reference's **Breakpoints** inventory,
say exactly what changes. If there are none, write "Single fixed layout."

## Assets

For each image, icon and font, give:
- the file or link,
- the rendered size,
- where it's used.

Include icon sets with the icon names used. If there are none, write "None."
