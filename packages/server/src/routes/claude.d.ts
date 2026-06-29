/**
 * Claude Code analytics routes.
 *
 * All queries hit specship's SQLite directly. The ingest worker
 * (`@specship/specship-ingest`) writes to claude_* tables; this layer
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
import type { FastifyInstance } from 'fastify';
export declare function registerClaudeRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=claude.d.ts.map