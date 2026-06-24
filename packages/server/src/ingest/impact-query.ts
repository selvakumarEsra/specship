/**
 * computeSpecshipImpact — aggregate SpecShip token-impact metrics from
 * claude_tool_calls + claude_sessions.
 *
 * Pure function of (db, opts) — no Fastify dependency, unit-testable.
 * Called by GET /api/claude/specship-impact in routes/claude.ts.
 *
 * Algorithm (SQL fetch + JS reduction — no GROUP BY prompt_id/file SQL):
 *   1. Fetch scoped rows joining claude_tool_calls ↔ claude_sessions.
 *   2. Spend: ceil(Σ result_length / CHARS_PER_TOKEN) for is_specship=1.
 *   3. Saved: per-prompt dedup — union displaced file paths across a prompt's
 *      resolved calls, sum each distinct file's size ONCE, subtract the
 *      prompt's specship spend chars, floor at 0.
 *   4. Overhead: ceil(SPECSHIP_TOOLDEF_CHARS / CHARS_PER_TOKEN) ×
 *      distinct session count with ≥1 specship call.
 *   5. Cost: price spend/saved chars at input-token rate, grouped by model.
 */

import { normalizeModelId, resolvePricing } from './pricing.js';
import type { PricingRow } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Characters treated as one token (rough average for Claude). */
const CHARS_PER_TOKEN = 4;

/**
 * JSON.stringify length of the SpecShip MCP tool definitions array.
 * Measured: JSON.stringify(tools.filter(t => t.name.startsWith('specship_'))).length
 * at 2026-06-24 — 12 tools in the registry at that time.
 * See src/mcp/tools.ts; recheck after adding/removing tools.
 */
const SPECSHIP_TOOLDEF_CHARS = 10047;

/** Overhead tokens charged per session (tool-definition context cost). */
const OVERHEAD_TOKENS_PER_SESSION = Math.ceil(SPECSHIP_TOOLDEF_CHARS / CHARS_PER_TOKEN);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbHandle = {
  prepare: (s: string) => {
    all: (...a: unknown[]) => unknown[];
    get: (...a: unknown[]) => unknown;
    run: (...a: unknown[]) => unknown;
  };
};

export interface SpecshipImpactOptions {
  /** Only include tool_calls with ts >= since (unix ms). 0 means all. */
  since: number;
  /**
   * When set, scope to a single project_path. byProject will be [] when
   * this is provided. Value should already be decoded (not a slug).
   */
  project?: string;
}

export interface SpecshipImpactResult {
  /** Tokens spent ON specship calls (result_length chars → tokens). */
  spendTokens: number;
  /** USD cost of spending those tokens (input rate by model). */
  spendCostUsd: number;
  /** Estimated tokens saved (displaced reads, per-prompt deduped). */
  savedTokens: number;
  /** USD value of those saved tokens (input rate by model). */
  savedCostUsd: number;
  /** Fixed tool-definition overhead: OVERHEAD_PER_SESSION × session count. */
  overheadTokens: number;
  /** net = savedTokens − spendTokens − overheadTokens */
  netTokens: number;
  /** net = savedCostUsd − spendCostUsd  (overhead cost not priced separately) */
  netCostUsd: number;
  /** Count of is_specship=1 rows with resolution='unresolved'. */
  unresolvedCalls: number;
  /** Count of is_specship=1 rows in scope. */
  totalSpecshipCalls: number;
  /** Per-tool breakdown (spend exact; saved approximate — see code comment). */
  byTool: Array<{
    tool: string;
    calls: number;
    spendTokens: number;
    savedTokens: number;
  }>;
  /** Per-project breakdown (empty when `project` filter is set). */
  byProject: Array<{
    project: string;
    spendTokens: number;
    savedTokens: number;
    netTokens: number;
  }>;
  /** Daily buckets (ts = day boundary in ms, oldest→newest). */
  trend: Array<{
    ts: number;
    spendTokens: number;
    savedTokens: number;
  }>;
}

// ---------------------------------------------------------------------------
// Raw DB row type
// ---------------------------------------------------------------------------

