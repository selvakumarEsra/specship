/**
 * Deterministic design-value extraction for design.md (DESIGNMD-DOC,
 * REQ-DESIGNMD-001).
 *
 * A low-end model asked to read a 2,000-line design snapshot rounds values,
 * invents near-miss colors and misses state rules. This module does that
 * reading in code instead: every custom property, every rule, every literal
 * value, counted and attributed to the selectors that use it. Nothing here
 * interprets the design — it records what is written.
 *
 * Sources: Claude Design snapshots (`.html` + the local stylesheets they
 * link), plain `.css`, Figma code exports (`.tsx` / `.jsx`), and Figma
 * variables exports (`.json`).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CssDeclaration, CssKeyframes, CssRule, collapse, parseCss, parseDeclarationList, splitTopLevel } from './css';

export type SourceKind = 'html' | 'css' | 'code' | 'variables';

export interface DesignSource {
  /** Project-relative path, `/`-separated. */
  path: string;
  sha256: string;
  kind: SourceKind;
}

export interface CustomProperty {
  selector: string;
  name: string;
  value: string;
  media?: string;
}

export interface DesignVariable {
  name: string;
  value: string;
}

export const INVENTORY_KINDS = [
  'Colors',
  'Font families',
  'Font sizes',
  'Font weights',
  'Line heights',
  'Letter spacing',
  'Spacing',
  'Sizes',
  'Radii',
  'Borders',
  'Shadows',
  'Motion',
  'Opacity',
  'Z-index',
  'Breakpoints',
] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export interface InventoryEntry {
  value: string;
  count: number;
  /** Selectors (or `file:line` for code) that use the value, sorted. */
  usedBy: string[];
}

export interface InlineSvg {
  id: string;
  /** The element's markup, whitespace collapsed. */
  markup: string;
  count: number;
}

export interface DesignExtraction {
  sources: DesignSource[];
  customProperties: CustomProperty[];
  variables: DesignVariable[];
  rules: CssRule[];
  keyframes: CssKeyframes[];
  fontFaces: CssDeclaration[][];
  /** Remote stylesheet / font links, verbatim. */
  fontLinks: string[];
  inventories: Record<InventoryKind, InventoryEntry[]>;
  /** Utility classes from code exports (`p-4`, `text-sm`), with counts. */
  utilityClasses: InventoryEntry[];
  /** Image / icon / font file references. */
  assets: InventoryEntry[];
  /** Indented element outline of HTML sources, with inline styles and text. */
  outline: string[];
  /** Distinct inline SVG elements (verbatim markup + use count). */
  svgs: InlineSvg[];
  outlineTruncated: boolean;
  /** Local stylesheets the source links to that could not be read. */
  missingLinks: string[];
}

export class DesignSourceError extends Error {}

/** Max outline lines — the verbatim snapshot carries the rest. */
export const OUTLINE_LIMIT = 3000;

const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/** Every color literal written in a value, in order. */
export function colorLiterals(value: string): string[] {
  return (value.match(COLOR_RE) ?? []).map((c) => collapse(c));
}

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function toProjectPath(abs: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, abs);
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs).split(path.sep).join('/');
}

function kindOf(file: string): SourceKind {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.json') return 'variables';
  return 'code';
}

/** Property → inventory, for the properties whose whole value is the token. */
function inventoryFor(property: string): InventoryKind | null {
  if (property === 'font-family') return 'Font families';
  if (property === 'font-size') return 'Font sizes';
  if (property === 'font-weight') return 'Font weights';
  if (property === 'line-height') return 'Line heights';
  if (property === 'letter-spacing') return 'Letter spacing';
  if (/^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)/.test(property)) return 'Spacing';
  if (/^(width|height|min-width|max-width|min-height|max-height|flex-basis|inline-size|block-size)$/.test(property)) return 'Sizes';
  if (/^border(-[a-z]+)*-radius$/.test(property)) return 'Radii';
  if (/^(border|outline)(-(top|right|bottom|left|width|style))?$/.test(property)) return 'Borders';
  if (property === 'box-shadow' || property === 'text-shadow') return 'Shadows';
  if (/^(transition|animation)(-|$)/.test(property)) return 'Motion';
  if (property === 'opacity') return 'Opacity';
  if (property === 'z-index') return 'Z-index';
  return null;
}

