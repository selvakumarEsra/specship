/**
 * Pure classifiers and symbol-extraction helpers for SpecShip Token Impact.
 *
 * No I/O, no DB, no imports beyond types. Intended to be imported by the
 * ingestor (Task 4) and the aggregation endpoint (later tasks).
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
 * qualifier). A token matches if every character is a JS/TS identifier char
 * or a single interior dot separating two identifier segments.
 *
 * Class.method tokens are kept whole — downstream resolution will try the
 * qualified name, which biases an overloaded name to the named type's own
 * definition (e.g. `DataRequest.task` → DataRequest's `task`, not the
 * abstract base).
 */
const SYMBOL_TOKEN_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/;

/**
 * Regex that a token must match to be considered "code-ish" rather than
 * natural-language prose. Pure lowercase ASCII words (e.g. "find", "the",
 * "all") look like prose; real symbol names almost always contain at least
 * one of: uppercase letter, underscore, dollar sign, digit, or a dot
 * (qualifying separator). A token matches this regex if it has any of those
 * signals.
 *
 * Examples that pass:  AuthService  handleRequest  _private  $el  renderV2  UserService.login
 * Examples that fail:  find  all  the  auth  handlers  does  updating
 */
const CODE_SIGNAL_RE = /[A-Z_$\d.]/;

/** Maximum number of whitespace-separated tokens to treat as a symbol bag.
 *  Queries with more tokens are almost certainly natural language. */
const MAX_SYMBOL_BAG_TOKENS = 6;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true iff `name` is routed through the SpecShip MCP server
 * (i.e. starts with `mcp__specship__`).
 */
export function isSpecshipTool(name: string): boolean {
  return name.startsWith(MCP_SPECSHIP_PREFIX);
}

/**
 * Returns true iff the tool returns code-graph source that can displace a
 * native Read/Grep. See SOURCE_RETURNING_TOOLS for the authoritative set.
 */
export function isSourceReturningTool(name: string): boolean {
  if (!name.startsWith(MCP_SPECSHIP_PREFIX)) return false;
  const base = name.slice(MCP_SPECSHIP_PREFIX.length);
  return SOURCE_RETURNING_TOOLS.has(base);
}

/**
 * Extracts the symbol names a tool call was asking about from its serialised
 * input JSON. Returns `[]` when no symbols are resolvable.
 *
 * Heuristic for `specship_explore` and `specship_search` (which both accept a
 * free-form `query` string):
 *   - Tokenise on whitespace.
 *   - If ALL tokens match SYMBOL_TOKEN_RE AND there are ≤ MAX_SYMBOL_BAG_TOKENS
 *     tokens, treat as a symbol bag and return the token list.
 *   - Otherwise (natural-language prose detected) return [].
 *
 * Input keys verified against src/mcp/tools.ts:
 *   - specship_node / callers / callees / impact → `symbol` (string, required)
 *   - specship_explore                           → `query`  (string, required)
 *   - specship_search                            → `query`  (string, required)
 *   - specship_files / others                   → [] (no named-symbol input)
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

  // --- symbol-keyed tools (specship_node, callers, callees, impact) ---------
  if (SYMBOL_KEY_TOOLS.has(base)) {
    const sym = args['symbol'];
    return typeof sym === 'string' && sym.length > 0 ? [sym] : [];
  }

  // --- query-keyed tools (specship_explore, specship_search) ----------------
  if (base === 'specship_explore' || base === 'specship_search') {
    const q = args['query'];
    if (typeof q !== 'string' || q.length === 0) return [];
    return symbolBagFromQuery(q);
  }

  // --- all other specship tools (files, status, spec, drifted, designer_*…) -
  return [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Given a query string, returns the token list if it looks like a symbol bag,
 * or [] if it looks like natural-language prose.
 *
 * A "symbol bag" means ALL of:
 *   1. At most MAX_SYMBOL_BAG_TOKENS whitespace-separated tokens.
 *   2. Every token matches SYMBOL_TOKEN_RE (valid identifier or Class.method).
 *   3. Every token matches CODE_SIGNAL_RE — it contains at least one uppercase
 *      letter, underscore, dollar sign, digit, or dot. This distinguishes
 *      `AuthService loginUser` (symbols) from `find all the auth handlers`
 *      (prose — all tokens are lowercase plain words).
 */
function symbolBagFromQuery(query: string): string[] {
  const tokens = query.trim().split(/\s+/);
  if (tokens.length > MAX_SYMBOL_BAG_TOKENS) return [];
  if (tokens.every((t) => SYMBOL_TOKEN_RE.test(t) && CODE_SIGNAL_RE.test(t))) return tokens;
  return [];
}
