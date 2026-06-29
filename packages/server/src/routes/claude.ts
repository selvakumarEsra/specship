/**
 * Claude Code analytics routes.
 *
 * All queries hit specship's SQLite directly. The ingest worker
 * (`@selvakumaresra/specship-ingest`) writes to claude_* tables; this layer
 * just rolls up.
 *
 * Endpoints:
 *   GET /api/claude/projects                 — every indexed Claude project
 *   GET /api/claude/sessions?project=&limit= — sessions list
 *   GET /api/claude/session/:id              — session detail (prompts + tools)
 *   GET /api/claude/heatmap?range=           — file/tool/subagent heatmaps
 *   GET /api/claude/costs?range=             — cost rollup, timeseries, per-model
 *   GET /api/claude/compare                  — per-project cost comparison
 *   GET /api/claude/tips                     — rule-based tips engine output
 *   GET /api/claude/specship-impact?range=&project= — SpecShip token-impact aggregation
 *   POST /api/claude/ingest                  — force a one-shot ingest pass
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';
import { decodeProjectSlug } from '../ingest/index.js';
import { computeSpecshipImpact } from '../ingest/impact-query.js';

/**
 * Normalize a `?project=` filter value to the form stored in
 * claude_sessions.project_path. The Sessions page (and any other UI
 * surface that uses ProjectsService.projectQuery()) sends the directory
 * SLUG that names the Claude Code transcript dir (e.g.
 * `-Users-foo-projects-bar`), but the ingestor writes the DECODED path
 * (e.g. `/Users/foo/projects/bar`) into project_path because that's the
 * value the agent actually identifies the project by. Comparing slug
 * against path always fails and the list comes back empty even though
 * the rows are there — fix by decoding the slug form here.
 *
 * A path passed in directly (doesn't start with `-`) round-trips
 * unchanged, so curl-by-path and the old behavior both keep working.
 */
function normalizeProjectFilter(input: string): string {
  return decodeProjectSlug(input);
}

type DbHandle = { prepare: (s: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown } };

type RangeKey = 'today' | 'week' | 'month' | 'all';

const RANGE_WINDOW_MS: Record<RangeKey, number> = {
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: Number.MAX_SAFE_INTEGER,
};

function rangeKey(input: string | undefined): RangeKey {
  if (input === 'today' || input === 'week' || input === 'month' || input === 'all') return input;
  return 'week';
}

function rangeStart(key: RangeKey): number {
  if (key === 'all') return 0;
  return Date.now() - RANGE_WINDOW_MS[key];
}

/**
 * Bounds of the period immediately BEFORE the current range window — used for
 * week-over-week (wowDelta) comparisons. For 'all' there's no prior period, so
 * both bounds collapse to 0 and callers should treat the delta as 0.
 */
function priorWindow(key: RangeKey): { start: number; end: number } {
  if (key === 'all') return { start: 0, end: 0 };
  const w = RANGE_WINDOW_MS[key];
  const end = Date.now() - w;
  return { start: end - w, end };
}

/**
 * Get the internal SQLite handle off the DatabaseConnection so we can run
 * Claude-specific aggregate queries directly. SpecShip exposes this via
 * `getDb()`-style accessors. Falls back to digging via the queries property.
 */
function getDb(cg: SpecShipInstance): DbHandle {
  // SpecShip exposes the underlying DB via its DatabaseConnection. Look it
  // up via the private field as a fallback — works because it's the same
  // shape regardless of which adapter (better-sqlite3 / node:sqlite) is active.
  const anyCg = cg as unknown as { db?: { getDb?: () => unknown }; queries?: { db?: unknown } };
  if (anyCg.db?.getDb) return anyCg.db.getDb() as DbHandle;
  if (anyCg.queries?.db) return anyCg.queries.db as DbHandle;
  throw new Error('specship DB handle not accessible from server context');
}

