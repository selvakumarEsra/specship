/**
 * Deterministic answer engine for the dashboard chat (REQ-DASH-CHAT-001).
 *
 * This is the pure, Fastify-free core the `/api/chat` route delegates to. It
 * answers a free-form question **entirely from the project's own indexed data**
 * — the code knowledge graph (symbols), specs and their links, and domain facts
 * — by running database queries through the instance and composing prose from
 * the real rows returned. It is emphatically **not** a chatbot:
 *
 *   - **No LLM, no network (A2 / DOM-SPECSHIP-004).** Nothing here calls a
 *     language model or any external service. This module imports nothing
 *     LLM-shaped and reads no model credentials — answers are produced by
 *     deterministic subject extraction + queries + templated composition.
 *   - **Deterministic (A3).** Given the same index and question, the produced
 *     answer is byte-identical: every result set is sorted by a stable key
 *     before rendering, and there is no `Date.now()` / `Math.random()` / any
 *     insertion-order dependence in the output path.
 *   - **Traceable (A1).** Every fact rendered into the answer carries a matching
 *     `ChatSource` pointing at the exact row it came from (a symbol's qualified
 *     name, a spec id, a domain fact id).
 *   - **Honest (A4).** When the subject matches nothing indexed, the engine
 *     returns `{ found: false }` with a plain not-found sentence — it never
 *     invents a symbol, path, or fact.
 *
 * Driven only through instance query methods (`searchNodes`, `getSpecQueries()`)
 * so the server never runtime-imports the `@specship/specship` package (which
 * would silently serve a stale build).
 */

import type { SpecShipInstance } from '../project-registry.js';

/** One indexed row a rendered fact was derived from (A1 traceability). */
export interface ChatSource {
  /** Which store the row came from. */
  kind: 'symbol' | 'spec' | 'domain';
  /** Stable identifier of the row: qualified name (symbol) or spec id. */
  ref: string;
  /** Human-readable label rendered in the answer (symbol/spec title). */
  label: string;
  /** File the symbol lives in, when the source is a symbol. */
  filePath?: string;
  /** 1-indexed start line of the symbol, when applicable. */
  line?: number;
}

/** The deterministic answer returned to the route. */
export interface ChatAnswer {
  /** True when at least one indexed row matched the subject. */
  found: boolean;
  /** Composed prose answer, derived only from the sources below. */
  answer: string;
  /** Every row the answer text was composed from (A1). */
  sources: ChatSource[];
}

/** Per-store result caps — keep the composed answer bounded and readable. */
const MAX_SYMBOLS = 5;
const MAX_SPECS = 3;
const MAX_DOMAIN = 3;

/**
 * Words that carry no subject signal — dropped before building the search
 * query. Deterministic, intentionally small (question-shaping words + the
 * verbs the launch intents phrase themselves with). Matching is lowercase.
 */
const STOPWORDS = new Set([
  'how', 'does', 'do', 'did', 'what', 'whats', 'is', 'are', 'the', 'a', 'an',
  'who', 'where', 'why', 'when', 'which', 'this', 'that', 'these', 'those',
  'of', 'to', 'in', 'on', 'for', 'and', 'or', 'i', 'we', 'you', 'it',
  'change', 'changing', 'breaks', 'break', 'work', 'works', 'working',
  'reach', 'reaches', 'become', 'becomes', 'call', 'calls', 'called',
  'about', 'with', 'from', 'into', 'me', 'my', 'show', 'tell', 'explain',
  'find', 'get', 'look', 'up', 'be', 'was', 'were', 'has', 'have', 'had',
]);

/**
 * Extract the deterministic search subject from a raw question.
 *
 * Strips a leading slash-command token, splits on non-identifier characters
 * (keeping `_`, `.` and `:` so `Foo.bar` / `a::b` survive as one token),
 * drops stopwords, and joins the remainder. Identifier-shaped tokens
 * (CamelCase, snake_case, dotted, or ≥3-char words) are preferred; if none
 * survive, every non-stopword token is used so a plain-English question still
 * searches. Returns the joined subject plus the raw token list. Pure.
 */
export function extractSubject(question: string): { query: string; tokens: string[] } {
  const withoutCommand = question.trim().replace(/^\/\S+\s*/, '');
  const rawTokens = withoutCommand
    .split(/[^A-Za-z0-9_.:]+/)
    .map((t) => t.replace(/^[.:]+|[.:]+$/g, '')) // trim stray separators
    .filter((t) => t.length > 0);

  const kept = rawTokens.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  const identifierLike = kept.filter(
    (t) => /[A-Z]/.test(t.slice(1)) || t.includes('_') || t.includes('.') || t.includes(':') || t.length >= 3,
  );
  const subjectTokens = identifierLike.length > 0 ? identifierLike : kept;
  return { query: subjectTokens.join(' '), tokens: subjectTokens };
}

