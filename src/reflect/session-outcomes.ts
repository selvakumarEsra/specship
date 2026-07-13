/**
 * Deterministic session outcome records (LEARN-DOC, REQ-LEARN-004) — tier 3
 * of SpecShip's memory made recallable.
 *
 * Everything here is a computed join over rows the ingest already writes
 * (`claude_*`) plus `workflow_runs` — no LLM summarization, no new write
 * path, and no claims the data can't prove: transcripts carry tool-call
 * metadata and result LENGTH (never exit codes), so test outcomes appear
 * only via a workflow run's own recorded status.
 */

import type { SqliteDatabase } from '../db/sqlite-adapter';

export interface SessionOutcome {
  sessionId: string;
  startedAt: number | null;
  /** First line of the session's opening prompt (trimmed, capped). */
  firstPrompt: string;
  /** Distinct files the agent edited (Edit/Write targets). */
  filesEdited: string[];
  /** Total shell commands run. */
  commandsRun: number;
  /** Total specship tool calls. */
  specshipCalls: number;
  /** specship_link_assert calls — spec links asserted in-session. */
  linksAsserted: number;
  /**
   * Workflow runs whose lifetime overlaps the session window. workflow_runs
   * carries no session id, so this is a deterministic time-overlap join —
   * labeled as such wherever rendered.
   */
  workflowRuns: Array<{ id: string; name: string; status: string }>;
  costUsd: number;
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  try {
    return !!db
      .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
  } catch {
    return false;
  }
}

/**
 * Sessions (this project only, both path forms) that EDITED any of the given
 * files, newest first. `excludeActiveWithinMs` drops sessions still active
 * recently — the current session is in these tables too (ingest is live) and
 * "prior work: two minutes ago" is noise, not recall.
 */
export function sessionsTouchingFiles(
  db: SqliteDatabase,
  projectForms: [string, string],
  filePaths: string[],
  opts: { limit?: number; excludeActiveWithinMs?: number; now?: number } = {}
): string[] {
  if (filePaths.length === 0) return [];
  if (!tableExists(db, 'claude_tool_calls') || !tableExists(db, 'claude_sessions')) return [];
  const limit = opts.limit ?? 3;
  const quiet = opts.excludeActiveWithinMs ?? 30 * 60_000;
  const now = opts.now ?? Date.now();
  // Edit/Write input_summary IS the file path (summarizeToolInput). Match on
  // path suffix so absolute vs project-relative storage both hit.
  const caps = filePaths.slice(0, 12);
  const suffixClauses = caps.map(() => `t.input_summary LIKE ?`).join(' OR ');
  const params: unknown[] = [...projectForms, ...caps.map((p) => `%${p}`), now - quiet, limit];
  try {
    const rows = db
      .prepare(
        `SELECT s.id, MAX(s.started_at) AS started
         FROM claude_tool_calls t
         JOIN claude_sessions s ON s.id = t.session_id
         WHERE t.tool_name IN ('Edit','Write')
           AND s.project_path IN (?, ?)
           AND (${suffixClauses})
           AND COALESCE(s.ended_at, s.started_at, 0) < ?
         GROUP BY s.id
         ORDER BY started DESC
         LIMIT ?`
      )
      .all(...params) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/** Resolve one session's outcome record. Null when the session is unknown. */
export function sessionOutcome(db: SqliteDatabase, sessionId: string): SessionOutcome | null {
  if (!tableExists(db, 'claude_sessions')) return null;
  const s = db
    .prepare(`SELECT id, started_at, ended_at, total_cost_usd FROM claude_sessions WHERE id = ?`)
    .get(sessionId) as { id: string; started_at: number | null; ended_at: number | null; total_cost_usd: number | null } | undefined;
  if (!s) return null;

  const firstPromptRow = db
    .prepare(
      `SELECT text FROM claude_prompts
       WHERE session_id = ? AND text IS NOT NULL AND text NOT LIKE '<%'
       ORDER BY ts ASC LIMIT 1`
    )
    .get(sessionId) as { text: string } | undefined;
  const firstPrompt = (firstPromptRow?.text ?? '').split('\n')[0]?.trim().slice(0, 100) ?? '';

  const filesEdited = (db
    .prepare(
      `SELECT DISTINCT input_summary AS f FROM claude_tool_calls
       WHERE session_id = ? AND tool_name IN ('Edit','Write') AND input_summary != ''
       ORDER BY f LIMIT 40`
    )
    .all(sessionId) as Array<{ f: string }>).map((r) => r.f);

  const count = (sql: string): number =>
    ((db.prepare(sql).get(sessionId) as { n: number } | undefined)?.n ?? 0);
  const commandsRun = count(
    `SELECT COUNT(*) AS n FROM claude_tool_calls WHERE session_id = ? AND tool_name = 'Bash'`
  );
  const specshipCalls = count(
    `SELECT COUNT(*) AS n FROM claude_tool_calls WHERE session_id = ? AND is_specship = 1`
  );
  const linksAsserted = count(
    `SELECT COUNT(*) AS n FROM claude_tool_calls WHERE session_id = ? AND tool_name LIKE '%specship_link_assert'`
  );

  // Time-overlap join to workflow runs (no session FK exists — deterministic
  // heuristic, always labeled as in-window when rendered).
  let workflowRuns: SessionOutcome['workflowRuns'] = [];
  if (tableExists(db, 'workflow_runs') && s.started_at) {
    const end = s.ended_at ?? Date.now();
    workflowRuns = (db
      .prepare(
        `SELECT id, workflow_name AS name, status FROM workflow_runs
         WHERE created_at <= ? AND COALESCE(completed_at, last_activity_at) >= ?
         ORDER BY created_at DESC LIMIT 5`
      )
      .all(end, s.started_at) as Array<{ id: string; name: string; status: string }>);
  }

  return {
    sessionId: s.id,
    startedAt: s.started_at,
    firstPrompt,
    filesEdited,
    commandsRun,
    specshipCalls,
    linksAsserted,
    workflowRuns,
    costUsd: s.total_cost_usd ?? 0,
  };
}