export async function registerClaudeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Analytics routes share one SQLite — the boot-time "primary" project's
   * specship.db hosts the cross-project claude_* tables. Without a primary
   * the JSONL ingest has nowhere to write and there's nothing to query, so
   * every analytics handler asks here first.
   */
  function requirePrimary(reply: FastifyReply): SpecShipInstance | null {
    if (!app.primaryCg) {
      reply.code(409).send({ error: 'analytics unavailable: no primary project configured', code: 'no_primary' });
      return null;
    }
    return app.primaryCg;
  }

  app.get('/api/claude/projects', async (_req, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const rows = db.prepare(`
      SELECT p.path, p.name, p.first_seen, p.last_seen,
             COUNT(s.id) as sessions,
             COALESCE(SUM(s.total_cost_usd), 0) as cost,
             COALESCE(SUM(s.total_cache_read_tokens), 0) as cacheRead,
             COALESCE(SUM(s.total_cache_creation_tokens + s.total_input_tokens), 0) as totalInput,
             COALESCE(SUM(s.prompt_count), 0) as prompts
      FROM claude_projects p
      LEFT JOIN claude_sessions s ON s.project_path = p.path
      GROUP BY p.path
      ORDER BY cost DESC
    `).all() as Array<Record<string, number | string>>;
    return { projects: rows };
  });

  app.get('/api/claude/sessions', async (req: FastifyRequest<{ Querystring: { project?: string; limit?: string; range?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
    const since = rangeStart(rangeKey(req.query.range));
    const params: unknown[] = [since];
    let whereProject = '';
    if (req.query.project) {
      whereProject = ' AND project_path = ?';
      params.push(normalizeProjectFilter(req.query.project));
    }
    params.push(limit);
    const sessions = db.prepare(`
      SELECT * FROM claude_sessions
      WHERE started_at >= ?${whereProject}
      ORDER BY started_at DESC
      LIMIT ?
    `).all(...params);
    return { sessions };
  });

  app.get('/api/claude/session/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const session = db.prepare('SELECT * FROM claude_sessions WHERE id = ?').get(req.params.id);
    if (!session) return reply.code(404).send({ error: 'session not found' });
    const prompts = db.prepare(`
      SELECT * FROM claude_prompts WHERE session_id = ? ORDER BY ts ASC
    `).all(req.params.id) as Array<{ ts: number } & Record<string, unknown>>;
    const toolCalls = db.prepare(`
      SELECT * FROM claude_tool_calls WHERE session_id = ? ORDER BY ts ASC
    `).all(req.params.id);
    // Per-prompt wall-clock duration: the gap from this prompt to the next one
    // (last prompt runs to the session's end). Lets the UI show "how long did
    // this turn take" without a separate per-event timeline.
    const endedAt = (session as { ended_at?: number }).ended_at ?? null;
    prompts.forEach((p, i) => {
      const next = prompts[i + 1];
      const end = next ? next.ts : (endedAt ?? p.ts);
      p.durationMs = Math.max(0, end - p.ts);
    });
    return { session, prompts, toolCalls };
  });

  /**
   * SSE event stream for a single session — pushes new prompts and tool
   * calls as the JSONL ingest watcher lands them, so the dashboard's
   * Session Detail page can update without polling. Mirrors the shape used
   * by /api/workflows/runs/:id/events.
   *
   * Polling cadence inside the loop is 500 ms — fast enough that the
   * end-to-end "user hit Enter in Claude Code → prompt visible in
   * dashboard" latency stays well under one second (300 ms watcher
   * debounce + ≤50 ms ingest + ≤500 ms poll). Heartbeat every 15 s
   * keeps idle connections alive past any proxy or browser tab-throttle
   * cutoff.
   *
   * The client (LiveSessionTail in session-detail.ts) doesn't merge events
   * incrementally — it just calls resource.refetch() on every event since
   * the detail endpoint is local + cheap. Server-side, that means we only
   * need to push enough info for the client to know "something changed"
   * (id + ts), not the full row payloads. We send the full row anyway so
   * a future client could merge incrementally without an API change.
   */
  app.get('/api/claude/session/:id/events', async (req: FastifyRequest<{ Params: { id: string }; Querystring: { sincePromptTs?: string; sinceToolTs?: string } }>, reply: FastifyReply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const sessionId = req.params.id;

    // Confirm the session exists before opening the stream — saves a
    // doomed connection from polling forever against a typo.
    const sessionRow = db.prepare('SELECT id FROM claude_sessions WHERE id = ?').get(sessionId);
    if (!sessionRow) {
      return reply.code(404).send({ error: 'session not found' });
    }

    // Resume points — clients can pick up after a disconnect without
    // re-receiving every prompt. Defaults to "now" so an opening client
    // only sees future events.
    let lastPromptTs = parseInt(req.query.sincePromptTs ?? '0', 10);
    let lastToolTs = parseInt(req.query.sinceToolTs ?? '0', 10);
    if (!lastPromptTs || Number.isNaN(lastPromptTs)) {
      const row = db.prepare('SELECT MAX(ts) as m FROM claude_prompts WHERE session_id = ?').get(sessionId) as { m: number | null } | undefined;
      lastPromptTs = row?.m ?? 0;
    }
    if (!lastToolTs || Number.isNaN(lastToolTs)) {
      const row = db.prepare('SELECT MAX(ts) as m FROM claude_tool_calls WHERE session_id = ?').get(sessionId) as { m: number | null } | undefined;
      lastToolTs = row?.m ?? 0;
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // nginx-friendly
    reply.raw.flushHeaders();

    // Initial snapshot — gives the client a clean baseline (so it knows
    // SSE is wired up even before any new event fires) and the cursor
    // positions it should resume from on reconnect.
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ sessionId, lastPromptTs, lastToolTs })}\n\n`);

    let closed = false;
    req.raw.on('close', () => { closed = true; });

    const newPromptsStmt = db.prepare('SELECT * FROM claude_prompts WHERE session_id = ? AND ts > ? ORDER BY ts ASC');
    const newToolsStmt = db.prepare('SELECT * FROM claude_tool_calls WHERE session_id = ? AND ts > ? ORDER BY ts ASC');

    let lastHeartbeat = Date.now();

    const tick = (): void => {
      if (closed) return;
      try {
        const freshPrompts = newPromptsStmt.all(sessionId, lastPromptTs) as Array<{ ts: number }>;
        for (const p of freshPrompts) {
          reply.raw.write(`event: prompt_added\ndata: ${JSON.stringify(p)}\n\n`);
          if (p.ts > lastPromptTs) lastPromptTs = p.ts;
        }
        const freshTools = newToolsStmt.all(sessionId, lastToolTs) as Array<{ ts: number }>;
        for (const t of freshTools) {
          reply.raw.write(`event: tool_call_added\ndata: ${JSON.stringify(t)}\n\n`);
          if (t.ts > lastToolTs) lastToolTs = t.ts;
        }

        // Heartbeat every 15 s — keeps proxies / browser tab throttles
        // from killing an otherwise-idle connection.
        const now = Date.now();
        if (now - lastHeartbeat >= 15_000) {
          reply.raw.write(`: keepalive ${now}\n\n`);
          lastHeartbeat = now;
        }
      } catch (err) {
        // Surface DB errors to the client as a named event and end the
        // stream — the client's onError handler flips to polling.
        reply.raw.write(`event: stream_error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
        reply.raw.end();
        closed = true;
        return;
      }
      setTimeout(tick, 500);
    };
    void tick();
  });

  /**
   * Session-level aggregation for the Session Detail "Session summary" panel.
   * Three things callers can't cheaply derive client-side from the per-prompt
   * list: tool usage rolled up by name, files touched across all turns, and
   * slash-command / skill invocation counts (which require either a regex
   * over every prompt's text or json_extract over every Skill tool input).
   * Computed once per session-detail page load (and after refresh) — cheap
   * enough to recompute on every call, no caching.
   */
  app.get('/api/claude/session/:id/summary', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const sessionId = req.params.id;

    const session = db.prepare('SELECT id, started_at, ended_at FROM claude_sessions WHERE id = ?').get(sessionId) as { id: string; started_at: number | null; ended_at: number | null } | undefined;
    if (!session) return reply.code(404).send({ error: 'session not found' });

    // Tools used in this session, rolled up by name. Mirrors the heatmap
    // tool query but scoped to one session, so the panel can answer "what
    // did Claude DO in this session" at a glance.
    const byTool = db.prepare(`
      SELECT tool_name as name, COUNT(*) as calls, COALESCE(SUM(result_length), 0) as totalBytes
      FROM claude_tool_calls
      WHERE session_id = ?
      GROUP BY tool_name
      ORDER BY calls DESC
    `).all(sessionId) as Array<{ name: string; calls: number; totalBytes: number }>;

    // Models used. Most sessions stay on one model but sidechains can fan
    // out to Haiku, so this surfaces multi-model spend that the session-level
    // last_model column hides.
    const byModel = db.prepare(`
      SELECT model, COUNT(*) as prompts, COALESCE(SUM(cost_usd), 0) as cost
      FROM claude_prompts
      WHERE session_id = ? AND model IS NOT NULL
      GROUP BY model
      ORDER BY cost DESC
    `).all(sessionId) as Array<{ model: string; prompts: number; cost: number }>;

    // Files touched via Read/Edit/Write/NotebookEdit. input_summary IS the
    // file path for those tools (set in the ingestor's parser). Group by
    // path, count ops, also record which tool last touched it so the UI
    // can show a "last op" hint (Read vs Edit).
    const filesTouched = db.prepare(`
      SELECT input_summary as path, COUNT(*) as ops,
             (SELECT tool_name FROM claude_tool_calls AS inner_tc
                WHERE inner_tc.session_id = tc.session_id
                  AND inner_tc.input_summary = tc.input_summary
                ORDER BY inner_tc.ts DESC LIMIT 1) as lastOp
      FROM claude_tool_calls AS tc
      WHERE tc.session_id = ?
        AND tc.tool_name IN ('Read','Edit','Write','NotebookEdit','MultiEdit')
        AND tc.input_summary != ''
      GROUP BY tc.input_summary
      ORDER BY ops DESC
      LIMIT 30
    `).all(sessionId) as Array<{ path: string; ops: number; lastOp: string }>;

    // Skills invoked via the Skill tool. The ingestor stashes the
    // JSON-serialized input under input_summary, so json_extract pulls the
    // skill name straight out without needing the v7 input_json column to
    // be backfilled.
    const skills = db.prepare(`
      SELECT
        COALESCE(json_extract(input_summary, '$.skill'), json_extract(input_summary, '$.skill_name'), 'unknown') as name,
        COUNT(*) as count
      FROM claude_tool_calls
      WHERE session_id = ? AND tool_name = 'Skill'
      GROUP BY name
      ORDER BY count DESC
    `).all(sessionId) as Array<{ name: string; count: number }>;

    // Slash commands invoked. Claude Code wraps each one in a
    // <command-name>/foo</command-name> tag in the user-prompt text.
    // Pull every prompt that has that tag and regex it client-side here
    // (SQLite has no built-in regex). Cheap — most sessions have <50.
    const taggedPrompts = db.prepare(`
      SELECT text FROM claude_prompts WHERE session_id = ? AND text LIKE '%<command-name>%'
    `).all(sessionId) as Array<{ text: string }>;
    const cmdCounts = new Map<string, number>();
    const cmdRe = /<command-name>([^<]+)<\/command-name>/g;
    for (const { text } of taggedPrompts) {
      if (!text) continue;
      for (const m of text.matchAll(cmdRe)) {
        const raw = m[1]?.trim();
        if (!raw) continue;
        cmdCounts.set(raw, (cmdCounts.get(raw) ?? 0) + 1);
      }
    }
    const slashCommands = Array.from(cmdCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const durationMs = session.started_at && session.ended_at
      ? Math.max(0, session.ended_at - session.started_at)
      : 0;

    // SpecShip token-impact rollup for this session.
    const impact = computeSpecshipImpact(db, { since: 0, sessionId });
    const specship = {
      spendTokens: impact.spendTokens,
      savedTokens: impact.savedTokens,
      netTokens: impact.netTokens,
    };

    return {
      sessionId,
      byTool,
      byModel,
      slashCommands,
      skills,
      filesTouched,
      durationMs,
      specship,
    };
  });

  app.get('/api/claude/heatmap', async (req: FastifyRequest<{ Querystring: { range?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));

    // Files heatmap — input_summary doubles as the file path for Read/Edit/Write.
    const files = db.prepare(`
      SELECT input_summary as path, COUNT(*) as calls, SUM(result_length) as resultBytes
      FROM claude_tool_calls
      WHERE ts >= ? AND tool_name IN ('Read','Edit','Write','NotebookEdit') AND input_summary != ''
      GROUP BY input_summary
      ORDER BY calls DESC
      LIMIT 100
    `).all(since) as Array<Record<string, number | string>>;

    // Per-file 7-day call trend — one sparkline (oldest→newest) per file cell.
    // Always a fixed 7-day window, independent of `range`, so the trend reads
    // consistently regardless of the heatmap's selected window.
    const dayMs = 24 * 60 * 60 * 1000;
    const trend7Start = Math.floor(Date.now() / dayMs) * dayMs - 6 * dayMs;
    const trendRows = db.prepare(`
      SELECT input_summary as path, CAST((ts - ?) / ? AS INTEGER) as bucket, COUNT(*) as calls
      FROM claude_tool_calls
      WHERE ts >= ? AND tool_name IN ('Read','Edit','Write','NotebookEdit') AND input_summary != ''
      GROUP BY input_summary, bucket
    `).all(trend7Start, dayMs, trend7Start) as Array<{ path: string; bucket: number; calls: number }>;
    const trendByPath = new Map<string, number[]>();
    for (const r of trendRows) {
      if (r.bucket < 0 || r.bucket > 6) continue;
      const arr = trendByPath.get(r.path) ?? [0, 0, 0, 0, 0, 0, 0];
      arr[r.bucket] = r.calls;
      trendByPath.set(r.path, arr);
    }
    for (const f of files) {
      (f as Record<string, unknown>).trend = trendByPath.get(f.path as string) ?? [0, 0, 0, 0, 0, 0, 0];
    }

    // Tools heatmap.
    const tools = db.prepare(`
      SELECT tool_name as name, COUNT(*) as calls, SUM(result_length) as resultBytes
      FROM claude_tool_calls
      WHERE ts >= ?
      GROUP BY tool_name
      ORDER BY calls DESC
    `).all(since);

    // Subagent attribution (is_sidechain at the prompt level — main vs. sidechain rollup).
    const subagents = db.prepare(`
      SELECT
        CASE WHEN p.is_sidechain = 1 THEN 'subagent' ELSE 'main' END as type,
        COUNT(*) as prompts,
        SUM(p.input_tokens + p.output_tokens + p.cache_creation_tokens + p.cache_read_tokens) as tokens,
        SUM(p.cost_usd) as cost
      FROM claude_prompts p
      WHERE p.ts >= ?
      GROUP BY type
    `).all(since);

    // Subagent breakdown by name — Task tool calls grouped by subagent_type.
    // input_summary is the JSON-serialized tool input; json_extract pulls
    // out subagent_type (defaults to 'general-purpose' when unset).
    const subagentByName = db.prepare(`
      SELECT
        COALESCE(NULLIF(json_extract(input_summary, '$.subagent_type'), ''), 'general-purpose') as name,
        COUNT(*) as calls,
        MIN(ts) as firstSeen,
        MAX(ts) as lastSeen
      FROM claude_tool_calls
      WHERE ts >= ? AND tool_name = 'Task'
      GROUP BY name
      ORDER BY calls DESC
    `).all(since);

    return { files, tools, subagents, subagentByName };
  });

  /**
   * Drill-down: which sessions touched a given file (via Read/Edit/Write).
   * Used by the heatmap page when the user clicks a file cell.
   */
  app.get('/api/claude/heatmap/file', async (req: FastifyRequest<{ Querystring: { path?: string; range?: string } }>, reply) => {
    const path = req.query.path;
    if (!path) return reply.code(400).send({ error: 'path required' });
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));
    const sessions = db.prepare(`
      SELECT t.session_id, s.last_model, s.project_path,
             COUNT(*) as calls, COALESCE(SUM(t.result_length), 0) as bytes,
             MAX(t.ts) as lastTs, MIN(t.ts) as firstTs
      FROM claude_tool_calls t
      LEFT JOIN claude_sessions s ON s.id = t.session_id
      WHERE t.input_summary = ? AND t.ts >= ? AND t.tool_name IN ('Read','Edit','Write','NotebookEdit')
      GROUP BY t.session_id
      ORDER BY calls DESC
      LIMIT 50
    `).all(path, since);
    const byTool = db.prepare(`
      SELECT tool_name as name, COUNT(*) as calls, COALESCE(SUM(result_length), 0) as bytes
      FROM claude_tool_calls
      WHERE input_summary = ? AND ts >= ? AND tool_name IN ('Read','Edit','Write','NotebookEdit')
      GROUP BY tool_name
      ORDER BY calls DESC
    `).all(path, since);
    return { path, sessions, byTool };
  });

  /**
   * Drill-down: the top distinct inputs for a given tool (file paths for
   * Read/Edit/Write, patterns for Grep/Glob, commands for Bash).
   */
  app.get('/api/claude/heatmap/tool', async (req: FastifyRequest<{ Querystring: { name?: string; range?: string } }>, reply) => {
    const name = req.query.name;
    if (!name) return reply.code(400).send({ error: 'name required' });
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));
    const totals = db.prepare(`
      SELECT COUNT(*) as calls, COALESCE(SUM(result_length), 0) as bytes,
             COUNT(DISTINCT session_id) as sessions
      FROM claude_tool_calls
      WHERE tool_name = ? AND ts >= ?
    `).get(name, since);
    const inputs = db.prepare(`
      SELECT
        CASE WHEN length(input_summary) > 120 THEN substr(input_summary, 1, 120) || '…'
             ELSE input_summary END as input,
        COUNT(*) as calls,
        COALESCE(SUM(result_length), 0) as bytes,
        MAX(ts) as lastTs
      FROM claude_tool_calls
      WHERE tool_name = ? AND ts >= ? AND input_summary != ''
      GROUP BY input_summary
      ORDER BY calls DESC
      LIMIT 30
    `).all(name, since);
    const recentSessions = db.prepare(`
      SELECT t.session_id, s.last_model, s.project_path, COUNT(*) as calls, MAX(t.ts) as lastTs
      FROM claude_tool_calls t
      LEFT JOIN claude_sessions s ON s.id = t.session_id
      WHERE t.tool_name = ? AND t.ts >= ?
      GROUP BY t.session_id
      ORDER BY lastTs DESC
      LIMIT 20
    `).all(name, since);
    return { tool: name, totals, inputs, recentSessions };
  });

  /**
   * Drill-down: invocations of a specific subagent (by subagent_type name).
   */
  app.get('/api/claude/heatmap/subagent', async (req: FastifyRequest<{ Querystring: { type?: string; range?: string } }>, reply) => {
    const type = req.query.type;
    if (!type) return reply.code(400).send({ error: 'type required' });
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));
    const totals = db.prepare(`
      SELECT COUNT(*) as calls, COUNT(DISTINCT session_id) as sessions
      FROM claude_tool_calls
      WHERE tool_name = 'Task' AND ts >= ?
        AND COALESCE(NULLIF(json_extract(input_summary, '$.subagent_type'), ''), 'general-purpose') = ?
    `).get(since, type);
    const invocations = db.prepare(`
      SELECT
        t.session_id,
        t.ts,
        COALESCE(json_extract(t.input_summary, '$.description'), '') as description,
        COALESCE(json_extract(t.input_summary, '$.prompt'), '') as prompt,
        s.last_model
      FROM claude_tool_calls t
      LEFT JOIN claude_sessions s ON s.id = t.session_id
      WHERE t.tool_name = 'Task' AND t.ts >= ?
        AND COALESCE(NULLIF(json_extract(t.input_summary, '$.subagent_type'), ''), 'general-purpose') = ?
      ORDER BY t.ts DESC
      LIMIT 50
    `).all(since, type);
    return { subagent: type, totals, invocations };
  });

  app.get('/api/claude/cache', async (req: FastifyRequest<{ Querystring: { range?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));
    // Aggregate cache totals from claude_sessions for sessions in window.
    const agg = db.prepare(`
      SELECT
        COALESCE(SUM(total_input_tokens), 0) as inp,
        COALESCE(SUM(total_output_tokens), 0) as out,
        COALESCE(SUM(total_cache_creation_tokens), 0) as cw,
        COALESCE(SUM(total_cache_read_tokens), 0) as cr,
        COALESCE(SUM(total_cost_usd), 0) as cost
      FROM claude_sessions
      WHERE started_at >= ?
    `).get(since) as { inp: number; out: number; cw: number; cr: number; cost: number };

    const total = (agg.inp ?? 0) + (agg.cw ?? 0) + (agg.cr ?? 0);
    const readRate = total > 0 ? agg.cr / total : 0;
    // Dollars saved estimate: cache_read tokens billed at ~10% of input;
    // savings vs charging them at input rate ≈ 0.9 × (cr / 1M) × inputRate.
    // Use Opus 4-7 input ($15/M) as a generous upper bound — the UI shows
    // this as an approximation.
    const dollarsSaved = ((agg.cr ?? 0) / 1_000_000) * 15 * 0.9;

    // Week-over-week reuse delta: current read-rate minus the prior equal-length
    // window's read-rate. Fractional (e.g. 0.06 → "+6%" in the UI). Zero for
    // 'all' (no prior period) or when there's no prior-window data to compare.
    const prior = priorWindow(rangeKey(req.query.range));
    let wowDelta = 0;
    if (prior.end > prior.start) {
      const pAgg = db.prepare(`
        SELECT
          COALESCE(SUM(total_input_tokens), 0) as inp,
          COALESCE(SUM(total_cache_creation_tokens), 0) as cw,
          COALESCE(SUM(total_cache_read_tokens), 0) as cr
        FROM claude_sessions
        WHERE started_at >= ? AND started_at < ?
      `).get(prior.start, prior.end) as { inp: number; cw: number; cr: number };
      const pTotal = (pAgg.inp ?? 0) + (pAgg.cw ?? 0) + (pAgg.cr ?? 0);
      if (pTotal > 0) wowDelta = readRate - pAgg.cr / pTotal;
    }

    return {
      readRate,
      creationTokens: agg.cw ?? 0,
      readTokens: agg.cr ?? 0,
      inputTokens: agg.inp ?? 0,
      outputTokens: agg.out ?? 0,
      totalCost: agg.cost ?? 0,
      dollarsSaved,
      wowDelta,
    };
  });

  app.get('/api/claude/costs', async (req: FastifyRequest<{ Querystring: { range?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));

    const total = db.prepare(`SELECT SUM(total_cost_usd) as t FROM claude_sessions WHERE started_at >= ?`).get(since) as { t: number };

    // Week-over-week spend delta: fractional change in total cost vs the prior
    // equal-length window (e.g. -0.08 → "-8%"). Zero for 'all' or no prior data.
    const prior = priorWindow(rangeKey(req.query.range));
    let wowDelta = 0;
    if (prior.end > prior.start) {
      const pTotal = db.prepare(
        `SELECT SUM(total_cost_usd) as t FROM claude_sessions WHERE started_at >= ? AND started_at < ?`,
      ).get(prior.start, prior.end) as { t: number };
      const pt = pTotal.t ?? 0;
      if (pt > 0) wowDelta = ((total.t ?? 0) - pt) / pt;
    }

    // Top prompts by cost.
    const topPrompts = db.prepare(`
      SELECT id, session_id, substr(text, 1, 200) as text, model, cost_usd,
             input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ts
      FROM claude_prompts
      WHERE ts >= ? AND cost_usd > 0
      ORDER BY cost_usd DESC
      LIMIT 50
    `).all(since);

    // Daily timeseries: bucket by 24h windows.
    const days = 30;
    const dayMs = 24 * 60 * 60 * 1000;
    const dayBoundary = Math.floor(Date.now() / dayMs) * dayMs - (days - 1) * dayMs;
    const series = db.prepare(`
      SELECT
        CAST((ts - ?) / ? AS INTEGER) as bucket,
        SUM(cost_usd) as cost,
        COUNT(*) as prompts
      FROM claude_prompts
      WHERE ts >= ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(dayBoundary, dayMs, dayBoundary) as Array<{ bucket: number; cost: number; prompts: number }>;
    // Densify with zeros for missing days.
    const dense: Array<{ day: number; cost: number; prompts: number }> = [];
    for (let i = 0; i < days; i++) {
      const found = series.find((s) => s.bucket === i);
      dense.push({ day: days - 1 - i, cost: found?.cost ?? 0, prompts: found?.prompts ?? 0 });
    }

    // By model.
    const byModel = db.prepare(`
      SELECT model, COUNT(*) as prompts, SUM(cost_usd) as cost
      FROM claude_prompts
      WHERE ts >= ? AND model IS NOT NULL
      GROUP BY model
      ORDER BY cost DESC
    `).all(since);

    return { total: total.t ?? 0, topPrompts, series: dense, byModel, wowDelta };
  });

  /**
   * GET /api/claude/stats?range= — the four dashboard stat tiles, each with a
   * value, a fractional week-over-week delta (vs the prior equal-length window)
   * and a 7-day sparkline series (oldest→newest). Drift is a live graph metric
   * with no history, so it returns value-only.
   */
  app.get('/api/claude/stats', async (req: FastifyRequest<{ Querystring: { range?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const rkey = rangeKey(req.query.range);
    const since = rangeStart(rkey);
    const prior = priorWindow(rkey);
    const dayMs = 24 * 60 * 60 * 1000;
    const d7Start = Math.floor(Date.now() / dayMs) * dayMs - 6 * dayMs;
    const dense7 = (rows: Array<{ bucket: number; v: number }>): number[] => {
      const a = [0, 0, 0, 0, 0, 0, 0];
      for (const r of rows) if (r.bucket >= 0 && r.bucket <= 6) a[r.bucket] = r.v;
      return a;
    };
    const countSince = (sql: string, ...p: unknown[]): number =>
      (db.prepare(sql).get(...p) as { c: number }).c ?? 0;

    // --- Tool calls ---
    const tcTotal = countSince(`SELECT COUNT(*) c FROM claude_tool_calls WHERE ts >= ?`, since);
    const tcPrior = prior.end > prior.start
      ? countSince(`SELECT COUNT(*) c FROM claude_tool_calls WHERE ts >= ? AND ts < ?`, prior.start, prior.end)
      : 0;
    const tcSeries = db.prepare(
      `SELECT CAST((ts - ?) / ? AS INTEGER) as bucket, COUNT(*) as v FROM claude_tool_calls WHERE ts >= ? GROUP BY bucket`,
    ).all(d7Start, dayMs, d7Start) as Array<{ bucket: number; v: number }>;
    const toolCalls = { value: tcTotal, delta: tcPrior > 0 ? (tcTotal - tcPrior) / tcPrior : 0, series: dense7(tcSeries) };

    // --- Subagent spend share (by cost) ---
    const subPctOf = (start: number, end: number | null): number => {
      const where = end == null ? `ts >= ?` : `ts >= ? AND ts < ?`;
      const args = end == null ? [start] : [start, end];
      const rows = db.prepare(
        `SELECT is_sidechain as side, COALESCE(SUM(cost_usd), 0) as cost FROM claude_prompts WHERE ${where} GROUP BY is_sidechain`,
      ).all(...args) as Array<{ side: number; cost: number }>;
      const sub = rows.find((r) => r.side === 1)?.cost ?? 0;
      const tot = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
      return tot > 0 ? sub / tot : 0;
    };
    const subPct = subPctOf(since, null);
    const subPctPrior = prior.end > prior.start ? subPctOf(prior.start, prior.end) : 0;
    const saDaily = db.prepare(`
      SELECT CAST((ts - ?) / ? AS INTEGER) as bucket,
             SUM(CASE WHEN is_sidechain = 1 THEN cost_usd ELSE 0 END) as sub,
             SUM(cost_usd) as tot
      FROM claude_prompts WHERE ts >= ? GROUP BY bucket
    `).all(d7Start, dayMs, d7Start) as Array<{ bucket: number; sub: number; tot: number }>;
    const saSeries = [0, 0, 0, 0, 0, 0, 0];
    for (const r of saDaily) if (r.bucket >= 0 && r.bucket <= 6) saSeries[r.bucket] = r.tot > 0 ? Math.round((r.sub / r.tot) * 100) : 0;
    const subagentPct = { value: Math.round(subPct * 100), delta: subPct - subPctPrior, series: saSeries };

    // --- Last session cost (delta vs previous session, spark of recent sessions) ---
    const recent = db.prepare(
      `SELECT total_cost_usd as cost FROM claude_sessions ORDER BY started_at DESC LIMIT 10`,
    ).all() as Array<{ cost: number }>;
    const lastCost = recent[0]?.cost ?? 0;
    const prevCost = recent[1]?.cost ?? 0;
    const lastSessionCost = {
      value: lastCost,
      delta: prevCost > 0 ? (lastCost - prevCost) / prevCost : 0,
      series: recent.map((r) => r.cost ?? 0).reverse(),
    };

    // --- Drift (live graph count, no time series) ---
    const driftCount = cg.getSpecQueries().getLinksByState(['drifted', 'broken', 'orphaned']).length;
    const drift = { value: driftCount, delta: 0, series: [] as number[] };

    return { lastSessionCost, toolCalls, subagentPct, drift };
  });

  app.get('/api/claude/compare', async (_req, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const rows = db.prepare(`
      SELECT
        p.path, p.name,
        COUNT(s.id) as sessions,
        COALESCE(SUM(s.total_cost_usd), 0) as cost,
        COALESCE(AVG(s.total_cost_usd), 0) as avgCost,
        COALESCE(SUM(s.prompt_count), 0) as prompts,
        CASE WHEN SUM(s.total_input_tokens + s.total_cache_creation_tokens + s.total_cache_read_tokens) > 0
             THEN CAST(SUM(s.total_cache_read_tokens) AS REAL) / SUM(s.total_input_tokens + s.total_cache_creation_tokens + s.total_cache_read_tokens)
             ELSE 0 END as cacheHit
      FROM claude_projects p
      LEFT JOIN claude_sessions s ON s.project_path = p.path
      GROUP BY p.path
      ORDER BY cost DESC
    `).all() as Array<Record<string, unknown> & { path: string }>;

    // Per-model cost split per project (drives the stacked bars).
    const modelRows = db.prepare(`
      SELECT s.project_path as path, p.model as model, COALESCE(SUM(p.cost_usd), 0) as cost
      FROM claude_prompts p
      JOIN claude_sessions s ON s.id = p.session_id
      WHERE p.model IS NOT NULL
      GROUP BY s.project_path, p.model
    `).all() as Array<{ path: string; model: string; cost: number }>;
    const byModelByPath = new Map<string, Array<{ model: string; cost: number }>>();
    for (const r of modelRows) {
      const arr = byModelByPath.get(r.path) ?? [];
      arr.push({ model: r.model, cost: r.cost });
      byModelByPath.set(r.path, arr);
    }

    // Top tools per project (top 4 by call count).
    const toolRows = db.prepare(`
      SELECT s.project_path as path, t.tool_name as name, COUNT(*) as calls
      FROM claude_tool_calls t
      JOIN claude_sessions s ON s.id = t.session_id
      GROUP BY s.project_path, t.tool_name
    `).all() as Array<{ path: string; name: string; calls: number }>;
    const toolsByPath = new Map<string, Array<{ name: string; calls: number }>>();
    for (const r of toolRows) {
      const arr = toolsByPath.get(r.path) ?? [];
      arr.push({ name: r.name, calls: r.calls });
      toolsByPath.set(r.path, arr);
    }

    // Drifted-link count is only knowable for the PRIMARY project's indexed
    // graph (compare rows are Claude-cost projects keyed by cwd; only one has a
    // spec graph loaded here). Attach the real count to the matching project
    // row and 0 to the rest, rather than fabricating per-project drift.
    const driftCount = cg.getSpecQueries().getLinksByState(['drifted', 'broken', 'orphaned']).length;
    const primaryRoot = (cg.getProjectRoot ? cg.getProjectRoot() : '').replace(/\/+$/, '');

    const projects = rows.map((p) => ({
      ...p,
      drift: p.path.replace(/\/+$/, '') === primaryRoot ? driftCount : 0,
      byModel: (byModelByPath.get(p.path) ?? []).sort((a, b) => b.cost - a.cost),
      topTools: (toolsByPath.get(p.path) ?? [])
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 4)
        .map((t) => t.name),
    }));
    return { projects };
  });

  /**
   * Rule-based tips engine. Each rule is a SQL query that finds a wasteful
   * pattern in the user's recent transcripts; the result is shaped into a
   * tip card matching the design system's voice.
   */
  app.get('/api/claude/tips', async (_req, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const tips: Array<Record<string, unknown>> = [];

    // Rule 1: "you read X N times" — same file path Read more than 10 times in
    // a single session.
    const wastefulReads = db.prepare(`
      SELECT session_id, input_summary as file, COUNT(*) as n
      FROM claude_tool_calls
      WHERE tool_name = 'Read' AND input_summary != ''
      GROUP BY session_id, input_summary
      HAVING n >= 10
      ORDER BY n DESC
      LIMIT 5
    `).all() as Array<{ session_id: string; file: string; n: number }>;
    for (const r of wastefulReads) {
      tips.push({
        id: 'wasteful_reads:' + r.session_id + ':' + r.file,
        severity: 'error',
        icon: 'wrench',
        title: `You read ${r.file.split('/').pop()} ${r.n}× in one session — specship_explore covers it`,
        why: 'Re-reading the same file burns input tokens every turn. A single structural query returns callers, callees, and linked specs at once.',
        evidence: { session: r.session_id, detail: `Read(${r.file}) × ${r.n}` },
        fix: `specship_explore --symbol ${r.file.replace(/\.\w+$/, '').split('/').pop()}`,
        saving: '≈$0.10/read avoided',
      });
    }

    // Rule 2: "tool returned X tokens" — any single tool call with result_length > 50000.
    const heavyResults = db.prepare(`
      SELECT id, session_id, tool_name, input_summary, result_length
      FROM claude_tool_calls
      WHERE result_length > 50000
      ORDER BY result_length DESC
      LIMIT 5
    `).all() as Array<{ id: number; session_id: string; tool_name: string; input_summary: string; result_length: number }>;
    for (const r of heavyResults) {
      tips.push({
        id: 'heavy_result:' + r.id,
        severity: 'error',
        icon: 'flame',
        title: `${r.tool_name} returned ${Math.round(r.result_length / 1000)}k tokens — try a structural query`,
        why: 'Tools that dump raw content into context are the dominant cost driver. A structural query returns just what the agent needs.',
        evidence: { session: r.session_id, detail: `${r.tool_name}(${r.input_summary.slice(0, 100)}) → ${r.result_length} tokens` },
        fix: r.tool_name === 'Bash' ? 'specship_search instead of Bash(grep)' : 'specship_explore on the symbol',
        saving: `~$${((r.result_length / 1_000_000) * 15).toFixed(2)} on this call`,
      });
    }

    // Rule 3: "cache miss rate" — sessions with > 10 prompts and cache_read_rate < 0.3.
    const lowCache = db.prepare(`
      SELECT s.id, s.total_cache_read_tokens as cr, s.total_input_tokens as ti, s.total_cache_creation_tokens as cw, s.prompt_count, s.last_model
      FROM claude_sessions s
      WHERE s.prompt_count >= 10
        AND (s.total_input_tokens + s.total_cache_creation_tokens + s.total_cache_read_tokens) > 0
      ORDER BY (CAST(s.total_cache_read_tokens AS REAL) / (s.total_input_tokens + s.total_cache_creation_tokens + s.total_cache_read_tokens)) ASC
      LIMIT 3
    `).all() as Array<{ id: string; cr: number; ti: number; cw: number; prompt_count: number; last_model: string }>;
    for (const r of lowCache) {
      const total = r.ti + r.cw + r.cr;
      const rate = total > 0 ? r.cr / total : 0;
      if (rate >= 0.3) continue;
      tips.push({
        id: 'low_cache:' + r.id,
        severity: 'warn',
        icon: 'database',
        title: `Cache read rate is ${Math.round(rate * 100)}% on a ${r.prompt_count}-prompt session`,
        why: 'When the prompt prefix changes every turn, the 1h cache gets invalidated. Pinning a stable system-prompt prefix lets the cache absorb most of your input.',
        evidence: { session: r.id, detail: `cache_read=${(r.cr / 1_000_000).toFixed(2)}M / total=${(total / 1_000_000).toFixed(2)}M` },
        fix: 'Pin a stable system-prompt prefix in .claude/settings.json',
        saving: '~$X.XX / session (model-dependent)',
      });
    }

    // Sort: errors before warns before info, then within bucket by saving heuristic.
    const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
    tips.sort((a, b) => (order[a.severity as string] ?? 9) - (order[b.severity as string] ?? 9));

    return { tips };
  });

  /**
   * GET /api/claude/specship-impact?range=&project=
   *
   * Aggregate SpecShip token-impact metrics: how many tokens specship calls
   * spent vs. how many tokens' worth of Read calls they displaced (saved),
   * with per-prompt dedup so a file referenced by two specship calls in the
   * same prompt counts only once. See packages/server/src/ingest/impact-query.ts
   * for the full algorithm.
   *
   * Query params:
   *   range   — 'today' | 'week' (default) | 'month' | 'all'
   *   project — project slug (decoded to path) or raw path; omit for all projects
   */
  app.get('/api/claude/specship-impact', async (req: FastifyRequest<{ Querystring: { range?: string; project?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));
    const project = req.query.project ? normalizeProjectFilter(req.query.project) : undefined;
    return computeSpecshipImpact(db, { since, project });
  });

  /**
   * Force a one-shot ingest pass. Useful for "Refresh" button in the UI.
   */
  app.post('/api/claude/ingest', async () => {
    const watcher = app.watcher;
    if (!watcher) return { ok: false, error: 'watcher not running' };
    const stats = watcher.ingestNow();
    return { ok: true, stats };
  });
}
