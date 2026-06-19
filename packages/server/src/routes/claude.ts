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
 *   POST /api/claude/ingest                  — force a one-shot ingest pass
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';

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
      params.push(req.query.project);
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
    `).all(req.params.id);
    const toolCalls = db.prepare(`
      SELECT * FROM claude_tool_calls WHERE session_id = ? ORDER BY ts ASC
    `).all(req.params.id);
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

    return {
      readRate,
      creationTokens: agg.cw ?? 0,
      readTokens: agg.cr ?? 0,
      inputTokens: agg.inp ?? 0,
      outputTokens: agg.out ?? 0,
      totalCost: agg.cost ?? 0,
      dollarsSaved,
      // wowDelta would need historical snapshotting; placeholder until we
      // add a rolling-window aggregate table. UI shows 0% with no arrow.
      wowDelta: 0,
    };
  });

  app.get('/api/claude/costs', async (req: FastifyRequest<{ Querystring: { range?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const db = getDb(cg);
    const since = rangeStart(rangeKey(req.query.range));

    const total = db.prepare(`SELECT SUM(total_cost_usd) as t FROM claude_sessions WHERE started_at >= ?`).get(since) as { t: number };

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

    return { total: total.t ?? 0, topPrompts, series: dense, byModel };
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
    `).all();
    return { projects: rows };
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
   * Force a one-shot ingest pass. Useful for "Refresh" button in the UI.
   */
  app.post('/api/claude/ingest', async () => {
    const watcher = app.watcher;
    if (!watcher) return { ok: false, error: 'watcher not running' };
    const stats = watcher.ingestNow();
    return { ok: true, stats };
  });
}
