/**
 * Code-drift classification (REQ-LINKACC-002).
 *
 * When a linked symbol's signature changes, the resolver records WHAT changed:
 *
 *  - `rename-only`  — same parameter count, parameter types and return type;
 *                     only parameter names differ
 *  - `type-change`  — same parameter count, but a parameter type or the return
 *                     type differs
 *  - `shape-change` — parameters added or removed, or any other difference
 *                     (modifiers, defaults, generics, destructuring patterns,
 *                     formatting) that is neither of the above
 *  - `unclassified` — the baseline or current signature is missing, or either
 *                     one cannot be parsed
 *
 * Purely syntactic and deterministic: the kind is derived from the two
 * signature strings the index stored, never from a hash difference alone.
 * Silent beats wrong — anything the parser is not sure about is
 * `unclassified`, never `rename-only`.
 *
 * The kind is an explanation only. It never changes a link's state.
 */

import type { SpecLink } from '../types';
import { linkSourceLabel } from './link-repoint';
import type { SpecLinkDriftKind } from '../types';

/** One parsed parameter. `type` is null for an untyped parameter. */
export interface ParsedParam {
  name: string;
  type: string | null;
  /**
   * Everything about the parameter that is neither its name nor its type:
   * modifiers (`readonly`, `final`, `...`, `*`), optional markers, default
   * values and destructuring patterns. A difference here is a shape change.
   */
  extra: string;
}

export interface ParsedSignature {
  /** Text before the parameter list (modifiers, generics), normalised. */
  prefix: string;
  params: ParsedParam[];
  /** Return type with its `:` / `->` introducer stripped; null when absent. */
  returnType: string | null;
}

const OPENERS: Record<string, string> = { '(': ')', '<': '>', '[': ']', '{': '}' };
const CLOSERS = new Set([')', '>', ']', '}']);

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split `text` on `sep` at bracket depth 0. Returns null when the brackets
 * are unbalanced. `=>` and `->` arrows are not treated as closing `>`.
 */
function splitTopLevel(text: string, sep: string): string[] | null {
  const parts: string[] = [];
  const stack: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '>' && (text[i - 1] === '=' || text[i - 1] === '-')) continue;
    if (OPENERS[ch]) {
      stack.push(OPENERS[ch]!);
      continue;
    }
    if (CLOSERS.has(ch)) {
      if (stack.pop() !== ch) return null;
      continue;
    }
    if (stack.length === 0 && text.startsWith(sep, i)) {
      // `==`, `=>`, `>=`, `<=`, `!=` are not assignment separators.
      if (sep === '=' && (text[i + 1] === '=' || text[i + 1] === '>' || /[!<>=]/.test(text[i - 1] ?? ''))) {
        continue;
      }
      parts.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  if (quote || stack.length > 0) return null;
  parts.push(text.slice(start));
  return parts;
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const LEADING_MODIFIERS = /^(?:\.\.\.|\*\*|\*|&)/;

/** Parse one parameter. Returns null when it cannot be read with confidence. */
function parseParam(raw: string, language: string | undefined): ParsedParam | null {
  const eq = splitTopLevel(raw, '=');
  if (!eq) return null;
  const decl = norm(eq[0]!);
  const defaultValue = eq.length > 1 ? norm(eq.slice(1).join('=')) : '';
  if (decl === '') return null;
  const dflt = defaultValue ? `=${defaultValue}` : '';
  // Python's bare `*` / `/` separators are markers, not parameters with names.
  if (decl === '*' || decl === '/') return { name: '', type: null, extra: `|${decl}` };

  // `name: Type` / `name?: Type` (TypeScript, Python, Rust, Kotlin, Swift, …)
  const colon = splitTopLevel(decl, ':');
  if (!colon) return null;
  if (colon.length >= 2) {
    const left = norm(colon[0]!);
    const type = norm(colon.slice(1).join(':'));
    if (left === '' || type === '') return null;
    const tokens = left.split(' ');
    let name = tokens.pop()!;
    const modifiers = tokens.join(' ');
    let optional = '';
    if (name.endsWith('?')) {
      optional = '?';
      name = name.slice(0, -1);
    }
    // A destructuring pattern is not a plain name — any change to it is
    // a shape change, so carry it in `extra` with an empty name.
    if (name.startsWith('{') || name.startsWith('[')) {
      return { name: '', type, extra: `${modifiers}|${name}${optional}${dflt}` };
    }
    const lead = name.match(LEADING_MODIFIERS)?.[0] ?? '';
    name = name.slice(lead.length);
    if (!IDENT.test(name)) return null;
    return { name, type, extra: `${modifiers}|${lead}${optional}${dflt}` };
  }

  // No colon: `name`, or `Type name` (C-family) / `name Type` (Go).
  const tokens = decl.split(' ');
  if (tokens.length === 1) {
    let name = tokens[0]!;
    const lead = name.match(LEADING_MODIFIERS)?.[0] ?? '';
    name = name.slice(lead.length);
    if (!IDENT.test(name)) return null;
    return { name, type: null, extra: `|${lead}${dflt}` };
  }
  if (language === 'go') {
    const [name, ...rest] = tokens;
    if (!IDENT.test(name!)) return null;
    return { name: name!, type: rest.join(' '), extra: `|${dflt}` };
  }
  if (language === undefined) return null; // name position is ambiguous
  // C-family: the last token is the name; pointer/reference sigils and array
  // suffixes on it belong to the type.
  let last = tokens.pop()!;
  const sigils = last.match(/^[*&]+/)?.[0] ?? '';
  last = last.slice(sigils.length);
  const array = last.match(/(\[[^\]]*\])+$/)?.[0] ?? '';
  last = last.slice(0, last.length - array.length);
  const name = last.replace(/^\$/, '');
  if (!IDENT.test(name)) return null;
  const type = norm(`${tokens.join(' ')} ${sigils}${array}`);
  return { name, type, extra: `|${dflt}` };
}

