/**
 * design.md rendering (DESIGNMD-DOC, REQ-DESIGNMD-001/002).
 *
 * Every design.md has the same headings in the same order, so a low-end
 * model always finds a value in the same place. The generated reference is
 * fenced by markers and is a pure function of the extraction: same sources,
 * same bytes (REQ-DESIGNMD-001.A4). Everything outside the markers is
 * authored — by the design-md skill or a person — and survives re-extraction.
 */

import { CssRule } from './css';
import { DesignExtraction, INVENTORY_KINDS, InventoryEntry } from './extract';

export const GENERATED_START = '<!-- design-md:generated:start -->';
export const GENERATED_END = '<!-- design-md:generated:end -->';

/** Top-level sections, in order (REQ-DESIGNMD-002.A1). */
export const REQUIRED_SECTIONS = [
  'Source',
  'Fidelity rules',
  'Screens & layout',
  'Components & states',
  'Interactions & motion',
  'Responsive behaviour',
  'Assets',
  'Generated reference',
  'Change log',
] as const;

/** Authored sections that must carry real content before `check` passes. */
export const AUTHORED_SECTIONS = [
  'Screens & layout',
  'Components & states',
  'Interactions & motion',
  'Responsive behaviour',
  'Assets',
] as const;

const USED_BY_LIMIT = 6;

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function usedBy(e: InventoryEntry): string {
  const shown = e.usedBy.slice(0, USED_BY_LIMIT).map((s) => `\`${cell(s)}\``).join(', ');
  return e.usedBy.length > USED_BY_LIMIT ? `${shown} +${e.usedBy.length - USED_BY_LIMIT} more` : shown;
}

function inventoryTable(entries: InventoryEntry[]): string[] {
  return ['| Value | Uses | Used by |', '|---|---|---|', ...entries.map((e) => `| \`${cell(e.value)}\` | ${e.count} | ${usedBy(e)} |`)];
}

function ruleText(rule: CssRule): string {
  return `${rule.selector} { ${rule.declarations.map((d) => `${d.property}: ${d.value};`).join(' ')} }`;
}

/** The marker-fenced reference block. Deterministic for a given extraction. */
export function renderGeneratedBlock(x: DesignExtraction): string {
  const out: string[] = [GENERATED_START];
  out.push(`Sources: ${x.sources.map((s) => `\`${s.path}\` sha256:${s.sha256}`).join(' · ')}`);
  out.push('');
  out.push('_Extracted by `specship design extract`. Do not edit by hand — re-run with `--update`. Every value below is verbatim from the source._');
  for (const m of x.missingLinks) out.push('', `Missing linked stylesheet: \`${m}\` — its values are NOT in this reference.`);

  out.push('', '### Design tokens (custom properties)', '');
  if (x.customProperties.length === 0) out.push('None declared.');
  else {
    out.push('| Token | Value | Declared on |', '|---|---|---|');
    for (const p of x.customProperties) {
      const value = p.value === '' ? '_empty (declared as `' + p.name + ': ;`)_' : `\`${cell(p.value)}\``;
      out.push(`| \`${cell(p.name)}\` | ${value} | \`${cell(p.selector)}\`${p.media ? ` (${cell(p.media)})` : ''} |`);
    }
  }

  if (x.variables.length > 0) {
    out.push('', '### Design variables', '', '| Variable | Value |', '|---|---|');
    for (const v of x.variables) out.push(`| \`${cell(v.name)}\` | \`${cell(v.value)}\` |`);
  }

  out.push('', '### Value inventories');
  for (const kind of INVENTORY_KINDS) {
    const entries = x.inventories[kind];
    if (entries.length === 0) continue;
    out.push('', `#### ${kind}`, '', ...inventoryTable(entries));
  }

  if (x.fontLinks.length > 0 || x.fontFaces.length > 0) {
    out.push('', '### Font loading', '');
    for (const link of x.fontLinks) out.push(`- \`${link}\``);
    for (const face of x.fontFaces) out.push(`- \`@font-face { ${face.map((d) => `${d.property}: ${d.value};`).join(' ')} }\``);
  }

  if (x.keyframes.length > 0) {
    out.push('', '### Keyframes', '', '```css');
    for (const k of x.keyframes) out.push(`${k.media ? `/* ${k.media} */ ` : ''}@keyframes ${k.name} { ${k.body} }`);
    out.push('```');
  }

  if (x.utilityClasses.length > 0) {
    out.push('', '### Utility classes', '', ...inventoryTable(x.utilityClasses));
  }

  if (x.assets.length > 0) {
    out.push('', '### Asset references', '', ...inventoryTable(x.assets));
  }

  if (x.outline.length > 0) {
    out.push('', '### Element outline', '', '_One element per line, nested by indentation, with its inline style in braces; quoted lines are text in document order; an `svg … = <svg …>` line carries that icon\'s exact markup — paste it as is._', '', '```text', ...x.outline);
    if (x.outlineTruncated) out.push(`… truncated at ${x.outline.length} elements — the source file has the rest`);
    out.push('```');
  }

  // Inline styles already sit on their element in the outline.
  const sheetRules = x.rules.filter((r) => !r.selector.startsWith('inline '));
  if (sheetRules.length > 0) {
    out.push('', '### Style rules (verbatim)', '');
    const groups = new Map<string, CssRule[]>();
    for (const r of sheetRules) {
      const key = r.media ?? '';
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [media, rules] of groups) {
      if (media) out.push(`#### ${media}`, '');
      out.push('```css', ...rules.map(ruleText), '```', '');
    }
    out.pop();
  }

  out.push(GENERATED_END);
  return out.join('\n');
}

