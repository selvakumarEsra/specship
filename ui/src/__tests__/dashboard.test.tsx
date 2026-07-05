/**
 * REQ-DESKTOP-020 — the dashboard renders the snapshot's module grid from
 * live (mocked) endpoints: A1 every module shows live values (none blank),
 * A2 tip Apply/Dismiss POSTs state and re-renders, A3 cross-links navigate
 * to Graph/Heatmap, A4 a zero-session backend renders enable-ingest
 * guidance instead of zeros.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../pages/dashboard';
import type { ClaudeTip } from '../api';

const TIP: ClaudeTip = {
  id: 'wasteful_reads:s1:src/index.ts',
  severity: 'error',
  icon: 'wrench',
  title: 'You read index.ts 17× in one session — specship_explore covers it',
  why: 'Re-reading burns tokens.',
  evidence: { session: 's1', detail: 'Read(src/index.ts) × 17' },
  fix: 'specship_explore --symbol index',
  saving: '≈$0.10/read avoided',
};

const LIVE_ROUTES: Record<string, unknown> = {
  '/api/status': {
    projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
    nodeCount: 4218, edgeCount: 9000, fileCount: 300, drift: 7, lastIndexed: null,
    nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
  },
  '/api/claude/stats': {
    lastSessionCost: { value: 11.84, delta: 0.12, series: [5, 6, 7, 8, 11.84] },
    toolCalls: { value: 451, delta: -0.08, series: [40, 52, 38, 61, 44, 57, 49] },
    subagentPct: { value: 31, delta: 0.04, series: [22, 26, 24, 30, 28, 33, 31] },
    drift: { value: 7, delta: 0, series: [] },
    sessionCount: 12,
  },
  '/api/claude/costs': {
    total: 42.5, wowDelta: -0.08, series: [], byModel: [],
    topPrompts: [
      { id: 'p1', session_id: 'sess-1', text: 'Refactor the link-verify pass', model: 'claude-opus-4-7', cost_usd: 1.42, is_sidechain: 0, input_tokens: 1000, output_tokens: 500, cache_creation_tokens: 200, cache_read_tokens: 46500, ts: 1750000002000 },
      { id: 'p2', session_id: 'sess-2', text: 'Trace the ingest watcher', model: 'claude-opus-4-7', cost_usd: 0.62, is_sidechain: 1, input_tokens: 900, output_tokens: 200, cache_creation_tokens: 100, cache_read_tokens: 19300, ts: 1750000001000 },
    ],
  },
  '/api/claude/cache': {
    readRate: 0.78, creationTokens: 1200000, readTokens: 8400000, inputTokens: 400000,
    outputTokens: 90000, totalCost: 40, dollarsSaved: 113, wowDelta: 0.06,
  },
  '/api/claude/heatmap': {
    files: [
      { path: '/Users/dev/specship/src/mcp/tools.ts', calls: 42, resultBytes: 800000, trend: [0, 0, 0, 0, 0, 0, 42] },
      { path: '/Users/dev/specship/src/index.ts', calls: 17, resultBytes: 120000, trend: [0, 0, 0, 0, 0, 0, 17] },
    ],
    tools: [], subagents: [], subagentByName: [],
  },
  '/api/graph/full': {
    nodes: [
      { id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts', degree: 9 },
      { id: 'n2', name: 'SpecShip', kind: 'class', filePath: 'src/index.ts', degree: 8 },
      { id: 'n3', name: 'ingestNow', kind: 'function', filePath: 'src/sync/watcher.ts', degree: 2 },
    ],
    edges: [{ from: 'n1', to: 'n2', kind: 'calls', provenance: 'static' }],
    total: 3, shown: 3,
  },
};

const ZERO_ROUTES: Record<string, unknown> = {
  '/api/status': LIVE_ROUTES['/api/status'],
  '/api/claude/stats': {
    lastSessionCost: { value: 0, delta: 0, series: [] },
    toolCalls: { value: 0, delta: 0, series: [] },
    subagentPct: { value: 0, delta: 0, series: [] },
    drift: { value: 7, delta: 0, series: [] },
    sessionCount: 0,
  },
  '/api/claude/costs': { total: 0, wowDelta: 0, series: [], byModel: [], topPrompts: [] },
  '/api/claude/cache': { readRate: 0, creationTokens: 0, readTokens: 0, inputTokens: 0, outputTokens: 0, totalCost: 0, dollarsSaved: 0, wowDelta: 0 },
  '/api/claude/heatmap': { files: [], tools: [], subagents: [], subagentByName: [] },
  '/api/graph/full': LIVE_ROUTES['/api/graph/full'],
};

interface Recorded { url: string; body: unknown }

/**
 * Stateful fetch mock: GETs serve `routes` (+ a mutable tips list), POSTs to
 * /api/claude/tips/state mutate that list the way the real server's
 * claude_tip_state does — dismissed rows disappear, applied ones annotate.
 */
