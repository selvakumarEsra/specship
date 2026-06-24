/**
 * Lazy backfill of `displaced_files` / `resolution` for pre-existing rows.
 *
 * After the v9 migration, existing `claude_tool_calls` rows have `is_specship`
 * set (from the SQL migration) but `resolution IS NULL` and
 * `displaced_files IS NULL`. This module fills them in so the impact dashboard
 * reflects historical SpecShip usage, not just calls ingested post-upgrade.
 *
 * Design notes:
 *   - Only touches rows where `is_specship = 1 AND resolution IS NULL`.
 *   - Resolves the graph once per distinct `project_path` (cached in a Map).
 *   - Calls `classifyToolCall` — same logic as live ingest (DRY).
 *   - Idempotent: a second run is always a no-op (no eligible rows remain).
 *   - The `resolveGraph` call is wrapped in try/catch — a locked or corrupt
 *     index falls back to null, which classifies the row as 'unresolved'.
 *   - Must never crash the caller. The server bootstrap wraps in try/catch.
 */

import { classifyToolCall } from './specship-classify.js';
import type { GraphLike } from './specship-classify.js';
import type { IngestDb } from './ingestor.js';

/**
 * Backfill `resolution` and `displaced_files` for every `claude_tool_calls`
 * row that has `is_specship = 1 AND resolution IS NULL`.
 *
 * @param db            - The analytics SQLite handle (same type as ingestor uses).
 * @param resolveGraph  - Factory returning a `GraphLike` for a project path,
 *                        or null if unavailable.
 */
export function backfillDisplaced(
  db: IngestDb,
  resolveGraph: (projectPath: string) => GraphLike | null,
): void {
  // Fetch all eligible rows in one query. JOIN to sessions to get project_path.
  // We limit to is_specship=1 AND resolution IS NULL so already-classified rows
  // are never re-processed, giving natural idempotency.
  const rows = db.prepare(`
    SELECT tc.id, tc.tool_name, tc.input_json, tc.result_length, s.project_path
    FROM claude_tool_calls tc
    JOIN claude_sessions s ON s.id = tc.session_id
    -- NULL = never classified (pre-upgrade rows). 'unresolved' = classified but
    -- the graph/symbols didn't resolve — retry those too, since the resolver and
    -- the symbol extractor have both been fixed, and a row left unresolved while
    -- its project wasn't primary should resolve once that project IS primary.
    -- 'resolved' and 'n/a' are terminal and never reprocessed.
    WHERE tc.is_specship = 1 AND (tc.resolution IS NULL OR tc.resolution = 'unresolved')
  `).all() as Array<{
    id: number;
    tool_name: string;
    input_json: string | null;
    result_length: number;
    project_path: string;
  }>;

  if (rows.length === 0) return;

  // Cache resolved graphs so we open each project at most once per call.
  const graphCache = new Map<string, GraphLike | null>();

  const updateStmt = db.prepare(
    'UPDATE claude_tool_calls SET resolution = ?, displaced_files = ? WHERE id = ?'
  );

  // Wrap everything in a single transaction for speed + atomicity.
  const runTxn = db.transaction(() => {
    for (const row of rows) {
      // Resolve the graph for this project path (cached).
      let graph: GraphLike | null;
      if (graphCache.has(row.project_path)) {
        graph = graphCache.get(row.project_path)!;
      } else {
        try {
          graph = resolveGraph(row.project_path);
        } catch {
          graph = null;
        }
        graphCache.set(row.project_path, graph);
      }

      const cls = classifyToolCall(
        { toolName: row.tool_name, inputJson: row.input_json, resultLength: row.result_length },
        graph,
      );

      updateStmt.run(cls.resolution, cls.displacedFiles, row.id);
    }
  });

  runTxn();
}
