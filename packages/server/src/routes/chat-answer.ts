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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpecShipInstance } from '../project-registry.js';
import type { ClassifiedIntent } from '../chat/classify.js';

/** A pointer to one graph symbol — the shape a symbol detail's neighbours take. */
export interface SymbolRef {
  /** Simple name. */
  name: string;
  /** Fully-qualified name (stable identity). */
  qualifiedName: string;
  /** File the symbol lives in, relative to the project root. */
  filePath: string;
  /** 1-indexed start line. */
  line: number;
}

/**
 * Full retrieved detail for a symbol match (REQ-DASH-CHAT-005.A1) — the graph's
 * Read-equivalent depth: verbatim source body, signature, and the immediate
 * callers/callees. All derived from the index, never fabricated.
 */
export interface SymbolDetail {
  /** The symbol's signature, when the extractor captured one. */
  signature?: string;
  /** Verbatim source body — the exact lines from the file, never synthesized. */
  body: string;
  /** Immediate callers (1 hop), deduped and stable-sorted by qualified name. */
  callers: SymbolRef[];
  /** Immediate callees (1 hop), deduped and stable-sorted by qualified name. */
  callees: SymbolRef[];
}

/** Full retrieved detail for a spec match (REQ-DASH-CHAT-005.A2). */
export interface SpecDetail {
  /** The spec's full body, verbatim. */
  body: string;
  /** The code the spec links to, each with its current link state. */
  links: { target: string; state: string }[];
}

/** Full retrieved detail for a domain-fact match (REQ-DASH-CHAT-005.A2). */
export interface DomainDetail {
  /** The fact's full body, verbatim. */
  body: string;
}

/** The `detail` payload on a `ChatSource`, discriminated by the source's `kind`. */
export type ChatSourceDetail = SymbolDetail | SpecDetail | DomainDetail;

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
  /**
   * The full detail the graph holds for this match (REQ-DASH-CHAT-005),
   * discriminated by `kind`: `SymbolDetail` for a symbol, `SpecDetail` for a
   * spec, `DomainDetail` for a domain fact. Present on every returned source;
   * the UI renders it in an expandable section below the concise answer.
   */
  detail?: ChatSourceDetail;
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

/**
 * Per-store caps for the **prose** sections only — keep the composed gloss
 * bounded and readable. The full-detail set below is a separate, larger cap.
 */
const MAX_SYMBOLS = 5;
const MAX_SPECS = 3;
const MAX_DOMAIN = 3;

/**
 * Cap on the ranked full-detail match set (REQ-DASH-CHAT-005.A3). The concise
 * prose stays bounded by the small per-store caps above; the detail array —
 * each source's verbatim body / links, rendered as one expandable per match in
 * the UI — is the top matches by rank up to this cap, so a broad query can't
 * return unbounded content. Raised well above the old five-per-store limit;
 * every dispatch helper takes it as a parameter so it stays configurable.
 */
const DETAIL_CAP = 15;

