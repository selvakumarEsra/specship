/**
 * Body fingerprints for spec links (REQ-LINKACC-004).
 *
 * A link's signature baseline (REQ-LINKACC-002) only sees the symbol's
 * declaration line, so a change inside the body was invisible. Each code link
 * now also keeps a fingerprint of its symbol's body next to the signature
 * baseline. When the body moves and the signature does not, the link carries a
 * "body changed since <state>" marker — an advisory note that never changes the
 * link's state and never enters the drift queue.
 *
 * The fingerprint ignores formatting: whitespace outside string literals is
 * dropped, and comments are dropped for languages whose comment syntax is known
 * (C-family `//` and `/* *\/`, `#` for Python and Ruby, both for PHP). For any
 * other language whitespace is collapsed and nothing else is touched — comment
 * syntax is never guessed, so an unknown-language edit still marks the link.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Node, SpecLink, SpecLinkState } from '../types';

/** Languages whose comments are `//` line comments and `/* *\/` block comments. */
const C_FAMILY = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'go', 'rust', 'java', 'c', 'cpp',
  'csharp', 'swift', 'kotlin', 'dart', 'scala', 'objc',
]);
/** Languages whose comments are `#` line comments. */
const HASH_FAMILY = new Set(['python', 'ruby']);
/** Languages where a backtick delimits a string (template / raw string). */
const BACKTICK_STRINGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'go']);
/** Languages with `"""` (and for some `'''`) multi-line strings. */
const TRIPLE_DOUBLE = new Set(['python', 'kotlin', 'swift', 'scala', 'dart', 'java']);
const TRIPLE_SINGLE = new Set(['python', 'dart']);

/** Link states a body-changed marker may be set on and shown for. */
export const BODY_MARKER_STATES: ReadonlySet<SpecLinkState> = new Set<SpecLinkState>(['implemented', 'verified']);

/** The marker as stored in `metadata.bodyChanged`. */
export interface BodyChangedMarker {
  /** Epoch ms of the first pass that saw the changed body. */
  at: number;
  /** The link state the body changed since (`implemented` / `verified`). */
  since: SpecLinkState;
}

/**
 * Normalize a body for fingerprinting: drop comments (known languages only) and
 * every whitespace character outside string literals. Inside a multi-line
 * string the indentation after each newline is dropped too, so re-indenting a
 * function never reads as a change. Python keeps its block structure: each
 * logical line is prefixed with its nesting level, so moving a statement in or
 * out of a block still counts while a uniform re-indent does not.
 *
 * Unknown language: whitespace runs collapse to one space; nothing else changes.
 */
