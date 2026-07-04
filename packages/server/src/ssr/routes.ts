/**
 * SSR page routes (DASH-LEAN-DOC / REQ-DASHLEAN-004 + 005) — serves the
 * "SpecShip Desktop" design (imported 2026-07-04, see specs/lean-dashboard/)
 * rendered server-side in the same process as `/api/*`.
 *
 * Each screen's markup comes from the design's own captured DOM
 * (./templates/content-*.html via design.mjs), so pages are pixel-true by
 * construction; live data is bound into the design markup (badges, project
 * path, KPI values) — bindings deepen screen-by-screen. Data flows through
 * `app.inject()` (in-process request to the API handlers), no HTTP round-trip.
 *
 * Registered BEFORE the static fallback so explicit page routes win.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function registerSsrRoutes(app: FastifyInstance): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Server-local ESM modules shipped verbatim by the build (untyped by design).
  // @ts-expect-error -- untyped server-local module
  const D: any = await import('./design.mjs');
  // @ts-expect-error -- untyped server-local module
  const R: any = await import('./render.mjs');
  // @ts-expect-error -- untyped server-local module
  const B: any = await import('./bindings.mjs');
  const PUB = join(here, 'public');

  const inject = async (url: string): Promise<Record<string, any>> => {
    const res = await app.inject({ method: 'GET', url });
    try { return res.json(); } catch { return {}; }
  };

  // --- static assets (no extra dependency) ---
  const assets: Record<string, [string, string]> = {
    '/app.css': ['app.css', 'text/css; charset=utf-8'],
    '/islands.js': ['islands.js', 'text/javascript; charset=utf-8'],
    '/islands/graph.js': [join('islands', 'graph.js'), 'text/javascript; charset=utf-8'],
  };
  for (const [route, spec] of Object.entries(assets)) {
    const [file, type] = spec;
    app.get(route, async (_req, reply) => reply.header('content-type', type).send(readFileSync(join(PUB, file))));
  }

  /** Shared per-request chrome data: badges + project path. */
  const chrome = async () => {
    const empty: Record<string, any> = {};
    const [status, drift, runs, reflect] = await Promise.all([
      inject('/api/status').catch(() => empty),
      inject('/api/drift').catch(() => empty),
      inject('/api/workflows/runs').catch(() => empty),
      inject('/api/reflect').catch(() => empty),
    ]);
    const driftN = (drift['links'] ?? []).filter((l: any) => ['drifted', 'broken', 'orphaned'].includes(l.state)).length;
    const ago = (() => {
      const t = status['lastIndexed'] ? Date.parse(status['lastIndexed']) : null;
      if (!t) return null;
      const m = Math.max(0, Math.round((Date.now() - t) / 60000));
      return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
    })();
    return {
      projectPath: String(status['projectPath'] ?? '').replace(/^\/Users\/[^/]+/, '~'),
      badges: {
        drift: driftN,
        runs: (runs['runs'] ?? []).length,
        tips: (reflect['proposals'] ?? []).length,
      },
      strip: { nodes: status['nodeCount'], edges: status['edgeCount'], drift: driftN, indexedAgo: ago },
      status,
    };
  };

  const sendScreen = async (reply: FastifyReply, route: string, title: string, bind?: (html: string) => Promise<string> | string) => {
    const c = await chrome();
    let content = D.screenContent(route) as string;
    if (bind) content = await bind(content);
    reply.header('content-type', 'text/html; charset=utf-8').send(
      D.designLayout({ route, title, content, badges: c.badges, projectPath: c.projectPath, strip: c.strip }),
    );
  };

  app.get('/', async (_req, reply) => reply.redirect('/dashboard'));

  // Design screens — pixel-true markup; data bindings deepen per screen.
  const SCREENS: Array<[string, string, ((html: string) => Promise<string>)?]> = [
    ['dashboard', 'Dashboard', async (html) => {
      // Bind headline KPIs into the design tiles (sample → live).
      const [stats, drift, status] = await Promise.all([
        inject('/api/claude/stats'), inject('/api/drift'), inject('/api/status'),
      ]);
      const cost = stats['lastSessionCost']?.value;
      if (cost != null) html = html.replace(/\$11\.84/g, '$' + Number(cost).toFixed(2));
      const tc = stats['toolCalls']?.value;
      if (tc != null) html = html.replace('>451<', '>' + Number(tc).toLocaleString() + '<');
      const nodes = status['nodeCount'];
      if (nodes != null) html = html.replace(/4,218 nodes/g, Number(nodes).toLocaleString() + ' nodes');
      const driftN = (drift['links'] ?? []).filter((l: any) => ['drifted', 'broken', 'orphaned'].includes(l.state)).length;
      html = html.replace(/>7</, '>' + driftN + '<');
      // panels: tips, recent prompts, cache rate, subagent %, mini-graph labels
      const [reflect, costs, sessions, topNodes] = await Promise.all([
        inject('/api/reflect').catch(() => ({} as Record<string, any>)),
        inject('/api/claude/costs').catch(() => ({} as Record<string, any>)),
        inject('/api/claude/sessions').catch(() => ({} as Record<string, any>)),
        inject('/api/graph/nodes?limit=9&sort=degree').catch(() => ({} as Record<string, any>)),
      ]);
      const sess = sessions['sessions'] ?? [];
      const inTok = sess.reduce((a: number, s: any) => a + (s.total_input_tokens ?? 0), 0);
      const cacheTok = sess.reduce((a: number, s: any) => a + (s.total_cache_read_tokens ?? 0), 0);
      html = B.bindDashboardExtras(html, {
        subagentPct: stats['subagentPct']?.value ?? stats['subagentPct'],
        tips: reflect['proposals'],
        prompts: costs['topPrompts'],
        cacheRate: inTok + cacheTok ? cacheTok / (inTok + cacheTok) : null,
        graphNames: (topNodes['nodes'] ?? []).map((n: any) => n.name).filter(Boolean),
      });
      return html;
    }],
    ['graph', 'Graph', async (html) => {
      const [nodesResp, specsResp] = await Promise.all([
        inject('/api/graph/nodes?limit=20&sort=degree').catch(() => ({} as Record<string, any>)),
        inject('/api/specs').catch(() => ({} as Record<string, any>)),
      ]);
      const names = (nodesResp['nodes'] ?? []).map((n: any) => n.name).filter(Boolean);
      const specIds = (specsResp['specs'] ?? []).filter((s: any) => s.kind === 'requirement').map((s: any) => s.id);
      return B.bindGraphCanvas(html, names, specIds);
    }],
    ['specs', 'Specs', async (html) => {
      const specsResp = await inject('/api/specs');
      // Detail panel binds the first REQUIREMENT (documents have no acceptance children).
      const first = (specsResp['specs'] ?? []).find((s: any) => s.kind === 'requirement');
      const det = first ? await inject(`/api/spec/${encodeURIComponent(first.id)}`).catch(() => null) : null;
      return B.bindSpecs(html, specsResp, det);
    }],
    ['drift', 'Drift queue', async (html) => B.bindDrift(html, (await inject('/api/drift'))['links'])],
    ['runs', 'Runs', async (html) => B.bindRuns(html, (await inject('/api/workflows/runs'))['runs'])],
    ['sessions', 'Sessions', async (html) => B.bindSessions(html, (await inject('/api/claude/sessions'))['sessions'])],
    ['heatmap', 'Heatmap', async (html) => B.bindHeatmap(html, (await inject('/api/claude/heatmap'))['files'])],
    ['costs', 'Costs', async (html) => B.bindCosts(html, await inject('/api/claude/costs'))],
    ['compare', 'Compare projects', async (html) => B.bindCompare(html, (await inject('/api/claude/compare'))['projects'])],
    ['memory', 'Memory', async (html) => B.bindMemory(html, await inject('/api/memory'))],
    ['mcp', 'MCP'],
    ['tips', 'Tips', async (html) => B.bindTips(html, (await inject('/api/reflect'))['proposals'])],
    ['design-system', 'Design system'], ['settings', 'Settings'],
  ];
  for (const [route, title, bind] of SCREENS) {
    app.get('/' + route, async (_req, reply) => sendScreen(reply, route, title, bind));
  }

  // Detail routes — live data, previous renderer (design pass pending).
  const detail = async (reply: FastifyReply, title: string, active: string, body: string) => {
    const c = await chrome();
    reply.header('content-type', 'text/html; charset=utf-8').send(
      D.designLayout({ route: active, title, content: `<div class="scroll-y" style="flex:1;min-height:0;padding:22px">${body}</div>`, badges: c.badges, projectPath: c.projectPath }),
    );
  };
  app.get('/specs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await detail(reply, 'Spec', 'specs', R.renderSpecDetail(await inject(`/api/spec/${encodeURIComponent(id)}`)));
  });
  app.get('/runs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await detail(reply, 'Run', 'runs', R.renderRunDetail(await inject(`/api/workflows/runs/${encodeURIComponent(id)}`)));
  });
  app.get('/sessions/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await detail(reply, 'Session', 'sessions', R.renderSessionDetail(await inject(`/api/claude/session/${encodeURIComponent(id)}`)));
  });

  // Legacy read-only routes kept from the pre-design pass (not in the design
  // nav, still data-true): improvements, maintainability, domain, specship-impact.
  app.get('/improvements', async (_req, reply) => detail(reply, 'Improvements', 'tips', R.renderImprovements(await inject('/api/reflect'))));
  app.get('/maintainability', async (_req, reply) => detail(reply, 'Maintainability', 'dashboard', R.renderMaintainability(await inject('/api/maintainability'))));
  app.get('/domain', async (_req, reply) => detail(reply, 'Domain', 'dashboard', R.renderDomain(await inject('/api/domain'))));
  app.get('/specship-impact', async (_req, reply) => detail(reply, 'SpecShip impact', 'costs', R.renderImpact(await inject('/api/claude/specship-impact'))));
}
