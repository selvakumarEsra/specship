/**
 * Build verification against design.md (DESIGNMD-DOC, REQ-DESIGNMD-008).
 *
 * The pixel eval's last miss was a builder slip, not missing information: a
 * small model closed a container one line early, so a footer landed outside
 * its card. That is mechanically detectable. This extracts the element outline
 * of a built HTML page with the same extractor that wrote design.md, and
 * compares it line by line with design.md's Element outline. Each element line
 * carries its tag, classes, rendering attributes, inline style and nesting, so
 * a match means the structure the design describes is the structure that was
 * built. The builder runs it, fixes what it reports, and runs it again.
 */

import { CssRule, parseCss } from './css';
import { DesignSourceError, extractDesign } from './extract';

export interface VerifyMismatch {
  /** 1-based line within the outline. */
  line: number;
  expected: string | null;
  actual: string | null;
  /** For notes: an inline-style or text edge-space difference; 'order' for a rule-order mismatch. */
  kind?: 'style' | 'space' | 'order';
}

export interface VerifyResult {
  ok: boolean;
  expectedLines: number;
  actualLines: number;
  mismatches: VerifyMismatch[];
  /** Inline-style or text edge-space differences: reported, never failing. */
  notes: VerifyMismatch[];
}

/** The Element outline lines of a design.md, or null when it has none. */
export function designOutline(designMd: string): string[] | null {
  const head = designMd.indexOf('### Element outline');
  if (head === -1) return null;
  const open = designMd.indexOf('```text\n', head);
  if (open === -1) return null;
  const close = designMd.indexOf('\n```', open + 8);
  return designMd
    .slice(open + 8, close === -1 ? undefined : close)
    .split('\n')
    .filter((l) => l.length > 0 && !l.startsWith('… truncated'));
}