/** Minimal shape of a graph node the detail builders read. */
interface GraphNode {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

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

// =============================================================================
// Full retrieved detail per match (REQ-DASH-CHAT-005)
// =============================================================================

/**
 * Read a symbol's verbatim source body from disk — the exact `startLine..endLine`
 * slice of its file (mirrors `src/mcp/tools.ts`). Real bytes, never synthesized
 * (A4); returns `''` if the file can't be read so a missing file is honest, not
 * fabricated.
 */
function readNodeBody(cg: SpecShipInstance, node: GraphNode): string {
  try {
    const abs = join(cg.getProjectRoot(), node.filePath);
    const lines = readFileSync(abs, 'utf-8').split('\n');
    return lines.slice(node.startLine - 1, node.endLine).join('\n');
  } catch {
    return '';
  }
}

/** Map 1-hop neighbours to deduped, stable-sorted `SymbolRef`s (self excluded). */
function neighbourRefs(raw: Array<{ node: GraphNode }>, selfId: string): SymbolRef[] {
  const seen = new Set<string>();
  return raw
    .filter((r) => r.node.id !== selfId && !seen.has(r.node.id) && (seen.add(r.node.id), true))
    .map((r) => ({ name: r.node.name, qualifiedName: r.node.qualifiedName, filePath: r.node.filePath, line: r.node.startLine }))
    .sort((a, b) => byName(a.qualifiedName, b.qualifiedName));
}

/**
 * Full symbol detail (A1): verbatim body + signature + immediate callers/callees.
 * Read-equivalent depth so the user never has to open the file to see the match.
 */
function buildSymbolDetail(cg: SpecShipInstance, node: GraphNode): SymbolDetail {
  return {
    signature: node.signature,
    body: readNodeBody(cg, node),
    callers: neighbourRefs(cg.getCallers(node.id, 1), node.id),
    callees: neighbourRefs(cg.getCallees(node.id, 1), node.id),
  };
}

/**
 * Full spec detail (A2): the spec's full body + the code it links to, each with
 * its current link state. Links are stable-sorted by target (then state) so the
 * detail is byte-identical across repeat calls (A4).
 */
function buildSpecDetail(cg: SpecShipInstance, spec: { id: string; body: string }): SpecDetail {
  const links = cg
    .getSpecQueries()
    .getLinksBySpec(spec.id)
    .map((l) => ({ target: l.targetQualifiedName, state: l.state as string }))
    .sort((a, b) => (a.target !== b.target ? byName(a.target, b.target) : byName(a.state, b.state)));
  return { body: spec.body, links };
}

/** A symbol `ChatSource` carrying its full detail (A1 + REQ-005). */
function symbolSource(cg: SpecShipInstance, node: GraphNode): ChatSource {
  return {
    kind: 'symbol',
    ref: node.qualifiedName,
    label: node.name,
    filePath: node.filePath,
    line: node.startLine,
    detail: buildSymbolDetail(cg, node),
  };
}

/**
 * Answer a question deterministically from the indexed knowledge base.
 *
 * Runs a symbol search and a spec search (domain facts are specs of kind
 * `domain`, split out into their own section), sorts every result set by a
 * stable key, and composes a templated prose answer from the real rows. When
 * nothing matches, returns an honest not-found answer with no sources.
 */
export function answerFromKnowledgeBase(cg: SpecShipInstance, question: string, detailCap = DETAIL_CAP): ChatAnswer {
  const { query } = extractSubject(question);
  const subjectLabel = query.length > 0 ? query : question.trim();

  // No usable subject → nothing to search; honest empty answer (A4).
  if (query.length === 0) {
    return notFound(subjectLabel);
  }

  // --- Ranked hits per store (wider than the prose caps to feed the detail
  //     set; each list is stable-sorted so repeat calls are byte-identical). --
  const symbolHits = cg
    .searchNodes(query, { limit: detailCap * 4 })
    .slice()
    .sort(bySymbolRank)
    .slice(0, detailCap);

  const specHits = cg
    .getSpecQueries()
    .searchSpecs(query, detailCap * 4)
    .slice()
    .sort(bySpecRank);
  const domainHits = specHits.filter((r) => r.spec.kind === 'domain').slice(0, detailCap);
  const nonDomainSpecHits = specHits.filter((r) => r.spec.kind !== 'domain').slice(0, detailCap);

  if (symbolHits.length === 0 && domainHits.length === 0 && nonDomainSpecHits.length === 0) {
    return notFound(subjectLabel);
  }

  // --- Concise prose: the small per-store caps, gloss only (no detail). ------
  const proseSymbols = symbolHits.slice(0, MAX_SYMBOLS);
  const proseSpecs = nonDomainSpecHits.slice(0, MAX_SPECS);
  const proseDomain = domainHits.slice(0, MAX_DOMAIN);
  const sections: string[] = [];

  if (proseSymbols.length > 0) {
    const parts = proseSymbols.map((r) => `\`${r.node.name}\` (${r.node.kind} in ${r.node.filePath}:${r.node.startLine})`);
    const noun = proseSymbols.length === 1 ? 'symbol' : 'symbols';
    sections.push(`Found ${proseSymbols.length} ${noun} matching “${subjectLabel}”: ${parts.join(', ')}.`);
  }
  if (proseSpecs.length > 0) {
    const parts = proseSpecs.map((r) => `${r.spec.id} — ${r.spec.title}`);
    const noun = proseSpecs.length === 1 ? 'spec' : 'specs';
    sections.push(`Related ${noun}: ${parts.join('; ')}.`);
  }
  if (proseDomain.length > 0) {
    const parts = proseDomain.map((r) => {
      const gloss = firstLine(r.spec.body);
      return gloss ? `${r.spec.title} — ${gloss}` : r.spec.title;
    });
    const noun = proseDomain.length === 1 ? 'domain fact' : 'domain facts';
    sections.push(`Related ${noun}: ${parts.join('; ')}.`);
  }

  // --- Full-detail sources: prose-mentioned first (so every rendered fact has
  //     its source ref, A1), then extra ranked matches fill the detail budget so
  //     the user sees everything retrieved — bounded at detailCap (A3, A5). -----
  const sources: ChatSource[] = [];
  const specSource = (r: { spec: { id: string; title: string; body: string } }): ChatSource => ({
    kind: 'spec', ref: r.spec.id, label: r.spec.title, detail: buildSpecDetail(cg, r.spec),
  });
  const domainSource = (r: { spec: { id: string; title: string; body: string } }): ChatSource => ({
    kind: 'domain', ref: r.spec.id, label: r.spec.title, detail: { body: r.spec.body },
  });
  const add = (src: ChatSource): void => { if (sources.length < detailCap) sources.push(src); };

  for (const r of proseSymbols) add(symbolSource(cg, r.node));
  for (const r of proseSpecs) add(specSource(r));
  for (const r of proseDomain) add(domainSource(r));
  for (const r of symbolHits.slice(MAX_SYMBOLS)) add(symbolSource(cg, r.node));
  for (const r of nonDomainSpecHits.slice(MAX_SPECS)) add(specSource(r));
  for (const r of domainHits.slice(MAX_DOMAIN)) add(domainSource(r));

  return { found: true, answer: sections.join('\n\n'), sources };
}

// =============================================================================
// Faux-streaming chunker (REQ-DASH-CHAT-003)
// =============================================================================

/**
 * Longest slice `chunkAnswer` emits. Sized to a word-group (not a whole
 * sentence) so even a one-sentence answer streams in several chunks — the
 * progressive-reveal "typing" effect (REQ-DASH-CHAT-003.A2) rather than one
 * atomic drop.
 */
const MAX_CHUNK_CHARS = 48;

/**
 * Split a fully-composed answer into ordered presentation chunks.
 *
 * The stream route computes the whole answer first, then paces these chunks so
 * the reply renders progressively like a model typing — but pacing is cosmetics
 * only, so the **one invariant is `chunkAnswer(answer).join('') === answer`**
 * (REQ-DASH-CHAT-003.A2/A3): chunk boundaries never add, drop, or reorder a
 * character. Boundaries prefer a sentence end (`.`/`!`/`?`/`;` before a space or
 * newline), then a newline, then any space, and finally a hard cut at
 * `MAX_CHUNK_CHARS` so an unbroken token still streams. Pure and deterministic —
 * same input always yields the same chunks, no `Date.now()`/`Math.random()`.
 */
export function chunkAnswer(answer: string): string[] {
  const chunks: string[] = [];
  const n = answer.length;
  let i = 0;
  while (i < n) {
    const hardEnd = Math.min(i + MAX_CHUNK_CHARS, n);
    if (hardEnd >= n) {
      chunks.push(answer.slice(i));
      break;
    }
    // Scan the window (i, hardEnd) for the best break, preferring a sentence
    // end, then a newline, then any space. Each candidate is the index just
    // AFTER the boundary char so the separator rides the current chunk.
    let sentenceBreak = -1;
    let spaceBreak = -1;
    for (let j = i; j < hardEnd; j++) {
      const c = answer[j];
      const next = answer[j + 1];
      if ((c === '.' || c === '!' || c === '?' || c === ';') && (next === ' ' || next === '\n')) {
        sentenceBreak = j + 1;
      } else if (c === '\n') {
        sentenceBreak = j + 1;
      } else if (c === ' ') {
        spaceBreak = j + 1;
      }
    }
    const end = sentenceBreak > i ? sentenceBreak : spaceBreak > i ? spaceBreak : hardEnd;
    chunks.push(answer.slice(i, end));
    i = end;
  }
  return chunks;
}

// =============================================================================
// Intent dispatcher (REQ-DASH-CHAT-002)
// =============================================================================

/**
 * Route a classified message to the matching knowledge-base query.
 *
 * The classifier (`../chat/classify.ts`) is pure and I/O-free; this is the thin
 * glue that turns its `{ intent, query }` into a concrete instance query and
 * composes the deterministic answer. Each intent maps to an existing instance
 * method — callers/callees/impact traverse the graph, spec/domain hit the spec
 * layer, drift reads the out-of-sync links, and explore/search fall through to
 * the generic knowledge-base composition. Every rendered fact still carries a
 * `ChatSource` (A1) and every result set is stable-sorted (A3).
 */
export function answerForIntent(cg: SpecShipInstance, classified: ClassifiedIntent, detailCap = DETAIL_CAP): ChatAnswer {
  const query = classified.query.trim();
  switch (classified.intent) {
    case 'callers':
      return answerNeighbours(cg, query, 'callers', detailCap);
    case 'callees':
      return answerNeighbours(cg, query, 'callees', detailCap);
    case 'impact':
      return answerImpact(cg, query, detailCap);
    case 'spec':
      return answerSpecs(cg, query, 'spec', detailCap);
    case 'domain':
      return answerSpecs(cg, query, 'domain', detailCap);
    case 'drift':
      return answerDrift(cg, detailCap);
    case 'explore':
    case 'search':
    default:
      return answerFromKnowledgeBase(cg, query, detailCap);
  }
}

/** Stable string comparison — the tie-break every dispatch sort shares. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Resolve a free-form subject to its single best-matching graph node (or null). */
function resolveNode(cg: SpecShipInstance, query: string) {
  if (query.length === 0) return null;
  const hits = cg.searchNodes(query, { limit: MAX_SYMBOLS * 4 }).slice().sort(bySymbolRank);
  return hits[0]?.node ?? null;
}

/** Render a symbol reference the same way across every dispatch answer. */
function symbolRef(node: { name: string; kind: string; filePath: string; startLine: number }): string {
  return `\`${node.name}\` (${node.kind} in ${node.filePath}:${node.startLine})`;
}

/** callers / callees: the subject's 1-hop neighbours in the call graph. */
function answerNeighbours(cg: SpecShipInstance, query: string, dir: 'callers' | 'callees', detailCap = DETAIL_CAP): ChatAnswer {
  const node = resolveNode(cg, query);
  if (!node) return notFound(query);

  const raw = dir === 'callers' ? cg.getCallers(node.id, 1) : cg.getCallees(node.id, 1);
  const seen = new Set<string>();
  const neighbours = raw
    .filter((r) => r.node.id !== node.id && !seen.has(r.node.id) && (seen.add(r.node.id), true))
    .sort((a, b) => byName(a.node.qualifiedName, b.node.qualifiedName));

  // Subject first, then its neighbours — each with full detail, bounded (A3).
  const sources: ChatSource[] = [symbolSource(cg, node)];
  for (const r of neighbours.slice(0, detailCap - 1)) sources.push(symbolSource(cg, r.node));

  if (neighbours.length === 0) {
    const rel = dir === 'callers' ? 'has no known callers' : 'makes no known calls';
    return { found: true, answer: `${symbolRef(node)} ${rel} in the index.`, sources };
  }

  const shown = neighbours.slice(0, MAX_SYMBOLS);
  const parts = shown.map((r) => symbolRef(r.node));
  const more = neighbours.length > shown.length ? ` (+${neighbours.length - shown.length} more)` : '';
  const verb = dir === 'callers' ? 'is called by' : 'calls';
  const noun = dir === 'callers'
    ? (neighbours.length === 1 ? 'caller' : 'callers')
    : (neighbours.length === 1 ? 'callee' : 'callees');
  return { found: true, answer: `\`${node.name}\` ${verb} ${neighbours.length} ${noun}${more}: ${parts.join(', ')}.`, sources };
}

/** impact: the subject's downstream blast radius. */
function answerImpact(cg: SpecShipInstance, query: string, detailCap = DETAIL_CAP): ChatAnswer {
  const node = resolveNode(cg, query);
  if (!node) return notFound(query);

  const sub = cg.getImpactRadius(node.id, 3);
  const impacted = [...sub.nodes.values()]
    .filter((n) => n.id !== node.id)
    .sort((a, b) => byName(a.qualifiedName, b.qualifiedName));

  // Subject first, then impacted symbols — each with full detail, bounded (A3).
  const sources: ChatSource[] = [symbolSource(cg, node)];
  for (const n of impacted.slice(0, detailCap - 1)) sources.push(symbolSource(cg, n));

  if (impacted.length === 0) {
    return { found: true, answer: `Changing ${symbolRef(node)} has no known downstream impact in the index.`, sources };
  }

  const shown = impacted.slice(0, MAX_SYMBOLS);
  const parts = shown.map((n) => symbolRef(n));
  const more = impacted.length > shown.length ? ` (+${impacted.length - shown.length} more)` : '';
  const noun = impacted.length === 1 ? 'symbol' : 'symbols';
  return { found: true, answer: `Changing \`${node.name}\` could affect ${impacted.length} ${noun}${more}: ${parts.join(', ')}.`, sources };
}

/** spec / domain: a lookup over the spec layer (exact id first for spec). */
function answerSpecs(cg: SpecShipInstance, query: string, which: 'spec' | 'domain', detailCap = DETAIL_CAP): ChatAnswer {
  if (query.length === 0) return notFound(query);

  const specDetailSource = (spec: { id: string; title: string; body: string }): ChatSource =>
    which === 'domain'
      ? { kind: 'domain', ref: spec.id, label: spec.title, detail: { body: spec.body } }
      : { kind: 'spec', ref: spec.id, label: spec.title, detail: buildSpecDetail(cg, spec) };

  // A spec intent with an exact id resolves directly — deterministic and precise.
  if (which === 'spec') {
    const exact = cg.getSpecQueries().getSpecById(query);
    if (exact) {
      const gloss = firstLine(exact.body);
      return {
        found: true,
        answer: gloss ? `${exact.id} — ${exact.title}: ${gloss}` : `${exact.id} — ${exact.title}`,
        sources: [specDetailSource(exact)],
      };
    }
  }

  const hits = cg
    .getSpecQueries()
    .searchSpecs(query, detailCap * 4)
    .slice()
    .sort(bySpecRank);
  const matched = which === 'domain'
    ? hits.filter((r) => r.spec.kind === 'domain').slice(0, detailCap)
    : hits.filter((r) => r.spec.kind !== 'domain').slice(0, detailCap);

  if (matched.length === 0) return notFound(query);

  // Full detail for every match, bounded (A2/A3); prose lists the small cap.
  const sources: ChatSource[] = matched.map((r) => specDetailSource(r.spec));

  const prose = matched.slice(0, which === 'domain' ? MAX_DOMAIN : MAX_SPECS);
  const parts = prose.map((r) => {
    if (which === 'domain') {
      const gloss = firstLine(r.spec.body);
      return gloss ? `${r.spec.title} — ${gloss}` : r.spec.title;
    }
    return `${r.spec.id} — ${r.spec.title}`;
  });
  const more = matched.length > prose.length ? ` (+${matched.length - prose.length} more)` : '';
  const noun = which === 'domain'
    ? (matched.length === 1 ? 'domain fact' : 'domain facts')
    : (matched.length === 1 ? 'spec' : 'specs');
  return { found: true, answer: `Found ${matched.length} ${noun} matching “${query}”${more}: ${parts.join('; ')}.`, sources };
}

/** drift: the spec ↔ code links that are currently out of sync. */
function answerDrift(cg: SpecShipInstance, detailCap = DETAIL_CAP): ChatAnswer {
  const links = cg
    .getSpecQueries()
    .getLinksByState(['drifted', 'broken', 'orphaned'])
    .slice()
    .sort((a, b) => (a.specId !== b.specId ? byName(a.specId, b.specId) : byName(a.targetQualifiedName, b.targetQualifiedName)));

  if (links.length === 0) {
    return {
      found: true,
      answer: 'No specs are currently drifted, broken, or orphaned — the spec ↔ code links are all in sync.',
      sources: [],
    };
  }

  // One source per distinct drifted spec, each carrying the spec's full detail
  // (body + all its links with state), bounded at detailCap (A2/A3).
  const sources: ChatSource[] = [];
  const sq = cg.getSpecQueries();
  const seenSpecs = new Set<string>();
  for (const l of links) {
    if (sources.length >= detailCap || seenSpecs.has(l.specId)) continue;
    seenSpecs.add(l.specId);
    const spec = sq.getSpecById(l.specId);
    sources.push(
      spec
        ? { kind: 'spec', ref: spec.id, label: spec.title, detail: buildSpecDetail(cg, spec) }
        : { kind: 'spec', ref: l.specId, label: l.specId },
    );
  }

  const shown = links.slice(0, MAX_SPECS + MAX_DOMAIN);
  const parts = shown.map((l) => `${l.specId} → ${l.targetQualifiedName} (${l.state})`);
  const more = links.length > shown.length ? ` (+${links.length - shown.length} more)` : '';
  const noun = links.length === 1 ? 'link' : 'links';
  return { found: true, answer: `${links.length} spec ${noun} out of sync${more}: ${parts.join('; ')}.`, sources };
}

/** The honest not-found answer — no invented symbols, paths, or facts (A4). */
function notFound(subjectLabel: string): ChatAnswer {
  return {
    found: false,
    answer: `I couldn't find anything about “${subjectLabel}” in this project's knowledge base — no matching symbols, specs, or domain facts are indexed.`,
    sources: [],
  };
}