interface RawRow {
  prompt_id: string;
  tool_name: string;
  is_specship: number; // 0 or 1
  result_length: number;
  displaced_files: string | null; // JSON "[[path,size],…]" or NULL
  resolution: string | null;
  ts: number;
  project_path: string;
  last_model: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDisplacedFiles(raw: string | null): Array<[string, number]> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Array<[string, number]>;
  } catch {
    return [];
  }
}

/**
 * Load pricing rows from the DB (returns [] if the table is empty or absent).
 */
function loadPricing(db: DbHandle): PricingRow[] {
  try {
    return db
      .prepare('SELECT model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok FROM claude_pricing')
      .all() as PricingRow[];
  } catch {
    return [];
  }
}

/**
 * Price a char count (already summed) as input tokens at the input rate for
 * the given model. Returns 0 when model is unknown or pricing is unavailable.
 */
function priceChars(chars: number, model: string | null, pricingRows: PricingRow[]): number {
  if (!model || pricingRows.length === 0) return 0;
  const pricing = resolvePricing(model, pricingRows);
  if (!pricing) return 0;
  const tokens = chars / CHARS_PER_TOKEN;
  return (tokens * pricing.input_per_mtok) / 1_000_000;
}

/**
 * Per-prompt dedup logic. Given the rows for ONE prompt:
 *   - union displaced file paths from resolved rows (same file counted once)
 *   - promptSavedChars = max(0, unionSize - promptSpendChars)
 *
 * Returns { savedChars, spendChars }.
 */