/** Sort the attributes inside every tag of an SVG markup string. */
function normalizeMarkup(markup: string): string {
  return markup.replace(/<([a-zA-Z][\w:-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>/g, (_m, tag: string, attrs: string, slash: string) => {
    const list = (attrs.match(/[^\s=>]+(?:="[^"]*")?/g) ?? []).sort();
    return `<${tag}${list.length ? ` ${list.join(' ')}` : ''}${slash}>`;
  });
}

/** Canonical form of one outline line: SVG attribute order does not matter. */
function normalizeLine(line: string): string {
  const at = line.indexOf(' = <svg');
  if (at === -1) return line;
  // The line's label already carries the svg's classes; a class attribute on
  // the root tag of the markup is the same information twice.
  const markup = line.slice(at + 3).replace(/^<svg([^>]*?)\s+class="[^"]*"/, '<svg$1');
  return line.slice(0, at + 3) + normalizeMarkup(markup);
}

/**
 * The structural part of a line: nesting, tag, classes, attributes, text and
 * SVG markup, without the inline `{ … }` style. Moving a declaration from an
 * inline style into a stylesheet rule renders the same; structure does not.
 */
function structure(line: string): string {
  return normalizeLine(line).replace(/ \{ [^{}]* \}(?= = <svg|$)/, '');
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Does the outline line at `i` have a sibling before / after it under the same
 * parent? An edge space next to a sibling renders ("Why now:" + " You are…");
 * at the very start or end of its parent it does not.
 */
function siblings(lines: string[], i: number): { before: boolean; after: boolean } {
  const d = indentOf(lines[i]!);
  const before = i > 0 && indentOf(lines[i - 1]!) >= d;
  let after = false;
  for (let k = i + 1; k < lines.length; k++) {
    const dk = indentOf(lines[k]!);
    if (dk < d) break;
    if (dk === d) { after = true; break; }
  }
  return { before, after };
}

/** Two text lines that differ only in edge whitespace inside the quotes. */
function edgeSpaceOnly(a: string, b: string): boolean {
  const qa = /^(\s*)"(.*)"$/.exec(a);
  const qb = /^(\s*)"(.*)"$/.exec(b);
  return !!qa && !!qb && qa[1] === qb[1] && qa[2]!.trim() === qb[2]!.trim() && qa[2] !== qb[2];
}

/**
 * Compare two outlines on structure. Inline-style differences are notes (a
 * value moved into a stylesheet rule renders the same). A text edge-space
 * difference fails when the space sits next to a sibling, where it renders
 * ("Why now:" + " You are…" lost its space in a live-capture build); at the
 * start or end of the parent it is a note. Nesting, tags, classes,
 * attributes, text and SVG are what this check guarantees.
 */
export function compareOutlines(expected: string[], actual: string[], limit = 5): VerifyResult {
  const mismatches: VerifyMismatch[] = [];
  const notes: VerifyMismatch[] = [];
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i] ?? null;
    const a = actual[i] ?? null;
    if (e !== null && a !== null && normalizeLine(e) === normalizeLine(a)) continue;
    if (e !== null && a !== null && structure(e) === structure(a)) {
      if (notes.length < limit) notes.push({ line: i + 1, expected: e, actual: a, kind: 'style' });
      continue;
    }
    if (e !== null && a !== null && edgeSpaceOnly(e, a)) {
      const te = e.trim().slice(1, -1);
      const ta = a.trim().slice(1, -1);
      const sib = siblings(expected, i);
      const leadDiffers = /^\s/.test(te) !== /^\s/.test(ta);
      const trailDiffers = /\s$/.test(te) !== /\s$/.test(ta);
      if ((leadDiffers && sib.before) || (trailDiffers && sib.after)) {
        if (mismatches.length < limit) mismatches.push({ line: i + 1, expected: e, actual: a });
      } else if (notes.length < limit) {
        notes.push({ line: i + 1, expected: e, actual: a, kind: 'space' });
      }
      continue;
    }
    if (e === a) continue;
    if (mismatches.length < limit) mismatches.push({ line: i + 1, expected: e, actual: a });
  }
  return { ok: mismatches.length === 0, expectedLines: expected.length, actualLines: actual.length, mismatches, notes };
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/** The longhand properties a declaration writes, so shorthands overlap their parts. */
export function longhands(property: string): string[] {
  const p = property.toLowerCase();
  if (p === 'border') return SIDES.flatMap((s) => ['width', 'style', 'color'].map((k) => `border-${s}-${k}`));
  const side = /^border-(top|right|bottom|left)$/.exec(p);
  if (side) return ['width', 'style', 'color'].map((k) => `border-${side[1]}-${k}`);
  const kind = /^border-(width|style|color)$/.exec(p);
  if (kind) return SIDES.map((s) => `border-${s}-${kind[1]}`);
  if (p === 'border-radius') return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => `border-${c}-radius`);
  if (p === 'margin' || p === 'padding') return SIDES.map((s) => `${p}-${s}`);
  if (p === 'inset') return SIDES;
  if (p === 'gap') return ['row-gap', 'column-gap'];
  if (p === 'background') return ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat'];
  if (p === 'font') return ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'];
  if (p === 'outline') return ['outline-width', 'outline-style', 'outline-color'];
  if (p === 'transition') return ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'];
  if (p === 'animation') return ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count'];
  return [p];
}

const ruleKey = (r: CssRule): string => `${r.media ?? ''}|${r.selector}`;

interface ElementShape {
  tag: string;
  classes: Set<string>;
}

/** Tag and classes of each element line in an outline (`div.card.p-4[...] { … }`). */
export function outlineElements(outline: string[]): ElementShape[] {
  const out: ElementShape[] = [];
  for (const raw of outline) {
    const line = raw.trim();
    if (!line || line.startsWith('"')) continue;
    const head = line.split(/[\s[{]/)[0]!;
    const [tag, ...rest] = head.split('.');
    out.push({ tag: tag!.replace(/#.*$/, ''), classes: new Set(rest) });
  }
  return out;
}

/** The final compound of each selector in a list: its tag (or '') and classes. */
function subjects(selector: string): { tag: string; classes: string[] }[] {
  return selector.split(',').map((part) => {
    const compounds = part.trim().split(/\s*[\s>+~]\s*/);
    const last = (compounds[compounds.length - 1] ?? '').replace(/\[[^\]]*\]/g, '');
    const classes: string[] = [];
    // Class names with escapes (`.hover\:bg-x`); stop at an unescaped `:` (pseudo).
    for (const m of last.matchAll(/\.((?:\\.|[\w-])+)/g)) classes.push(m[1]!.replace(/\\(.)/g, '$1'));
    const tag = /^[a-zA-Z][\w-]*/.exec(last)?.[0]?.toLowerCase() ?? '';
    return { tag, classes };
  });
}

/**
 * True when every property both rules write is written with the same value
 * in each (so whichever comes last, the result is identical). A shorthand
 * against a longhand is never treated as equal.
 */
function sameValuesWhereTheyOverlap(a: CssRule, b: CssRule): boolean {
  const la = new Set(a.declarations.flatMap((d) => longhands(d.property)));
  for (const db of b.declarations) {
    if (!longhands(db.property).some((p) => la.has(p))) continue;
    const da = a.declarations.find((d) => d.property === db.property);
    if (!da || da.value !== db.value) return false;
  }
  return true;
}

/** Could one element match both selectors? Judged against the design's own elements. */
function shareAnElement(a: string, b: string, elements: ElementShape[]): boolean {
  const sa = subjects(a);
  const sb = subjects(b);
  const fits = (el: ElementShape, s: { tag: string; classes: string[] }) =>
    (!s.tag || s.tag === '*' || s.tag === el.tag) && s.classes.every((c) => el.classes.has(c));
  return elements.some((el) => sa.some((x) => fits(el, x)) && sb.some((y) => fits(el, y)));
}

/**
 * Stylesheet rule order (cascade). For every pair of design rules that the
 * build also has and that write an overlapping property, the build must keep
 * the design's order — otherwise the later one wins the other way round.
 * Only pairs some element of the design actually matches both of count:
 * reordering `hr` and `body` changes nothing.
 */
export function compareRuleOrder(design: CssRule[], build: CssRule[], elements: ElementShape[], limit = 5): VerifyMismatch[] {
  const sheet = (rules: CssRule[]) => rules.filter((r) => !r.selector.startsWith('inline '));
  const pos = new Map<string, number>();
  sheet(build).forEach((r, i) => { if (!pos.has(ruleKey(r))) pos.set(ruleKey(r), i); });
  const present = sheet(design).filter((r) => pos.has(ruleKey(r)));
  const props = present.map((r) => new Set(r.declarations.flatMap((d) => longhands(d.property))));
  const out: VerifyMismatch[] = [];
  for (let j = 1; j < present.length && out.length < limit; j++) {
    for (let i = 0; i < j; i++) {
      if (ruleKey(present[i]!) === ruleKey(present[j]!)) continue;
      if (pos.get(ruleKey(present[i]!))! < pos.get(ruleKey(present[j]!))!) continue;
      if (![...props[j]!].some((p) => props[i]!.has(p))) continue;
      if (sameValuesWhereTheyOverlap(present[i]!, present[j]!)) continue;
      if (!shareAnElement(present[i]!.selector, present[j]!.selector, elements)) continue;
      out.push({
        line: j + 1,
        expected: `${present[i]!.selector} before ${present[j]!.selector}`,
        actual: `${present[j]!.selector} before ${present[i]!.selector}`,
        kind: 'order',
      });
      break;
    }
  }
  return out;
}

/** Verify a built HTML page against a design.md's Element outline and rule order. */
export function verifyBuild(designMd: string, buildPath: string, opts: { projectRoot: string }): VerifyResult {
  const expected = designOutline(designMd);
  if (!expected) throw new DesignSourceError('design.md has no Element outline to verify against');
  const built = extractDesign([buildPath], opts);
  const result = compareOutlines(expected, built.outline);
  const designRules = designStyleRules(designMd);
  const order = designRules ? compareRuleOrder(designRules, built.rules, outlineElements(expected)) : [];
  return { ...result, ok: result.ok && order.length === 0, mismatches: [...result.mismatches, ...order] };
}

/** The Style rules (verbatim) section of a design.md, parsed back into rules. */
export function designStyleRules(designMd: string): CssRule[] | null {
  const head = designMd.indexOf('### Style rules (verbatim)');
  if (head === -1) return null;
  const end = designMd.indexOf('<!-- design-md:generated:end -->', head);
  const section = designMd.slice(head, end === -1 ? undefined : end);
  const rules: CssRule[] = [];
  let media: string | undefined;
  let inCss = false;
  for (const line of section.split('\n')) {
    if (line.startsWith('#### ')) media = line.slice(5).trim();
    else if (line.startsWith('```css')) inCss = true;
    else if (line.startsWith('```')) inCss = false;
    else if (inCss && line.trim()) {
      const parsed = parseCss(line);
      for (const r of parsed.rules) rules.push(media ? { ...r, media } : r);
    }
  }
  return rules;
}

export function formatVerify(result: VerifyResult, buildPath: string): string {
  const noteLines = result.notes.map((m) =>
    m.kind === 'space'
      ? `  note, line ${m.line}: text edge spaces differ — expected ${m.expected!.trim()}, built ${m.actual!.trim()}`
      : `  note, line ${m.line}: inline style differs (fine if a stylesheet rule supplies the same values) — expected ${m.expected!.trim()}`,
  );
  if (result.ok) return [`${buildPath} matches design.md's element outline (${result.expectedLines} lines)`, ...noteLines].join('\n');
  const lines = [
    `${buildPath} does not match design.md's element outline (expected ${result.expectedLines} lines, built ${result.actualLines}). First difference(s):`,
  ];
  for (const m of result.mismatches) {
    if (m.kind === 'order') {
      lines.push(`  rule order: the design has ${m.expected}; the build has ${m.actual} — a later rule overrides an earlier one`);
      continue;
    }
    lines.push(`  line ${m.line}:`, `    expected: ${m.expected ?? '(nothing — the build has extra elements)'}`, `    built:    ${m.actual ?? '(nothing — the build is missing elements)'}`);
  }
  lines.push(...noteLines);
  lines.push('Fix the build so each element has the same nesting (indentation), classes, attributes, inline style and text as the outline, and its stylesheet rules keep the order Style rules lists them, then verify again.');
  return lines.join('\n');
}