/** Stable symbol ordering: score desc, then qualified name asc (tie-break). */
function bySymbolRank(a: { score: number; node: { qualifiedName: string } }, b: { score: number; node: { qualifiedName: string } }): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.node.qualifiedName < b.node.qualifiedName ? -1 : a.node.qualifiedName > b.node.qualifiedName ? 1 : 0;
}

/** Stable spec ordering: score desc, then spec id asc (tie-break). */
function bySpecRank(a: { score: number; spec: { id: string } }, b: { score: number; spec: { id: string } }): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0;
}

/** First non-empty line of a spec/domain body, trimmed — the one-line gloss. */
function firstLine(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim();
    if (line.length > 0) return line;
  }
  return '';
}

/**
 * Answer a question deterministically from the indexed knowledge base.
 *
 * Runs a symbol search and a spec search (domain facts are specs of kind
 * `domain`, split out into their own section), sorts every result set by a
 * stable key, and composes a templated prose answer from the real rows. When
 * nothing matches, returns an honest not-found answer with no sources.
 */
export function answerFromKnowledgeBase(cg: SpecShipInstance, question: string): ChatAnswer {
  const { query } = extractSubject(question);
  const subjectLabel = query.length > 0 ? query : question.trim();

  // No usable subject → nothing to search; honest empty answer (A4).
  if (query.length === 0) {
    return notFound(subjectLabel);
  }

  // --- Symbols (code knowledge graph) --------------------------------------
  const symbolHits = cg
    .searchNodes(query, { limit: MAX_SYMBOLS * 4 })
    .slice()
    .sort(bySymbolRank)
    .slice(0, MAX_SYMBOLS);

  // --- Specs + domain facts (spec layer) -----------------------------------
  const specHits = cg
    .getSpecQueries()
    .searchSpecs(query, (MAX_SPECS + MAX_DOMAIN) * 4)
    .slice()
    .sort(bySpecRank);
  const domainHits = specHits.filter((r) => r.spec.kind === 'domain').slice(0, MAX_DOMAIN);
  const nonDomainSpecHits = specHits.filter((r) => r.spec.kind !== 'domain').slice(0, MAX_SPECS);

  if (symbolHits.length === 0 && domainHits.length === 0 && nonDomainSpecHits.length === 0) {
    return notFound(subjectLabel);
  }

  const sources: ChatSource[] = [];
  const sections: string[] = [];

  if (symbolHits.length > 0) {
    const parts = symbolHits.map((r) => {
      sources.push({
        kind: 'symbol',
        ref: r.node.qualifiedName,
        label: r.node.name,
        filePath: r.node.filePath,
        line: r.node.startLine,
      });
      return `\`${r.node.name}\` (${r.node.kind} in ${r.node.filePath}:${r.node.startLine})`;
    });
    const noun = symbolHits.length === 1 ? 'symbol' : 'symbols';
    sections.push(`Found ${symbolHits.length} ${noun} matching “${subjectLabel}”: ${parts.join(', ')}.`);
  }

  if (nonDomainSpecHits.length > 0) {
    const parts = nonDomainSpecHits.map((r) => {
      sources.push({ kind: 'spec', ref: r.spec.id, label: r.spec.title });
      return `${r.spec.id} — ${r.spec.title}`;
    });
    const noun = nonDomainSpecHits.length === 1 ? 'spec' : 'specs';
    sections.push(`Related ${noun}: ${parts.join('; ')}.`);
  }

  if (domainHits.length > 0) {
    const parts = domainHits.map((r) => {
      sources.push({ kind: 'domain', ref: r.spec.id, label: r.spec.title });
      const gloss = firstLine(r.spec.body);
      return gloss ? `${r.spec.title} — ${gloss}` : r.spec.title;
    });
    const noun = domainHits.length === 1 ? 'domain fact' : 'domain facts';
    sections.push(`Related ${noun}: ${parts.join('; ')}.`);
  }

  return { found: true, answer: sections.join('\n\n'), sources };
}

/** The honest not-found answer — no invented symbols, paths, or facts (A4). */
function notFound(subjectLabel: string): ChatAnswer {
  return {
    found: false,
    answer: `I couldn't find anything about “${subjectLabel}” in this project's knowledge base — no matching symbols, specs, or domain facts are indexed.`,
    sources: [],
  };
}
