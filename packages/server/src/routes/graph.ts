/**
 * Graph routes — node detail + explore + search.
 *
 * These are thin wrappers around methods on a SpecShip instance. Every
 * route resolves the active instance via `app.activeCg(req)`, which honors
 * `?project=<slug>` and falls back to the boot-time primary. When neither
 * is available, returns 409 / `no_project` so the desktop UI can show its
 * project picker instead of an opaque 500.
 *
 * The MCP layer's `specship_*` tools are markdown-formatted for agents;
 * here we return raw JSON so the UI can render visually.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';

interface ProjectQuery { project?: string }

interface ExploreBody {
  query: string;
  maxFiles?: number;
}

interface NodeQuery extends ProjectQuery {
  symbol?: string;
  id?: string;
  file?: string;
  line?: string;
}

interface SearchQuery extends ProjectQuery {
  q?: string;
  kind?: string;
  limit?: string;
}

interface NodesQuery extends ProjectQuery {
  kind?: string;
  file?: string;
  limit?: string;
  offset?: string;
}

/** Returns the active SpecShip or sends a 409. */
async function resolveCg(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<SpecShipInstance | null> {
  const cg = await app.activeCg(req);
  if (!cg) { reply.code(409).send({ error: 'no project selected', code: 'no_project' }); return null; }
  return cg;
}

type DbHandle = { prepare: (s: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown } };

/** Dig the raw SQLite handle off a SpecShip instance (same shape as routes/claude.ts). */
function getDb(cg: SpecShipInstance): DbHandle {
  const anyCg = cg as unknown as { db?: { getDb?: () => unknown }; queries?: { db?: unknown } };
  if (anyCg.db?.getDb) return anyCg.db.getDb() as DbHandle;
  if (anyCg.queries?.db) return anyCg.queries.db as DbHandle;
  throw new Error('specship DB handle not accessible from server context');
}

export async function registerGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/graph/stats', async (req: FastifyRequest<{ Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    return cg.getStats();
  });

  /**
   * List nodes with optional kind / file / limit filtering. For node-explorer
   * UI surfaces that want a flat paginated list.
   */
  app.get('/api/graph/nodes', async (req: FastifyRequest<{ Querystring: NodesQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);
    const results = cg.searchNodes(req.query.kind ?? '', { limit: limit + offset });
    return {
      total: results.length,
      offset,
      limit,
      nodes: results.slice(offset, offset + limit).map((r) => r.node),
    };
  });

  /**
   * GET /api/graph/node — by symbol name (with optional file/line disambiguation)
   * or by exact id. Returns the node + callers + callees + linked specs.
   */
  app.get('/api/graph/node', async (req: FastifyRequest<{ Querystring: NodeQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { symbol, id, file, line } = req.query;
    if (!symbol && !id) {
      return reply.code(400).send({ error: 'symbol or id is required' });
    }
    type Match = { id: string; name: string; kind: string; filePath: string; startLine: number; endLine: number; signature?: string; docstring?: string };
    let matches: Match[] = [];
    if (id) {
      const node = cg.getNode(id);
      if (node) matches = [node as Match];
    } else if (symbol) {
      matches = cg.searchNodes(symbol, { limit: 50 }).map((r) => r.node as Match);
      if (file) {
        const f = file.toLowerCase();
        const narrowed = matches.filter((n) => n.filePath.toLowerCase().includes(f));
        if (narrowed.length > 0) matches = narrowed;
      }
      if (line) {
        const ln = parseInt(line, 10);
        if (Number.isFinite(ln)) {
          const containing = matches.filter((n) => n.startLine <= ln && (n.endLine ?? n.startLine) >= ln);
          matches = containing.length > 0 ? containing : matches.slice(0, 1);
        }
      }
    }

    if (matches.length === 0) return reply.code(404).send({ error: 'not found' });

    const enriched = matches.map((n) => {
      const callers = cg.getCallers(n.id).map((e) => e.node);
      const callees = cg.getCallees(n.id).map((e) => e.node);
      const links = cg.getSpecQueries().getLinksByNode(n.id);
      return { ...n, callers, callees, linkedSpecs: links };
    });

    return { matches: enriched };
  });

  app.post('/api/graph/explore', async (req: FastifyRequest<{ Body: ExploreBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { query, maxFiles } = req.body ?? { query: '' };
    if (!query) return reply.code(400).send({ error: 'query is required' });
    void maxFiles;
    const ctx = await cg.buildContext(query, {
      maxNodes: 80,
      includeCode: true,
      format: 'markdown',
    });
    return ctx;
  });

  app.get('/api/graph/search', async (req: FastifyRequest<{ Querystring: SearchQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const q = req.query.q ?? '';
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 200);
    if (!q) return { results: [] };
    const kinds = req.query.kind ? [req.query.kind as never] : undefined;
    const results = cg.searchNodes(q, { kinds, limit });
    return { results };
  });

  app.get('/api/graph/callers/:id', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const node = cg.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: 'node not found' });
    return { callers: cg.getCallers(req.params.id).map((e) => e.node) };
  });

  app.get('/api/graph/callees/:id', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const node = cg.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: 'node not found' });
    return { callees: cg.getCallees(req.params.id).map((e) => e.node) };
  });

  app.get('/api/graph/impact/:id', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery & { depth?: string } }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const depth = Math.min(parseInt(req.query.depth ?? '2', 10) || 2, 5);
    return { impact: cg.getImpactRadius(req.params.id, depth) };
  });

  app.get('/api/graph/files', async (req: FastifyRequest<{ Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    return { files: cg.getFiles() };
  });

  /**
   * GET /api/graph/health — feeds the Graph overview panel:
   *   - linkHealth: spec-link counts per state (verified/drifted/broken/orphaned/…)
   *   - edgeKinds:  edge counts grouped into calls / implements-documents / tests
   *   - hubs:       the most-connected nodes (by total degree), for the "Most connected" list
   */
  app.get('/api/graph/health', async (req: FastifyRequest<{ Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;

    // Spec-link health — count by state off the spec_links table.
    const linkHealth: Record<string, number> = {};
    for (const l of cg.getSpecQueries().getAllLinks()) {
      linkHealth[l.state] = (linkHealth[l.state] ?? 0) + 1;
    }

    const db = getDb(cg);

    // Edge kinds — bucket by the node kinds the edge connects, mirroring the
    // design's "calls / implements / tests" legend. spec endpoints → implements,
    // test endpoints → tests, everything else → calls.
    const edgeKinds = db.prepare(`
      SELECT
        CASE
          WHEN ns.kind = 'spec' OR nt.kind = 'spec' THEN 'implements'
          WHEN ns.kind = 'test' OR nt.kind = 'test' THEN 'tests'
          ELSE 'calls'
        END as bucket,
        COUNT(*) as count
      FROM edges e
      JOIN nodes ns ON ns.id = e.source
      JOIN nodes nt ON nt.id = e.target
      GROUP BY bucket
    `).all() as Array<{ bucket: string; count: number }>;
    const edgeKindMap: Record<string, number> = { calls: 0, implements: 0, tests: 0 };
    for (const r of edgeKinds) edgeKindMap[r.bucket] = r.count;

    // Synthesized (heuristic) edge count — dashed in the legend.
    const synth = db.prepare(
      `SELECT COUNT(*) as c FROM edges WHERE provenance = 'heuristic'`,
    ).get() as { c: number };
    edgeKindMap['synth'] = synth.c ?? 0;

    // Most-connected hubs — total degree (in + out) per node, top 8.
    const hubs = db.prepare(`
      SELECT n.id, n.name, n.kind, n.file_path as filePath, deg.degree
      FROM (
        SELECT node, COUNT(*) as degree FROM (
          SELECT source as node FROM edges
          UNION ALL
          SELECT target as node FROM edges
        ) GROUP BY node ORDER BY degree DESC LIMIT 8
      ) deg
      JOIN nodes n ON n.id = deg.node
      ORDER BY deg.degree DESC
    `).all() as Array<{ id: string; name: string; kind: string; filePath: string; degree: number }>;

    return { linkHealth, edgeKinds: edgeKindMap, hubs };
  });
}
