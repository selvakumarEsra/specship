/**
 * REQ-DESKTOP-024 — Tips: A1 severity-ordered tip cards render from live
 * (mocked) data with evidence / impact / fix, A4 Apply and Dismiss POST the
 * state and update the SIDEBAR BADGE in the same reload (the tips state is
 * lifted into App), A3 a zero-session backend renders the Settings-ingest
 * guidance. Rendered through the full App so the badge wiring is real.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
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

const STATS_LIVE = {
  lastSessionCost: { value: 1, delta: 0, series: [] }, toolCalls: { value: 5, delta: 0, series: [] },
  subagentPct: { value: 10, delta: 0, series: [] }, drift: { value: 0, delta: 0, series: [] }, sessionCount: 12,
};

const APP_ROUTES: Record<string, unknown> = {
  '/api/status': {
    projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
    nodeCount: 100, edgeCount: 200, fileCount: 30, drift: 0, lastIndexed: null,
    nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
  },
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/workflows/runs': { runs: [] },
  '/api/drift': { links: [] },
  '/api/claude/stats': STATS_LIVE,
};

interface Recorded { url: string; body: unknown }

/**
 * Stateful fetch mock (dashboard.test.tsx's shape): POSTs to
 * /api/claude/tips/state mutate the served tips list the way the server's
 * claude_tip_state does — dismissed rows disappear, applied ones annotate.
 */
function mockFetch(tips: ClaudeTip[], routes: Record<string, unknown> = APP_ROUTES): Recorded[] {
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

/** The sidebar's Tips nav entry — where the A4 badge renders. */
function tipsNavLink(): HTMLElement {
  const link = document.querySelector('a[href="/tips"]');
  if (!link) throw new Error('tips nav link not found');
  return link as HTMLElement;
}

beforeEach(() => {
  history.replaceState(null, '', '/tips');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TipsPage via App (REQ-DESKTOP-024)', () => {
  it('A1: tip cards render with severity, evidence, impact and fix', async () => {
    mockFetch([TIP]);
    render(<App />);

    await screen.findByText(TIP.title);
    expect(screen.getByText('1 urgent')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('Evidence')).toBeTruthy();
    expect(screen.getByText('s1')).toBeTruthy();
    expect(screen.getByText(TIP.fix)).toBeTruthy();
    expect(screen.getByText(TIP.saving)).toBeTruthy();
  });

  it('A4: Dismiss POSTs the state, removes the card AND clears the sidebar badge', async () => {
    const posts = mockFetch([TIP]);
    render(<App />);
    await screen.findByText(TIP.title);

    // Badge counts the one actionable tip.
    expect(within(tipsNavLink()).getByText('1')).toBeTruthy();

    fireEvent.click(screen.getByText('Dismiss'));
    await screen.findByText(/No tips/);
    expect(posts).toContainEqual({ url: '/api/claude/tips/state', body: { id: TIP.id, state: 'dismissed' } });
    expect(screen.queryByText(TIP.title)).toBeNull();
    expect(within(tipsNavLink()).queryByText('1')).toBeNull();
  });

  it('A4: Apply POSTs the state, marks the card applied and clears the badge', async () => {
    const posts = mockFetch([TIP]);
    render(<App />);
    await screen.findByText(TIP.title);

    fireEvent.click(screen.getByText('Apply'));
    expect(await screen.findByText('Applied')).toBeTruthy();
    expect(posts).toContainEqual({ url: '/api/claude/tips/state', body: { id: TIP.id, state: 'applied' } });
    // Applied tips stay visible but no longer count as actionable.
    expect(screen.getByText(TIP.title)).toBeTruthy();
    expect(within(tipsNavLink()).queryByText('1')).toBeNull();
  });

  it('A3: zero ingested sessions renders Settings-ingest guidance', async () => {
    mockFetch([], { ...APP_ROUTES, '/api/claude/stats': { ...STATS_LIVE, sessionCount: 0 } });
    render(<App />);

    await screen.findByText('No Claude Code data ingested yet');
    expect(screen.getByText(/Settings ingest toggle|transcript ingest in Settings/)).toBeTruthy();
  });
});
