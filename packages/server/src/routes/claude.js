"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClaudeRoutes = registerClaudeRoutes;
const RANGE_WINDOW_MS = {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    all: Number.MAX_SAFE_INTEGER,
};
function rangeKey(input) {
    if (input === 'today' || input === 'week' || input === 'month' || input === 'all')
        return input;
    return 'week';
}
function rangeStart(key) {
    if (key === 'all')
        return 0;
    return Date.now() - RANGE_WINDOW_MS[key];
}
/**
 * Get the internal SQLite handle off the DatabaseConnection so we can run
 * Claude-specific aggregate queries directly. SpecShip exposes this via
 * `getDb()`-style accessors. Falls back to digging via the queries property.
 */
function getDb(cg) {
    // SpecShip exposes the underlying DB via its DatabaseConnection. Look it
    // up via the private field as a fallback — works because it's the same
    // shape regardless of which adapter (better-sqlite3 / node:sqlite) is active.
    const anyCg = cg;
    if (anyCg.db?.getDb)
        return anyCg.db.getDb();
    if (anyCg.queries?.db)
        return anyCg.queries.db;
    throw new Error('specship DB handle not accessible from server context');
}
async function registerClaudeRoutes(app) {
    app.get('/api/claude/projects', async () => {
        const db = getDb(app.cg);
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
    `).all();
        return { projects: rows };
    });
    app.get('/api/claude/sessions', async (req) => {
        const db = getDb(app.cg);
        const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
        const since = rangeStart(rangeKey(req.query.range));
        const params = [since];
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
    app.get('/api/claude/session/:id', async (req, reply) => {
        const db = getDb(app.cg);
        const session = db.prepare('SELECT * FROM claude_sessions WHERE id = ?').get(req.params.id);
        if (!session)
            return reply.code(404).send({ error: 'session not found' });
        const prompts = db.prepare(`
      SELECT * FROM claude_prompts WHERE session_id = ? ORDER BY ts ASC
    `).all(req.params.id);
        const toolCalls = db.prepare(`
      SELECT * FROM claude_tool_calls WHERE session_id = ? ORDER BY ts ASC
    `).all(req.params.id);
        return { session, prompts, toolCalls };
    });
    app.get('/api/claude/heatmap', async (req) => {
        const db = getDb(app.cg);
        const since = rangeStart(rangeKey(req.query.range));
        // Files heatmap — input_summary doubles as the file path for Read/Edit/Write.
        const files = db.prepare(`
      SELECT input_summary as path, COUNT(*) as calls, SUM(result_length) as resultBytes
      FROM claude_tool_calls
      WHERE ts >= ? AND tool_name IN ('Read','Edit','Write','NotebookEdit') AND input_summary != ''
      GROUP BY input_summary
      ORDER BY calls DESC
      LIMIT 100
    `).all(since);
        // Tools heatmap.
        const tools = db.prepare(`
      SELECT tool_name as name, COUNT(*) as calls, SUM(result_length) as resultBytes
      FROM claude_tool_calls
      WHERE ts >= ?
      GROUP BY tool_name
      ORDER BY calls DESC
    `).all(since);
        // Subagent attribution (is_sidechain at the prompt level).
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
        return { files, tools, subagents };
    });
    app.get('/api/claude/costs', async (req) => {
        const db = getDb(app.cg);
        const since = rangeStart(rangeKey(req.query.range));
        const total = db.prepare(`SELECT SUM(total_cost_usd) as t FROM claude_sessions WHERE started_at >= ?`).get(since);
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
    `).all(dayBoundary, dayMs, dayBoundary);
        // Densify with zeros for missing days.
        const dense = [];
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
    app.get('/api/claude/compare', async () => {
        const db = getDb(app.cg);
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
    app.get('/api/claude/tips', async () => {
        const db = getDb(app.cg);
        const tips = [];
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
    `).all();
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
    `).all();
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
    `).all();
        for (const r of lowCache) {
            const total = r.ti + r.cw + r.cr;
            const rate = total > 0 ? r.cr / total : 0;
            if (rate >= 0.3)
                continue;
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
        const order = { error: 0, warn: 1, info: 2 };
        tips.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
        return { tips };
    });
    /**
     * Force a one-shot ingest pass. Useful for "Refresh" button in the UI.
     */
    app.post('/api/claude/ingest', async () => {
        const watcher = app.watcher;
        if (!watcher)
            return { ok: false, error: 'watcher not running' };
        const stats = watcher.ingestNow();
        return { ok: true, stats };
    });
}
//# sourceMappingURL=claude.js.map