class Inventory {
  private readonly entries = new Map<string, { count: number; usedBy: Set<string> }>();
  add(value: string, by: string): void {
    const e = this.entries.get(value) ?? { count: 0, usedBy: new Set<string>() };
    e.count++;
    e.usedBy.add(by);
    this.entries.set(value, e);
  }
  list(): InventoryEntry[] {
    return [...this.entries.entries()]
      .map(([value, e]) => ({ value, count: e.count, usedBy: [...e.usedBy].sort() }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  }
}

class Collector {
  readonly sources: DesignSource[] = [];
  readonly customProperties: CustomProperty[] = [];
  readonly variables: DesignVariable[] = [];
  readonly rules: CssRule[] = [];
  readonly keyframes: CssKeyframes[] = [];
  readonly fontFaces: CssDeclaration[][] = [];
  readonly fontLinks = new Set<string>();
  readonly inventories = new Map<InventoryKind, Inventory>(INVENTORY_KINDS.map((k) => [k, new Inventory()]));
  readonly utilities = new Inventory();
  readonly assets = new Inventory();
  readonly outline: string[] = [];
  outlineTruncated = false;
  readonly missingLinks = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(readonly projectRoot: string) {}

  inv(kind: InventoryKind): Inventory {
    return this.inventories.get(kind)!;
  }

  /** Register a source file once; returns its text, or null when already read. */
  read(abs: string, kind: SourceKind): string | null {
    const key = path.resolve(abs);
    if (this.seen.has(key)) return null;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(key);
    } catch (err) {
      throw new DesignSourceError(
        `cannot read design source ${toProjectPath(key, this.projectRoot)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.seen.add(key);
    this.sources.push({ path: toProjectPath(key, this.projectRoot), sha256: sha256(buf), kind });
    return buf.toString('utf-8');
  }

  declaration(decl: CssDeclaration, by: string, media?: string): void {
    for (const c of colorLiterals(decl.value)) this.inv('Colors').add(c, by);
    const kind = inventoryFor(decl.property);
    if (kind) this.inv(kind).add(decl.value, by);
    for (const m of decl.value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      if (!m[2]!.startsWith('data:')) this.assets.add(m[2]!, by);
    }
    if (decl.property.startsWith('--')) {
      this.customProperties.push({ selector: by, name: decl.property, value: decl.value, ...(media ? { media } : {}) });
    }
  }

  css(text: string, origin?: string): void {
    const parsed = parseCss(text);
    for (const rule of parsed.rules) {
      this.rules.push(rule);
      for (const decl of rule.declarations) this.declaration(decl, rule.selector, rule.media);
      if (rule.media) this.breakpoints(rule.media);
    }
    for (const kf of parsed.keyframes) {
      this.keyframes.push(kf);
      for (const c of colorLiterals(kf.body)) this.inv('Colors').add(c, `@keyframes ${kf.name}`);
    }
    for (const face of parsed.fontFaces) {
      this.fontFaces.push(face);
      for (const d of face) {
        for (const m of d.value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
          if (!m[2]!.startsWith('data:')) this.assets.add(m[2]!, '@font-face');
        }
      }
    }
    for (const imp of parsed.imports) {
      const url = /url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3/.exec(imp);
      const target = url?.[2] ?? url?.[4];
      if (target && /^https?:/.test(target)) this.fontLinks.add(target);
      else if (target && origin) this.linked(path.resolve(path.dirname(origin), target));
    }
  }

  breakpoints(media: string): void {
    for (const m of media.matchAll(/\(\s*((?:min|max)-(?:width|height)|width|height)\s*(?::|[<>]=?)\s*([^)]+)\)/g)) {
      this.inv('Breakpoints').add(collapse(m[0]), media);
    }
  }

  /** A stylesheet referenced by another source: record it as missing instead of failing. */
  linked(abs: string): void {
    if (!fs.existsSync(abs)) {
      this.missingLinks.add(toProjectPath(abs, this.projectRoot));
      return;
    }
    this.file(abs);
  }

  file(abs: string): void {
    const kind = kindOf(abs);
    const text = this.read(abs, kind);
    if (text === null) return;
    if (kind === 'html') this.html(text, abs);
    else if (kind === 'css') this.css(text, abs);
    else if (kind === 'variables') this.variablesJson(text, abs);
    else this.code(text, toProjectPath(abs, this.projectRoot));
  }

  html(text: string, abs: string): void {
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) this.css(m[1]!, abs);
    for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      const href = attr(tag, 'href');
      if (!href) continue;
      const rel = (attr(tag, 'rel') ?? '').toLowerCase();
      if (/^(https?:)?\/\//.test(href)) {
        if (rel.includes('stylesheet') || /fonts\.(googleapis|gstatic)|typekit|fonts\./.test(href)) this.fontLinks.add(href);
      } else if (rel.includes('stylesheet')) {
        this.linked(path.resolve(path.dirname(abs), href.split(/[?#]/)[0]!));
      } else if (rel.includes('icon')) {
        this.assets.add(href, '<link rel=icon>');
      }
    }
    this.markup(text);
  }

  /**
   * Inline styles, image references, inline SVG and the element outline.
   *
   * Each outline line is one element with its own inline declarations in
   * braces, so a design whose styling lives in `style=""` attributes (every
   * React-rendered Claude Design export) keeps each value next to the element
   * it belongs to. Text nodes are their own quoted lines, in document order.
   * Inline SVG is written verbatim on its own outline line: an id-and-lookup
   * scheme let a small model paste the wrong icon (design-md pixel eval).
   */
  markup(text: string): void {
    const body = text.replace(/<(script|style|template|head|title)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, '');
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    // <html> stays: a theme class on it (`html.dark`) changes every color.
    const SKIP = new Set(['head', 'meta', 'link', 'title', 'base']);
    let depth = 0;
    let svgUntil = -1;
    const push = (line: string): void => {
      if (this.outline.length < OUTLINE_LIMIT) this.outline.push(line);
      else this.outlineTruncated = true;
    };
    const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
    for (const m of body.matchAll(tagRe)) {
      if (m.index! < svgUntil) continue;
      if (m[4] !== undefined) {
        // Collapse runs but keep one edge space: in inline text it renders
        // ("account? " + <a>Sign up</a> — trimming it glued the words).
        const t = decodeEntities(m[4]).replace(/\s+/g, ' ');
        // A whitespace-only node with no newline is a real space between
        // inline siblings (`</span> <span>` in serialized live DOM) and it
        // renders; newline-indented whitespace is source pretty-printing.
        if (t.trim() || (t === ' ' && !/\n/.test(m[4]))) push(`${'  '.repeat(depth)}"${t}"`);
        continue;
      }
      const closing = m[1] === '/';
      const tag = m[2]!.toLowerCase();
      const attrs = m[3] ?? '';
      if (closing) {
        if (!VOID.has(tag) && !SKIP.has(tag)) depth = Math.max(0, depth - 1);
        continue;
      }
      const selfClosing = /\/\s*$/.test(attrs);
      const label = elementLabel(tag, attrs);
      // Decode before parsing: live DOM serializes quotes as `&quot;`, whose
      // `;` would otherwise end the declaration (`font-family: &quot`).
      const rawStyle = attr(attrs, 'style');
      const style = rawStyle === null ? null : decodeEntities(rawStyle);
      const decls = style ? parseDeclarationList(style) : [];
      if (decls.length > 0) {
        for (const decl of decls) this.declaration(decl, `inline ${label}`);
        this.rules.push({ selector: `inline ${label}`, declarations: decls });
      }
      for (const name of ['src', 'srcset', 'poster']) {
        const v = attr(attrs, name);
        if (v && !v.startsWith('data:')) for (const part of v.split(',')) this.assets.add(part.trim().split(/\s+/)[0]!, label);
      }
      if (SKIP.has(tag)) continue;
      const styleText = decls.length > 0 ? ` { ${decls.map((d) => `${d.property}: ${d.value};`).join(' ')} }` : '';
      if (tag === 'svg' && !selfClosing) {
        const end = matchingClose(body, m.index!, 'svg');
        const markup = collapse(body.slice(m.index!, end));
        const id = this.svg(markup, label);
        for (const c of colorLiterals(markup)) this.inv('Colors').add(c, id);
        push(`${'  '.repeat(depth)}${label}${styleText} = ${markup}`);
        svgUntil = end;
        continue;
      }
      push(`${'  '.repeat(depth)}${label}${styleText}`);
      if (!VOID.has(tag) && !selfClosing) depth++;
    }
  }

  private readonly svgIds = new Map<string, { id: string; usedBy: Set<string>; count: number }>();

  svg(markup: string, by: string): string {
    const known = this.svgIds.get(markup);
    if (known) {
      known.count++;
      known.usedBy.add(by);
      return known.id;
    }
    const id = `svg-${this.svgIds.size + 1}`;
    this.svgIds.set(markup, { id, usedBy: new Set([by]), count: 1 });
    return id;
  }

  svgList(): InlineSvg[] {
    return [...this.svgIds.entries()].map(([markup, e]) => ({ id: e.id, markup, count: e.count }));
  }

  variablesJson(text: string, abs: string): void {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new DesignSourceError(
        `design variables ${toProjectPath(abs, this.projectRoot)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const visit = (node: unknown, prefix: string): void => {
      if (node === null || node === undefined) return;
      if (typeof node !== 'object') {
        this.variable(prefix, String(node));
        return;
      }
      const obj = node as Record<string, unknown>;
      const leaf = obj['$value'] ?? obj['value'];
      if (leaf !== undefined && (typeof leaf !== 'object' || leaf === null)) {
        this.variable(prefix, String(leaf));
        return;
      }
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$')) continue;
        visit(obj[key], prefix ? `${prefix}/${key}` : key);
      }
    };
    visit(data, '');
  }

  variable(name: string, value: string): void {
    if (!name) return;
    this.variables.push({ name, value });
    const by = `variable ${name}`;
    for (const c of colorLiterals(value)) this.inv('Colors').add(c, by);
    const lower = name.toLowerCase();
    const guess: InventoryKind | null =
      /font.?family|typeface/.test(lower) ? 'Font families'
      : /font.?size|text.?size/.test(lower) ? 'Font sizes'
      : /weight/.test(lower) ? 'Font weights'
      : /line.?height|leading/.test(lower) ? 'Line heights'
      : /letter|tracking/.test(lower) ? 'Letter spacing'
      : /radius|rounded|corner/.test(lower) ? 'Radii'
      : /shadow|elevation/.test(lower) ? 'Shadows'
      : /space|spacing|gap|padding|margin/.test(lower) ? 'Spacing'
      : null;
    if (guess) this.inv(guess).add(value, by);
  }

  /** Figma / React code exports: Tailwind arbitrary values, style objects, literals. */
  code(text: string, file: string): void {
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      const by = `${file}:${idx + 1}`;
      let rest = line;
      for (const m of line.matchAll(/style=\{\{([^}]*)\}\}/g)) {
        for (const p of m[1]!.matchAll(/([A-Za-z]+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))/g)) {
          const property = p[1]!.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
          const raw = p[2] ?? p[3] ?? p[4]!;
          const unitless = /^(opacity|z-index|font-weight|line-height|flex|order)$/.test(property);
          const value = p[4] !== undefined && !unitless && p[4] !== '0' ? `${raw}px` : raw;
          this.declaration({ property, value }, by);
        }
        rest = rest.replace(m[0], ' ');
      }
      for (const cls of classTokens(line)) {
        const arb = /^((?:[a-z]+:)*)(-?[a-z][a-z-]*)-\[([^\]]+)\]$/.exec(cls);
        if (arb) {
          const value = arb[3]!.replace(/_/g, ' ');
          const kind = tailwindKind(arb[2]!, value);
          if (kind === 'Colors') this.inv('Colors').add(value, by);
          else {
            for (const c of colorLiterals(value)) this.inv('Colors').add(c, by);
            if (kind) this.inv(kind).add(value, by);
          }
          rest = rest.replace(cls, ' ');
        } else if (/^[a-z!-][\w:/.!-]*$/.test(cls) && /[-:]/.test(cls)) {
          this.utilities.add(cls, by);
        }
      }
      for (const c of colorLiterals(rest)) this.inv('Colors').add(c, by);
      for (const m of rest.matchAll(/\b(?:src|href)=["']([^"']+\.(?:png|jpe?g|gif|svg|webp|avif|ico))["']/gi)) {
        this.assets.add(m[1]!, by);
      }
    });
  }
}

