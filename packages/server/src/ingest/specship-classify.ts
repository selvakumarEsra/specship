/**
 * Pure classifiers and symbol-extraction helpers for SpecShip Token Impact.
 *
 * SERVER-LOCAL COPY. The lib has the canonical version at
 * `src/analytics/specship-impact.ts`; this file is duplicated here on purpose
 * so the server never carries a runtime `import … from '@selvakumaresra/specship'`
 * — a bare-package value import does NOT resolve in bundled / different-cwd
 * mode and silently drops the server back to a stale build (the same failure
 * mode `server.ts`/`workflow.ts` already guard against). These functions are
 * pure (no I/O, no deps), so duplication is cheap; `__tests__/specship-impact-parity.test.ts`
 * asserts the two copies stay behaviourally identical.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix shared by every MCP tool routed through the specship server. */
const MCP_SPECSHIP_PREFIX = 'mcp__specship__';

/**
 * Strip-prefix base names of SpecShip tools that return code-graph source.
 * These are the tools a SpecShip call can displace a native Read/Grep with.
 * Excluded: designer_*, specship_link_assert, specship_link_verify,
 * specship_spec, specship_drifted, specship_status — they don't return
 * indexed source symbols.
 */
const SOURCE_RETURNING_TOOLS = new Set([
  'specship_explore',
  'specship_node',
  'specship_callers',
  'specship_callees',
  'specship_impact',
  'specship_search',
  'specship_files',
]);

/**
 * Tools whose input carries a `symbol` key (single identifier string).
 * Verified against src/mcp/tools.ts inputSchema `required: ['symbol']`.
 */
const SYMBOL_KEY_TOOLS = new Set([
  'specship_node',
  'specship_callers',
  'specship_callees',
  'specship_impact',
]);

/**
 * Regex for a single valid identifier token (with optional Class.method
 * qualifier).
 */
const SYMBOL_TOKEN_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/;

/**
 * Regex a token must match to be considered "code-ish" rather than prose.
 * Real symbol names almost always contain an uppercase letter, underscore,
 * dollar sign, digit, or a dot; pure lowercase words look like prose.
 */
const CODE_SIGNAL_RE = /[A-Z_$\d.]/;

/** Cap on how many symbol-shaped tokens we pull from one query. */
const MAX_SYMBOLS_PER_QUERY = 16;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** True iff `name` is routed through the SpecShip MCP server. */
export function isSpecshipTool(name: string): boolean {
  return name.startsWith(MCP_SPECSHIP_PREFIX);
}

/** True iff the tool returns code-graph source that can displace a Read/Grep. */
export function isSourceReturningTool(name: string): boolean {
  if (!name.startsWith(MCP_SPECSHIP_PREFIX)) return false;
  const base = name.slice(MCP_SPECSHIP_PREFIX.length);
  return SOURCE_RETURNING_TOOLS.has(base);
}

/**
 * Extracts the symbol names a tool call asked about from its serialised input
 * JSON. Returns `[]` when no symbols are resolvable (bad JSON, prose query,
 * non-symbol tool).
 */
export function extractRequestedSymbols(
  toolName: string,
  inputJson: string | null | undefined,
): string[] {
  if (!inputJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputJson);
  } catch {
    return [];
  }

  if (parsed === null || typeof parsed !== 'object') return [];
  const args = parsed as Record<string, unknown>;

  if (!toolName.startsWith(MCP_SPECSHIP_PREFIX)) return [];
  const base = toolName.slice(MCP_SPECSHIP_PREFIX.length);

  if (SYMBOL_KEY_TOOLS.has(base)) {
    const sym = args['symbol'];
    return typeof sym === 'string' && sym.length > 0 ? [sym] : [];
  }

  if (base === 'specship_explore' || base === 'specship_search') {
    const q = args['query'];
    if (typeof q !== 'string' || q.length === 0) return [];
    return symbolBagFromQuery(q);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the graph-backed read-equivalent estimator. A SpecShip
 * instance satisfies this structurally — the server passes one in, so it never
 * needs to import the SpecShip class.
 */
export interface GraphLike {
  estimateReadEquivalent(symbols: string[]): {
    files: { path: string; size: number }[];
    resolved: boolean;
  };
}

/**
 * Classify one tool call → the three ingest columns
 * (`isSpecship`, `resolution`, `displacedFiles`). A graph-estimate failure
 * degrades to 'unresolved' (it must NEVER break core transcript ingest).
 */
export function classifyToolCall(
  call: { toolName: string; inputJson: string | null | undefined; resultLength: number },
  graph: GraphLike | null,
): { isSpecship: 0 | 1; resolution: 'resolved' | 'unresolved' | 'n/a' | null; displacedFiles: string | null } {
  const { toolName, inputJson, resultLength } = call;

  if (!isSpecshipTool(toolName)) {
    return { isSpecship: 0, resolution: null, displacedFiles: null };
  }

  if (isSourceReturningTool(toolName) && resultLength > 0) {
    const symbols = extractRequestedSymbols(toolName, inputJson);

    if (symbols.length === 0) {
      return { isSpecship: 1, resolution: 'unresolved', displacedFiles: null };
    }
    if (graph === null) {
      return { isSpecship: 1, resolution: 'unresolved', displacedFiles: null };
    }

    let files: { path: string; size: number }[];
    let resolved: boolean;
    try {
      ({ files, resolved } = graph.estimateReadEquivalent(symbols));
    } catch {
      return { isSpecship: 1, resolution: 'unresolved', displacedFiles: null };
    }
    if (resolved) {
      return {
        isSpecship: 1,
        resolution: 'resolved',
        displacedFiles: JSON.stringify(files.map((f) => [f.path, f.size])),
      };
    }
    return { isSpecship: 1, resolution: 'unresolved', displacedFiles: null };
  }

  return { isSpecship: 1, resolution: 'n/a', displacedFiles: null };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Real explore/search queries are MIXED bags (symbol names + lowercase
// keywords, often 10+ tokens). FILTER the symbol-shaped tokens out rather than
// rejecting the whole query; pure prose yields []. Capped to bound graph work.
function symbolBagFromQuery(query: string): string[] {
  const symbols = query
    .trim()
    .split(/\s+/)
    .filter((t) => SYMBOL_TOKEN_RE.test(t) && CODE_SIGNAL_RE.test(t));
  return symbols.slice(0, MAX_SYMBOLS_PER_QUERY);
}