export function stripCommentsAndWhitespace(source: string, language: string): string {
  const cFamily = C_FAMILY.has(language) || language === 'php';
  const hash = HASH_FAMILY.has(language) || language === 'php';
  if (!cFamily && !hash) return source.replace(/\s+/g, ' ').trim();

  const python = language === 'python';
  const rust = language === 'rust';
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  let depth = 0; // bracket depth — Python continuation lines carry no level
  let lineStart = true;
  const indentStack = [0];

  const emitString = (end: number): void => {
    // Verbatim, minus indentation after newlines inside the literal.
    out.push(source.slice(i, end).replace(/\n[ \t]*/g, '\n'));
    i = end;
  };
  /** Index just past the string opened at `i` by `quote` (escape-aware). */
  const stringEnd = (quote: string): number => {
    let j = i + quote.length;
    while (j < n) {
      // Backslash escapes everywhere except inside a Go raw (backtick) string.
      if (source[j] === '\\' && !(quote === '`' && language === 'go')) { j += 2; continue; }
      if (source.startsWith(quote, j)) return j + quote.length;
      // A single-quoted / double-quoted literal never spans a raw newline in
      // these languages; stop there so an unbalanced quote can't eat the body.
      if (quote.length === 1 && quote !== '`' && source[j] === '\n') return j;
      j++;
    }
    return n;
  };

  while (i < n) {
    const c = source[i]!;
    const c2 = source[i + 1] ?? '';

    if (c === '\n') { lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }

    // Comments.
    if (cFamily && c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (cFamily && c === '/' && c2 === '*') {
      let nest = 1;
      i += 2;
      while (i < n && nest > 0) {
        if (rust && source[i] === '/' && source[i + 1] === '*') { nest++; i += 2; continue; }
        if (source[i] === '*' && source[i + 1] === '/') { nest--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (hash && c === '#' && !(language === 'php' && c2 === '[')) {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    // Python block structure: nesting level at the start of each logical line.
    if (python && lineStart && depth === 0) {
      let k = i - 1;
      let width = 0;
      while (k >= 0 && source[k] !== '\n') { width += source[k] === '\t' ? 8 : 1; k--; }
      while (width < indentStack[indentStack.length - 1]! ) indentStack.pop();
      if (width > indentStack[indentStack.length - 1]!) indentStack.push(width);
      out.push(`\n${indentStack.length - 1}:`);
    }
    lineStart = false;

    // String literals — kept verbatim so a `//` or `#` inside one is code.
    if (TRIPLE_DOUBLE.has(language) && source.startsWith('"""', i)) { emitString(stringEnd('"""')); continue; }
    if (TRIPLE_SINGLE.has(language) && source.startsWith("'''", i)) { emitString(stringEnd("'''")); continue; }
    if (c === '"') { emitString(stringEnd('"')); continue; }
    if (c === '`' && BACKTICK_STRINGS.has(language)) { emitString(stringEnd('`')); continue; }
    if (c === "'") {
      if (rust) {
        // `'a` is a lifetime; only `'x'` / `'\n'` are char literals.
        if (source[i + 2] === "'") { out.push(source.slice(i, i + 3)); i += 3; continue; }
        if (c2 === '\\') {
          const close = source.indexOf("'", i + 2);
          if (close !== -1 && close - i <= 12) { out.push(source.slice(i, close + 1)); i = close + 1; continue; }
        }
        out.push(c);
        i++;
        continue;
      }
      emitString(stringEnd("'"));
      continue;
    }

    if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--;
    out.push(c);
    i++;
  }
  return out.join('');
}

/** sha256 of the normalized body (REQ-LINKACC-004.A2). */
export function fingerprintBody(source: string, language: string): string {
  return createHash('sha256').update(stripCommentsAndWhitespace(source, language)).digest('hex');
}

/**
 * The source lines of a node (`startLine..endLine`, 1-indexed, inclusive), or
 * `null` when the file can't be read or the range is empty.
 */
export function readNodeBody(projectRoot: string, node: Pick<Node, 'filePath' | 'startLine' | 'endLine'>): string | null {
  let content: string;
  try {
    content = fs.readFileSync(path.resolve(projectRoot, node.filePath), 'utf-8');
  } catch {
    return null;
  }
  if (!(node.startLine >= 1) || !(node.endLine >= node.startLine)) return null;
  const lines = content.split('\n');
  if (node.startLine > lines.length) return null;
  return lines.slice(node.startLine - 1, node.endLine).join('\n');
}

/**
 * The current body fingerprint of a symbol node, or `null` when it can't be
 * taken (a `file` node — its "body" is the whole file and not a stable axis —
 * or an unreadable file).
 */
export function nodeBodyFingerprint(projectRoot: string, node: Node): string | null {
  if (node.kind === 'file') return null;
  const body = readNodeBody(projectRoot, node);
  return body === null ? null : fingerprintBody(body, node.language);
}

/**
 * The state a link's body changed since, when it carries a marker AND is still
 * in a state the marker applies to; otherwise `null`. Every surface (the
 * `specship_spec` link line, the coverage rollup Review reads) asks this one
 * function so they never disagree.
 */
export function bodyChangedSince(link: Pick<SpecLink, 'state' | 'metadata'>): SpecLinkState | null {
  if (!BODY_MARKER_STATES.has(link.state)) return null;
  const m = link.metadata?.bodyChanged as Partial<BodyChangedMarker> | undefined;
  if (!m || typeof m !== 'object') return null;
  return typeof m.since === 'string' ? m.since : link.state;
}

/** `"body changed since verified"` — the wording every surface shows. */
export function formatBodyChanged(since: string): string {
  return `body changed since ${since}`;
}