/** Index just past the `</tag>` that closes the element opening at `start`. */
function matchingClose(text: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === '/') depth--;
    else if (m[2] !== '/') depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return text.length;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(` ${tag}`);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/**
 * An element as one outline token: tag, id, EVERY class (on a utility-class
 * design each class is a style — truncating them lost `bg-gray-950` and made a
 * small model guess), then the attributes that change what renders.
 */
function elementLabel(tag: string, attrs: string): string {
  const id = attr(attrs, 'id');
  const cls = (attr(attrs, 'class') ?? '').split(/\s+/).filter(Boolean);
  let label = tag;
  if (id) label += `#${id}`;
  if (cls.length) label += `.${cls.join('.')}`;
  for (const a of ['role', 'aria-label', 'type', 'placeholder', 'value', 'alt', 'aria-selected', 'aria-current', 'aria-expanded']) {
    const v = attr(attrs, a);
    if (v) label += `[${a}=${JSON.stringify(decodeEntities(v))}]`;
  }
  // Boolean attributes, tested with quoted values removed so a class named
  // "disabled" doesn't count.
  const bare = ` ${attrs.replace(/"[^"]*"|'[^']*'/g, '""')}`;
  for (const flag of ['disabled', 'checked', 'selected', 'readonly']) {
    if (new RegExp(`\\s${flag}(\\s|=|/|$)`, 'i').test(bare)) label += `[${flag}]`;
  }
  return label;
}

