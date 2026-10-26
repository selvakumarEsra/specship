/**
 * Evidence kinds (PIPETRUST-DOC, REQ-PIPETRUST-001 / REQ-PIPETRUST-002).
 *
 * Coverage used to count "a test" without asking what kind. Every acceptance
 * criterion now resolves to exactly one REQUIRED kind of evidence, and every
 * test file classifies to the kind it actually PROVIDES — both
 * deterministically, so coverage can compare the two.
 *
 * - required: an inline `(evidence: <kind>)` tag wins; otherwise derived from
 *   the criterion's shape (invariant phrasing → property) and the
 *   requirement's direct links (UI → e2e, route → contract), else unit.
 * - present: read from the test file alone — library imports and path
 *   segments. Never throws; anything unreadable is `unit`.
 */

import * as fs from 'fs';
import { classifyCriterionShape } from '../behaviour/behaviour-surface';

export type EvidenceKind = 'unit' | 'property' | 'e2e' | 'contract';

/** The four kinds, in the order reports list them. */
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ['unit', 'property', 'e2e', 'contract'];

/** `(evidence: <kind>)` — case-insensitive; the kind is any non-`)` run. */
const EVIDENCE_TAG = /\(\s*evidence\s*:\s*([^)]*?)\s*\)/i;

/**
 * Drop inline code spans and fenced blocks first: a spec that DOCUMENTS the
 * tag syntax writes `` `(evidence: <kind>)` `` in backticks and is not itself
 * declaring a kind (same convention as the lint's `[needs review]` scan).
 */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
}

function isEvidenceKind(s: string): s is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(s);
}

/**
 * Read an inline `(evidence: <kind>)` tag from an acceptance bullet
 * (REQ-PIPETRUST-001.A1). No tag → `{}`; a known kind → `{ kind }`; an
 * unknown kind → `{ invalid: <what was written> }` (a lint error, A3).
 */
export function parseDeclaredEvidenceKind(text: string): { kind?: EvidenceKind; invalid?: string } {
  const m = stripCode(text ?? '').match(EVIDENCE_TAG);
  if (!m) return {};
  const raw = (m[1] ?? '').trim();
  const norm = raw.toLowerCase();
  return isEvidenceKind(norm) ? { kind: norm } : { invalid: raw };
}

export interface EvidenceKindContext {
  /** The requirement is directly linked (implements) to UI code. */
  linksUi?: boolean;
  /** The requirement is directly linked (implements) to a `route` node. */
  linksRoute?: boolean;
}

/**
 * The single evidence kind a criterion requires (REQ-PIPETRUST-001.A1/.A2).
 * Precedence: declared tag → invariant phrasing (property) → UI link (e2e) →
 * route link (contract) → unit. An invalid declared kind falls through to the
 * derived kind — the lint reports it; resolution never fails.
 */
export function requiredEvidenceKind(criterionText: string, ctx: EvidenceKindContext = {}): EvidenceKind {
  const declared = parseDeclaredEvidenceKind(criterionText).kind;
  if (declared) return declared;
  if (classifyCriterionShape(criterionText ?? '') === 'invariant') return 'property';
  if (ctx.linksUi) return 'e2e';
  if (ctx.linksRoute) return 'contract';
  return 'unit';
}

/** Property-testing library use: fast-check, Hypothesis, jqwik, proptest, QuickCheck. */
const PROPERTY_SOURCE = [
  /['"]fast-check['"]/,
  /\bfc\.(assert|property|asyncProperty)\s*\(/,
  /@given\s*\(/,
  /\bfrom\s+hypothesis\b|\bimport\s+hypothesis\b/,
  /\bnet\.jqwik\b|@Property\b/,
  /\bproptest!?\b/,
  /\bquickcheck\b/i,
];

/** Browser e2e frameworks. */
const E2E_SOURCE = [/['"]@playwright\/test['"]/, /['"]cypress['"]/, /\bcy\.(visit|get|request)\s*\(/];

/** Contract / API-schema testing tools. */
const CONTRACT_SOURCE = [
  // Case-sensitive: the package and CLI are lowercase in real use, and an
  // upper-case identifier (a constant named SCHEMATHESIS) is not a use.
  /\bschemathesis\b/,
  /@pact-foundation\//,
  /\b(from|import)\s+pact\b/,
  /\bnew\s+Pact(V\d)?\s*\(/,
  /\bau\.com\.dius\.pact\b/,
];

/**
 * Remove block comments, `//` line comments and `#` line comments (Python /
 * shell test files). Deliberately simple: a `//` inside a string literal also
 * ends the line's code, which can only make classification more conservative.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1').replace(/^\s*#(?!!).*$/, ''))
    .join('\n');
}

function pathSegments(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.toLowerCase());
}

/**
 * Classify a test file by the kind of evidence it provides
 * (REQ-PIPETRUST-002.A1). Source signals are checked before path signals, and
 * property before e2e before contract. `source` is read from `filePath` when
 * omitted; a missing or unreadable file classifies as `unit` (A2) — this
 * function never throws.
 */
export function classifyTestEvidence(filePath: string, source?: string): EvidenceKind {
  let text = source;
  if (text === undefined) {
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch {
      text = '';
    }
  }
  // A tool named in prose (a doc comment explaining the classifier, say) is
  // not a use of it — match against code with comments removed.
  text = stripComments(text);
  try {
    if (PROPERTY_SOURCE.some((re) => re.test(text!))) return 'property';
    if (E2E_SOURCE.some((re) => re.test(text!))) return 'e2e';
    if (CONTRACT_SOURCE.some((re) => re.test(text!))) return 'contract';
    const segs = pathSegments(filePath ?? '');
    const dirs = segs.slice(0, -1);
    const base = segs[segs.length - 1] ?? '';
    if (dirs.includes('e2e') || /(^|[.\-_])e2e([.\-_]|$)/.test(base)) return 'e2e';
    if (dirs.includes('contract') || dirs.includes('contracts')) return 'contract';
  } catch {
    // fall through — classification is advisory, never fatal
  }
  return 'unit';
}