function mockFetch(routes: Record<string, unknown>, tips: ClaudeTip[]): Recorded[] {
  const posts: Recorded[] = [];
  let tipsBody = { tips };
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url;
    if (init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) as { id: string; state: string } : undefined;
      posts.push({ url: path, body });
      if (path === '/api/claude/tips/state' && body) {
        tipsBody = body.state === 'dismissed'
          ? { tips: tipsBody.tips.filter((t) => t.id !== body.id) }
          : { tips: tipsBody.tips.map((t) => (t.id === body.id ? { ...t, state: 'applied' as const } : t)) };
      }
      return ok({ ok: true });
    }
    if (path === '/api/claude/tips') return ok(tipsBody);
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return ok(body);
  }));
  return posts;
}

beforeEach(() => {
  history.replaceState(null, '', '/dashboard');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DashboardPage (REQ-DESKTOP-020)', () => {
  it('A1: every module renders live values in the snapshot arrangement — none blank', async () => {
    mockFetch(LIVE_ROUTES, [TIP]);
    render(<DashboardPage project={null} query={{}} />);

    // Stat tiles.
    await screen.findByText('$11.84');
    expect(screen.getByText('451')).toBeTruthy();
    expect(screen.getByText('31%')).toBeTruthy();
    expect(screen.getByText('Drift queue')).toBeTruthy();
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);

    // Recent neighborhood renders live graph nodes.
    expect(screen.getByText('Recent neighborhood')).toBeTruthy();
    await screen.findByText('toolsHandler');

    // Tips rail with the live tip and its urgency pill.
    expect(screen.getByText(TIP.title)).toBeTruthy();
    expect(screen.getByText('1 urgent')).toBeTruthy();

    // Heatstrip treemap cells from live heatmap files.
    expect(screen.getByText('Tool-call heatmap')).toBeTruthy();
    await screen.findByText('mcp/tools.ts');

    // Recent prompts with per-prompt cost, cache analytics with read rate.
    expect(screen.getByText('Refactor the link-verify pass')).toBeTruthy();
    expect(screen.getByText('$1.42')).toBeTruthy();
    expect(screen.getByText('Cache analytics')).toBeTruthy();
    expect(screen.getByText('78%')).toBeTruthy();
    expect(screen.getByText('$113')).toBeTruthy();
  });

  it('A2: Apply POSTs the state and re-renders the tip as applied', async () => {
    const posts = mockFetch(LIVE_ROUTES, [TIP]);
    render(<DashboardPage project={null} query={{}} />);
    await screen.findByText(TIP.title);

    fireEvent.click(screen.getByText('Apply'));
    expect(await screen.findByText('Applied')).toBeTruthy();
    expect(posts).toContainEqual({ url: '/api/claude/tips/state', body: { id: TIP.id, state: 'applied' } });
    // Applied tips are no longer urgent.
    expect(screen.queryByText('1 urgent')).toBeNull();
  });

  it('A2: Dismiss POSTs the state and removes the tip from the rail', async () => {
    const posts = mockFetch(LIVE_ROUTES, [TIP]);
    render(<DashboardPage project={null} query={{}} />);
    await screen.findByText(TIP.title);

    fireEvent.click(screen.getByTitle('Dismiss'));
    expect(await screen.findByText(/No tips/)).toBeTruthy();
    expect(posts).toContainEqual({ url: '/api/claude/tips/state', body: { id: TIP.id, state: 'dismissed' } });
    expect(screen.queryByText(TIP.title)).toBeNull();
  });

  it('A3: Open graph and Open heatmap cross-links navigate to their screens', async () => {
    mockFetch(LIVE_ROUTES, [TIP]);
    render(<DashboardPage project={null} query={{}} />);
    await screen.findByText('Recent neighborhood');

    fireEvent.click(screen.getByText('Open graph'));
    expect(location.pathname).toBe('/graph');

    fireEvent.click(screen.getByText('Open heatmap'));
    expect(location.pathname).toBe('/heatmap');
  });

  it('A4: zero ingested sessions renders enable-ingest guidance, not zeros', async () => {
    mockFetch(ZERO_ROUTES, []);
    render(<DashboardPage project={null} query={{}} />);

    // The transcript-fed modules point at ingest instead of showing $0.
    expect((await screen.findAllByText('No Claude Code data ingested yet')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('no transcript data — enable ingest').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('$0')).toBeNull();

    // The drift tile stays live — it's a graph metric, not transcript-fed.
    expect(screen.getByText('Drift queue')).toBeTruthy();
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
  });
});