/** Class-like tokens from `className="…"` / `class="…"` and template strings. */
function classTokens(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/class(?:Name)?\s*=\s*(?:\{\s*)?(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) {
    out.push(...(m[1] ?? m[2] ?? m[3] ?? '').split(/\s+/).filter(Boolean));
  }
  return out;
}

function tailwindKind(prefix: string, value: string): InventoryKind | null {
  const isColor = colorLiterals(value).length > 0 && colorLiterals(value)[0] === value;
  const p = prefix.replace(/^-/, '');
  if (/^(bg|from|via|to|fill|stroke|ring|outline|accent|caret|decoration|divide|placeholder)$/.test(p)) return isColor ? 'Colors' : null;
  if (p === 'text') return isColor ? 'Colors' : 'Font sizes';
  if (p === 'border' || /^border-[trblxy]$/.test(p)) return isColor ? 'Colors' : 'Borders';
  if (/^(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|top|right|bottom|left|inset|inset-x|inset-y)$/.test(p)) return 'Spacing';
  if (/^(w|h|min-w|max-w|min-h|max-h|size|basis)$/.test(p)) return 'Sizes';
  if (/^rounded(-[a-z]+)?$/.test(p)) return 'Radii';
  if (p === 'shadow') return isColor ? 'Colors' : 'Shadows';
  if (p === 'leading') return 'Line heights';
  if (p === 'tracking') return 'Letter spacing';
  if (p === 'font') return /^\d+$/.test(value) ? 'Font weights' : 'Font families';
  if (/^(duration|delay|ease|transition|animate)$/.test(p)) return 'Motion';
  if (p === 'opacity') return 'Opacity';
  if (p === 'z') return 'Z-index';
  return null;
}

/**
 * Extract every literal visual value from the given sources. Paths resolve
 * against `projectRoot`. Throws `DesignSourceError` when a source is missing
 * or unreadable — the caller writes nothing in that case (REQ-DESIGNMD-001.A6).
 */
export function extractDesign(paths: string[], opts: { projectRoot: string }): DesignExtraction {
  if (paths.length === 0) throw new DesignSourceError('no design source given');
  const c = new Collector(opts.projectRoot);
  for (const p of paths) c.file(path.resolve(opts.projectRoot, p));
  const inventories = {} as Record<InventoryKind, InventoryEntry[]>;
  for (const k of INVENTORY_KINDS) inventories[k] = c.inv(k).list();
  return {
    sources: c.sources,
    customProperties: c.customProperties,
    variables: c.variables,
    rules: c.rules,
    keyframes: c.keyframes,
    fontFaces: c.fontFaces,
    fontLinks: [...c.fontLinks].sort(),
    inventories,
    utilityClasses: c.utilities.list(),
    assets: c.assets.list(),
    outline: c.outline,
    svgs: c.svgList(),
    outlineTruncated: c.outlineTruncated,
    missingLinks: [...c.missingLinks].sort(),
  };
}

export { splitTopLevel };