function computePromptSaved(rows: RawRow[]): { savedChars: number; spendChars: number } {
  const spendChars = rows
    .filter(r => r.is_specship === 1)
    .reduce((s, r) => s + (r.result_length ?? 0), 0);

  // Union displaced files across ALL resolved calls in this prompt.
  const fileMap = new Map<string, number>(); // path → size
  for (const row of rows) {
    if (row.is_specship !== 1 || row.resolution !== 'resolved') continue;
    for (const [path, size] of parseDisplacedFiles(row.displaced_files)) {
      if (!fileMap.has(path)) {
        fileMap.set(path, size);
      }
    }
  }
  const readEquivChars = Array.from(fileMap.values()).reduce((s, n) => s + n, 0);
  const savedChars = Math.max(0, readEquivChars - spendChars);
  return { savedChars, spendChars };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeSpecshipImpact(
  db: DbHandle,
  opts: SpecshipImpactOptions,
): SpecshipImpactResult {
  const { since, project } = opts;

  // 1. Fetch scoped rows.
  const queryParts: string[] = [
    `SELECT tc.prompt_id, tc.tool_name, tc.is_specship, tc.result_length,
            tc.displaced_files, tc.resolution, tc.ts,
            s.project_path, s.last_model
     FROM claude_tool_calls tc
     JOIN claude_sessions s ON s.id = tc.session_id
     WHERE tc.ts >= ?`,
  ];
  const params: unknown[] = [since];
  if (project) {
    queryParts.push('AND s.project_path = ?');
    params.push(project);
  }

  const rows = db.prepare(queryParts.join(' ')).all(...params) as RawRow[];

  if (rows.length === 0) {
    return {
      spendTokens: 0,
      spendCostUsd: 0,
      savedTokens: 0,
      savedCostUsd: 0,
      overheadTokens: 0,
      netTokens: 0,
      netCostUsd: 0,
      unresolvedCalls: 0,
      totalSpecshipCalls: 0,
      byTool: [],
      byProject: [],
      trend: [],
    };
  }

  const pricingRows = loadPricing(db);

  // ---------------------------------------------------------------------------
  // 2. Group rows by prompt_id for per-prompt dedup.
  // ---------------------------------------------------------------------------
  const byPrompt = new Map<string, RawRow[]>();
  for (const row of rows) {
    const key = row.prompt_id ?? `__no_prompt_${row.ts}`;
    const arr = byPrompt.get(key);
    if (arr) arr.push(row);
    else byPrompt.set(key, [row]);
  }

  // ---------------------------------------------------------------------------
  // 3. Global spend / saved (with per-prompt dedup) + cost by model.
  // ---------------------------------------------------------------------------
  let totalSpendChars = 0;
  let totalSavedChars = 0;
  let totalSpecshipCalls = 0;
  let unresolvedCalls = 0;

  // For cost we need to track chars by model.
  const spendCharsByModel = new Map<string, number>();
  const savedCharsByModel = new Map<string, number>();

  // Per-tool accumulators: spend is exact; saved is a per-tool APPROXIMATION.
  // Exact per-tool saved attribution is ambiguous when two tools in the same
  // prompt share a file. We approximate: a tool's saved chars = its own
  // resolved displaced files (deduped within the tool, not globally within
  // the prompt). This overestimates when tools share files but keeps
  // individual tool savings intuitive. Spend is always exact.
  const toolSpendChars = new Map<string, number>();
  const toolSavedChars = new Map<string, number>();
  const toolCalls = new Map<string, number>();

  // Per-project (only when no project filter).
  const projectSpendChars = new Map<string, number>();
  const projectSavedChars = new Map<string, number>();

  // Trend: daily buckets.
  const dayMs = 24 * 60 * 60 * 1000;
  const trendSpend = new Map<number, number>(); // dayBucket → chars
  const trendSaved = new Map<number, number>();

  // Pass 1: global spend/saved via per-prompt dedup.
  for (const [, promptRows] of byPrompt) {
    const { savedChars, spendChars } = computePromptSaved(promptRows);
    totalSpendChars += spendChars;
    totalSavedChars += savedChars;

    // Attribute spend/saved chars to the session's model.
    // All rows in a prompt share the same session (same last_model).
    const model = promptRows[0]?.last_model ?? null;
    const normModel = model ? normalizeModelId(model) : null;
    if (normModel) {
      spendCharsByModel.set(normModel, (spendCharsByModel.get(normModel) ?? 0) + spendChars);
      savedCharsByModel.set(normModel, (savedCharsByModel.get(normModel) ?? 0) + savedChars);
    }

    // Track per-day trend for this prompt's is_specship rows.
    for (const row of promptRows) {
      if (row.is_specship !== 1) continue;

      totalSpecshipCalls++;
      if (row.resolution === 'unresolved') unresolvedCalls++;

      // Session tracking (for overhead).
      // We need the session_id — it's not in our fetch. Derive from project+model
      // won't work. We'll collect it via a separate map after this loop using rows.
    }
  }

  // We need session_ids for overhead. Since we joined sessions but didn't select
  // session_id, do a lightweight distinct-session count via a separate query.
  const sessionCountQParts: string[] = [
    `SELECT COUNT(DISTINCT tc.session_id) as cnt
     FROM claude_tool_calls tc
     JOIN claude_sessions s ON s.id = tc.session_id
     WHERE tc.ts >= ? AND tc.is_specship = 1`,
  ];
  const sessionCountParams: unknown[] = [since];
  if (project) {
    sessionCountQParts.push('AND s.project_path = ?');
    sessionCountParams.push(project);
  }
  const sessionCountRow = db
    .prepare(sessionCountQParts.join(' '))
    .get(...sessionCountParams) as { cnt: number } | undefined;
  const specshipSessionCount = sessionCountRow?.cnt ?? 0;

  // ---------------------------------------------------------------------------
  // Pass 2: per-tool and trend (row-level, NOT requiring per-prompt dedup).
  // ---------------------------------------------------------------------------
  // Per-tool saved approximation: for each is_specship row with resolution=resolved,
  // compute its own per-call "saved" as max(0, sum(displaced_file_sizes) - result_length).
  // This is approximate because it ignores cross-call file sharing within a prompt,
  // but it gives an intuitive per-tool estimate and spend is always exact.
  for (const row of rows) {
    const dayBucket = Math.floor(row.ts / dayMs) * dayMs;

    if (row.is_specship !== 1) continue;

    const toolName = row.tool_name ?? 'unknown';
    toolCalls.set(toolName, (toolCalls.get(toolName) ?? 0) + 1);
    const spend = row.result_length ?? 0;
    toolSpendChars.set(toolName, (toolSpendChars.get(toolName) ?? 0) + spend);

    // Per-tool saved approximation: own displaced files minus own spend, ≥0.
    const displaced = parseDisplacedFiles(row.displaced_files);
    if (row.resolution === 'resolved' && displaced.length > 0) {
      const fileUnion = new Map<string, number>();
      for (const [p, sz] of displaced) if (!fileUnion.has(p)) fileUnion.set(p, sz);
      const readEquiv = Array.from(fileUnion.values()).reduce((s, n) => s + n, 0);
      const toolSaved = Math.max(0, readEquiv - spend);
      toolSavedChars.set(toolName, (toolSavedChars.get(toolName) ?? 0) + toolSaved);
    }

    // Trend.
    trendSpend.set(dayBucket, (trendSpend.get(dayBucket) ?? 0) + spend);
  }

  // Per-prompt saved for trend and byProject (both need per-prompt dedup).
  for (const [, promptRows] of byPrompt) {
    const { savedChars } = computePromptSaved(promptRows);
    const project_path = promptRows[0]?.project_path ?? '';
    const dayBucket = Math.floor((promptRows[0]?.ts ?? 0) / dayMs) * dayMs;

    // Trend saved.
    if (savedChars > 0) {
      trendSaved.set(dayBucket, (trendSaved.get(dayBucket) ?? 0) + savedChars);
    }

    // byProject accumulators.
    if (!project) {
      const spendChars = promptRows
        .filter(r => r.is_specship === 1)
        .reduce((s, r) => s + (r.result_length ?? 0), 0);
      projectSpendChars.set(project_path, (projectSpendChars.get(project_path) ?? 0) + spendChars);
      projectSavedChars.set(project_path, (projectSavedChars.get(project_path) ?? 0) + savedChars);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Compute tokens + cost.
  // ---------------------------------------------------------------------------
  const spendTokens = Math.ceil(totalSpendChars / CHARS_PER_TOKEN);
  const savedTokens = Math.ceil(totalSavedChars / CHARS_PER_TOKEN);
  const overheadTokens = OVERHEAD_TOKENS_PER_SESSION * specshipSessionCount;

  let spendCostUsd = 0;
  let savedCostUsd = 0;
  for (const [model, chars] of spendCharsByModel) {
    spendCostUsd += priceChars(chars, model, pricingRows);
  }
  for (const [model, chars] of savedCharsByModel) {
    savedCostUsd += priceChars(chars, model, pricingRows);
  }

  const netTokens = savedTokens - spendTokens - overheadTokens;
  const netCostUsd = savedCostUsd - spendCostUsd;

  // ---------------------------------------------------------------------------
  // 5. byTool.
  // ---------------------------------------------------------------------------
  const byTool = Array.from(toolCalls.entries()).map(([tool, calls]) => ({
    tool,
    calls,
    spendTokens: Math.ceil((toolSpendChars.get(tool) ?? 0) / CHARS_PER_TOKEN),
    savedTokens: Math.ceil((toolSavedChars.get(tool) ?? 0) / CHARS_PER_TOKEN),
  })).sort((a, b) => b.calls - a.calls);

  // ---------------------------------------------------------------------------
  // 6. byProject (only when no project filter).
  // ---------------------------------------------------------------------------
  const byProject = project
    ? []
    : Array.from(projectSpendChars.keys()).map((proj) => {
        const spend = Math.ceil((projectSpendChars.get(proj) ?? 0) / CHARS_PER_TOKEN);
        const saved = Math.ceil((projectSavedChars.get(proj) ?? 0) / CHARS_PER_TOKEN);
        return {
          project: proj,
          spendTokens: spend,
          savedTokens: saved,
          netTokens: saved - spend,
        };
      }).sort((a, b) => b.spendTokens - a.spendTokens);

  // ---------------------------------------------------------------------------
  // 7. trend.
  // ---------------------------------------------------------------------------
  const allDayBuckets = new Set([...trendSpend.keys(), ...trendSaved.keys()]);
  const trend = Array.from(allDayBuckets)
    .sort((a, b) => a - b)
    .map((ts) => ({
      ts,
      spendTokens: Math.ceil((trendSpend.get(ts) ?? 0) / CHARS_PER_TOKEN),
      savedTokens: Math.ceil((trendSaved.get(ts) ?? 0) / CHARS_PER_TOKEN),
    }));

  return {
    spendTokens,
    spendCostUsd,
    savedTokens,
    savedCostUsd,
    overheadTokens,
    netTokens,
    netCostUsd,
    unresolvedCalls,
    totalSpecshipCalls,
    byTool,
    byProject,
    trend,
  };
}
