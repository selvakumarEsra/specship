/**
 * A small, dependency-free CSS reader for design.md (DESIGNMD-DOC,
 * REQ-DESIGNMD-001).
 *
 * It does not validate CSS or compute the cascade. It walks the text and
 * records what is written: each rule's selector and declarations verbatim
 * (whitespace collapsed), the `@media` / `@supports` / `@container` condition
 * a rule sits under, `@keyframes` bodies and `@font-face` blocks. Native CSS
 * nesting is flattened (`&` replaced by the parent selector). The output order
 * is source order, so the same text always yields the same result.
 */

export interface CssDeclaration {
  property: string;
  value: string;
}

export interface CssRule {
  selector: string;
  declarations: CssDeclaration[];
  /** The enclosing conditional at-rule preludes, joined with ` and `. */
  media?: string;
}

export interface CssKeyframes {
  name: string;
  body: string;
  media?: string;
}

export interface ParsedCss {
  rules: CssRule[];
  keyframes: CssKeyframes[];
  fontFaces: CssDeclaration[][];
  /** `@import` targets, verbatim. */
  imports: string[];
}

type Item = { kind: 'stmt'; text: string } | { kind: 'block'; prelude: string; body: string };

const CONDITIONAL_AT_RULES = /^@(media|supports|container|layer|document|scope)\b/i;
const KEYFRAMES_AT_RULE = /^@(-webkit-|-moz-)?keyframes\s+/i;

export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Remove comments, leaving strings intact. */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Index just past the string literal starting at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === quote) return i + 1;
    else i++;
  }
  return text.length;
}

/** Index of the `}` matching the `{` at `open`. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return text.length;
}

/** Split one block's contents into top-level statements and nested blocks. */
function scan(text: string): Item[] {
  const items: Item[] = [];
  let buf = '';
  let parens = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i);
      buf += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    if (parens === 0 && ch === ';') {
      if (buf.trim()) items.push({ kind: 'stmt', text: buf.trim() });
      buf = '';
      i++;
      continue;
    }
    if (parens === 0 && ch === '{') {
      const close = matchBrace(text, i);
      items.push({ kind: 'block', prelude: buf.trim(), body: text.slice(i + 1, close) });
      buf = '';
      i = close + 1;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) items.push({ kind: 'stmt', text: buf.trim() });
  return items;
}

/** Split on commas that are not inside parentheses or brackets. */
export function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(buf);
      buf = '';
    } else buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function nestSelector(parent: string | undefined, child: string): string {
  const own = splitTopLevel(collapse(child));
  if (!parent) return own.join(', ');
  const parents = splitTopLevel(parent);
  const combined: string[] = [];
  for (const p of parents) {
    for (const c of own) combined.push(c.includes('&') ? c.replace(/&/g, p) : `${p} ${c}`);
  }
  return combined.join(', ');
}

function parseDeclaration(text: string): CssDeclaration | null {
  const colon = text.indexOf(':');
  if (colon <= 0) return null;
  const property = collapse(text.slice(0, colon));
  const value = collapse(text.slice(colon + 1));
  if (!property || /\s/.test(property)) return null;
  // An empty value is valid only for a custom property (`--tw-blur: ;`), and
  // it matters: Tailwind composes `backdrop-filter` / `filter` from such
  // variables, so dropping them changes what renders.
  if (!value && !property.startsWith('--')) return null;
  // Custom property names are case-sensitive; standard ones are not.
  return { property: property.startsWith('--') ? property : property.toLowerCase(), value };
}

/** Parse a `style=""` attribute or any `prop: value; …` list. */
export function parseDeclarationList(text: string): CssDeclaration[] {
  return scan(stripComments(text))
    .filter((item): item is { kind: 'stmt'; text: string } => item.kind === 'stmt')
    .map((item) => parseDeclaration(item.text))
    .filter((d): d is CssDeclaration => d !== null);
}

function walk(items: Item[], out: ParsedCss, media: string | undefined, selector: string | undefined): void {
  const declarations: CssDeclaration[] = [];
  for (const item of items) {
    if (item.kind !== 'stmt') continue;
    if (item.text.startsWith('@')) {
      const imp = /^@import\s+(.+)$/i.exec(item.text);
      if (imp) out.imports.push(collapse(imp[1]!));
      continue;
    }
    const decl = parseDeclaration(item.text);
    if (decl) declarations.push(decl);
  }
  if (selector && declarations.length > 0) {
    out.rules.push(media ? { selector, declarations, media } : { selector, declarations });
  }

  for (const item of items) {
    if (item.kind !== 'block') continue;
    const prelude = collapse(item.prelude);
    if (KEYFRAMES_AT_RULE.test(prelude)) {
      const name = prelude.replace(KEYFRAMES_AT_RULE, '').trim();
      const body = collapse(item.body);
      out.keyframes.push(media ? { name, body, media } : { name, body });
    } else if (/^@font-face\b/i.test(prelude)) {
      out.fontFaces.push(parseDeclarationList(item.body));
    } else if (CONDITIONAL_AT_RULES.test(prelude)) {
      const condition = /^@layer\b/i.test(prelude) ? media : media ? `${media} and ${prelude}` : prelude;
      walk(scan(item.body), out, condition, selector);
    } else if (prelude.startsWith('@')) {
      // @page, @property, … — keep their declarations under the at-rule prelude.
      walk(scan(item.body), out, media, prelude);
    } else if (prelude) {
      walk(scan(item.body), out, media, nestSelector(selector, prelude));
    }
  }
}

export function parseCss(text: string): ParsedCss {
  const out: ParsedCss = { rules: [], keyframes: [], fontFaces: [], imports: [] };
  walk(scan(stripComments(text)), out, undefined, undefined);
  return out;
}