/**
 * Parse a stored signature string into its parameters and return type.
 * Returns null for anything the parser cannot read with confidence —
 * a missing/empty string, unbalanced brackets, or no parameter list.
 *
 * Handles the shapes the extractors store: `(a: T, b?: U): R` (TypeScript),
 * `(a, b: int = 1) -> R` (Python), `(a int, b string) error` (Go) and
 * C-family `(int a, const char *b)` when `language` says which side the name is.
 */
export function parseSignature(sig: string | null | undefined, language?: string): ParsedSignature | null {
  if (typeof sig !== 'string') return null;
  const text = sig.trim();
  if (text === '') return null;
  const open = text.indexOf('(');
  if (open < 0) return null;
  const close = matchingParen(text, open);
  if (close < 0) return null;

  const prefix = norm(text.slice(0, open));
  if (prefix !== '' && !splitTopLevel(prefix, ',')) return null;
  const inner = text.slice(open + 1, close);
  let tail = text.slice(close + 1).trim();
  if (tail !== '' && !splitTopLevel(tail, ',')) return null;
  tail = tail.replace(/^(?::|->)\s*/, '');
  const returnType = tail === '' ? null : norm(tail);

  const pieces = splitTopLevel(inner, ',');
  if (!pieces) return null;
  // A trailing comma leaves an empty last piece; any other empty piece is malformed.
  if (pieces.length > 0 && norm(pieces[pieces.length - 1]!) === '') pieces.pop();
  const params: ParsedParam[] = [];
  for (const piece of pieces) {
    if (norm(piece) === '') {
      if (pieces.length === 1) break; // `()`
      return null;
    }
    const p = parseParam(piece, language);
    if (!p) return null;
    params.push(p);
  }

  if (language === 'go') {
    // Go: either every parameter is unnamed (`(int, string)`) or grouped
    // names share the next type (`(a, b int)`).
    if (params.length > 0 && params.every((p) => p.type === null)) {
      for (const p of params) {
        p.type = p.name;
        p.name = '';
      }
    } else {
      let next: string | null = null;
      for (let i = params.length - 1; i >= 0; i--) {
        const p = params[i]!;
        if (p.type === null) {
          if (next === null) return null;
          p.type = next;
        } else next = p.type;
      }
    }
  }

  return { prefix, params, returnType };
}

/**
 * Classify the change between a link's signature baseline and the symbol's
 * current signature. Never infers a specific kind it cannot prove from the
 * parsed text: missing or unparseable input is `unclassified`.
 */
export function classifySignatureDrift(
  before: string | null | undefined,
  after: string | null | undefined,
  language?: string
): SpecLinkDriftKind {
  const a = parseSignature(before, language);
  const b = parseSignature(after, language);
  if (!a || !b) return 'unclassified';

  if (a.params.length !== b.params.length) return 'shape-change';

  const typeDiffers =
    a.returnType !== b.returnType || a.params.some((p, i) => p.type !== b.params[i]!.type);
  if (typeDiffers) return 'type-change';

  const extraDiffers =
    a.prefix !== b.prefix || a.params.some((p, i) => p.extra !== b.params[i]!.extra);
  if (extraDiffers) return 'shape-change';

  const nameDiffers = a.params.some((p, i) => p.name !== b.params[i]!.name);
  if (nameDiffers) return 'rename-only';

  // Equal once normalised (e.g. whitespace only): the parse finds no rename,
  // type or shape change, so naming one would infer a kind from a raw text
  // difference alone, which REQ-LINKACC-002 forbids.
  return 'unclassified';
}

/** The drift fields a surface needs to label a drifted link. */
export interface DriftLabelSource {
  driftAxis?: 'spec' | 'code' | null;
  driftKind?: SpecLinkDriftKind | null;
}

/**
 * The shared drift label every surface prints next to a drifted link
 * (REQ-LINKACC-002.A4): `drift=code kind=rename-only`, `drift=spec`, or ''
 * when the link has no drift axis. One function so `specship drifted`,
 * `specship_spec` and `specship_node` can never word it differently.
 */
export function formatDriftLabel(link: DriftLabelSource): string {
  if (!link.driftAxis) return '';
  return link.driftKind ? `drift=${link.driftAxis} kind=${link.driftKind}` : `drift=${link.driftAxis}`;
}

/** The `specship drifted` line for one link (REQ-LINKACC-002.A4). */
export function formatDriftedLine(
  link: DriftLabelSource & {
    id: number;
    state: string;
    specId: string;
    targetFilePath: string;
    targetQualifiedName: string;
    provenance: string;
    metadata?: Record<string, unknown>;
  }
): string {
  const label = formatDriftLabel(link);
  const drift = label ? ` [${label}]` : '';
  // The same source label specship_spec prints (REQ-LINKACC-012).
  const source = linkSourceLabel(link as Pick<SpecLink, 'provenance' | 'metadata'>);
  return `#${link.id} [${link.state}${drift}] ${link.specId} → ${link.targetFilePath}:${link.targetQualifiedName} <${source}>`;
}