export interface RenderOptions {
  title: string;
  /** Where the design came from — a claude.ai/design or figma.com link, or a bundle path. */
  origin?: string;
  /** YYYY-MM-DD for the first Change log entry. */
  date: string;
}

/** A complete new design.md: fixed headings, authored stubs, the generated block. */
export function renderDesignMd(x: DesignExtraction, opts: RenderOptions): string {
  const stub = (hint: string): string => `<!-- design-md: ${hint} -->`;
  return [
    `# ${opts.title} — design reference`,
    '',
    '## Source',
    '',
    ...(opts.origin ? [`- Design: ${opts.origin}`] : []),
    ...x.sources.map((s) => `- \`${s.path}\` (${s.kind})`),
    '',
    '## Fidelity rules',
    '',
    '- The Generated reference is authoritative. Build the structure exactly as the Element outline nests it, with its classes, inline styles, text and SVG. The authored sections explain it; where they disagree with the outline, the outline wins.',
    '- Keep the stylesheet rules in the order Style rules lists them. A later rule overrides an earlier one, so reordering `.border-white` and `.border-t-transparent` changes what renders.',
    '- Use every value in this file verbatim: colors, sizes, spacing, radii, shadows, font stacks, weights, durations and easings. Never round, approximate or substitute a "close" value.',
    '- Reuse an existing project token only when its value is exactly equal to the value here; otherwise add the value as written.',
    '- Build every state listed under Components & states — default, hover, focus-visible, active, disabled, loading, empty and error where listed.',
    '- When this file and the source disagree, the source wins: run `specship design extract --update` and re-read.',
    '- Do not invent anything this file does not state. A missing value is a question for the designer, not a guess.',
    '- Add no CSS the design does not have: no resets, normalizers, or "fixes". An element this file leaves unstyled keeps the browser default, because the design was rendered with that default.',
    '',
    '## Screens & layout',
    '',
    stub('For each screen or frame: its size, the layout model (grid/flex, columns, gaps, max-width, alignment), and the regions top to bottom with their exact dimensions and the tokens they use. Cite the selectors from the Generated reference.'),
    '',
    '## Components & states',
    '',
    stub('For each component: its selector(s), anatomy (child parts in order), exact sizes and paddings, and one bullet per state (default, hover, focus-visible, active, disabled, loading, empty, error) naming the exact values that change.'),
    '',
    '## Interactions & motion',
    '',
    stub('Every transition and animation: trigger, the properties that animate, duration, easing, delay, and keyframes by name. Write "None in this design." when there are none.'),
    '',
    '## Responsive behaviour',
    '',
    stub('Each breakpoint from the Generated reference and exactly what changes at it (columns, visibility, sizes, font sizes). Write "Single fixed layout." when there are none.'),
    '',
    '## Assets',
    '',
    stub('Each image, icon and font: file or link, rendered size, and where it is used. Write "None." when there are none.'),
    '',
    '## Generated reference',
    '',
    renderGeneratedBlock(x),
    '',
    '## Change log',
    '',
    `- ${opts.date}: created from ${x.sources.map((s) => `\`${s.path}\``).join(', ')}.`,
    '',
  ].join('\n');
}
