/**
 * SSR page routes (DASH-LEAN-DOC / REQ-DASHLEAN-004) folded into the server.
 *
 * These render the read-only dashboard server-side in the SAME process that
 * serves `/api/*` — data comes from `app.inject()` (an in-process request to
 * the existing API handlers), so there is no HTTP round-trip and no
 * cross-origin concern. The render functions live in `./render.mjs`, a
 * server-local ESM module shipped verbatim by `build-server-bundle.mjs` (it is
 * plain JS emitting HTML strings, so it is intentionally NOT tsc-compiled —
 * keeping the dashboard dependency-free per REQ-DASHLEAN-002).
 *
 * Registered BEFORE the SPA/static fallback so the explicit page routes win.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function registerSsrRoutes(app: FastifyInstance): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Server-local ESM module, copied next to this file by the build. No type
  // declarations — it renders HTML strings from API-shaped data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // @ts-expect-error -- untyped server-local module
  const R: any = await import('./render.mjs');
  const PUB = join(here, 'public');

  const inject = async (url: string): Promise<Record<string, unknown>> => {
    const res = await app.inject({ method: 'GET', url });
    try { return res.json(); } catch { return {}; }
  };
  const send = (reply: FastifyReply, title: string, active: string, body: string): FastifyReply =>
    reply.header('content-type', 'text/html; charset=utf-8').send(R['layout']({ title, activeHref: active, body }));

  // --- static assets (served by hand — no extra dependency) ---
  const assets: Record<string, [string, string]> = {
    '/app.css': ['app.css', 'text/css; charset=utf-8'],
    '/islands.js': ['islands.js', 'text/javascript; charset=utf-8'],
    '/islands/graph.js': [join('islands', 'graph.js'), 'text/javascript; charset=utf-8'],
  };
  for (const [route, spec] of Object.entries(assets)) {
    const [file, type] = spec;
    app.get(route, async (_req, reply) => reply.header('content-type', type).send(readFileSync(join(PUB, file))));
  }

  // --- pages ---
  const page = (route: string, title: string, fn: () => Promise<string>): void => {
    app.get(route, async (_req, reply) => {
      let body: string;
      try {
        body = await fn();
      } catch (e) {
        body = `<div class="page-head"><h1>${title}</h1></div><p class="muted">Couldn't load data: ${e instanceof Error ? e.message : String(e)}</p>`;
      }
      send(reply, title, route, body);
    });
  };

  app.get('/', async (_req, reply) => reply.redirect('/dashboard'));
  page('/dashboard', 'Dashboard', async () => R['renderDashboard'](await inject('/api/status'), await inject('/api/claude/stats')));
  app.get('/specs', async (_req, reply) => send(reply, 'Specs', '/specs', R['renderSpecs']((await inject('/api/specs'))['specs'] ?? [])));
  app.get('/specs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    send(reply, 'Spec', '/specs', R['renderSpecDetail'](await inject(`/api/spec/${encodeURIComponent(id)}`)));
  });
  page('/drift', 'Drift', async () => R['renderDrift'](await inject('/api/drift')));
  page('/maintainability', 'Maintainability', async () => R['renderMaintainability'](await inject('/api/maintainability')));
  page('/domain', 'Domain', async () => R['renderDomain'](await inject('/api/domain')));
  page('/memory', 'Memory', async () => R['renderMemory'](await inject('/api/memory')));
  page('/improvements', 'Improvements', async () => R['renderImprovements'](await inject('/api/reflect')));
  page('/compare', 'Compare', async () => R['renderCompare'](await inject('/api/claude/compare')));
  page('/costs', 'Costs', async () => R['renderCosts'](await inject('/api/claude/costs')));
  page('/specship-impact', 'SpecShip impact', async () => R['renderImpact'](await inject('/api/claude/specship-impact')));
  page('/runs', 'Runs', async () => R['renderRuns'](await inject('/api/workflows/runs')));
  app.get('/runs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    send(reply, 'Run', '/runs', R['renderRunDetail'](await inject(`/api/workflows/runs/${encodeURIComponent(id)}`)));
  });
  page('/sessions', 'Sessions', async () => R['renderSessions'](await inject('/api/claude/sessions')));
  app.get('/sessions/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    send(reply, 'Session', '/sessions', R['renderSessionDetail'](await inject(`/api/claude/session/${encodeURIComponent(id)}`)));
  });
  page('/mcp', 'MCP', async () => R['renderMcp']((await inject('/api/mcp/servers'))['servers']));
  page('/graph', 'Graph', async () => R['renderGraph'](await inject('/api/graph/full?limit=250')));
  page('/heatmap', 'Heatmap', async () => R['renderHeatmap'](await inject('/api/claude/heatmap')));
}
