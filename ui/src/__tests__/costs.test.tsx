/**
 * REQ-DESKTOP-024 — Costs: A1 the spend line, by-model donut, expensive
 * prompts and cache card render from live (mocked) data, A2 the model filter
 * narrows every card server-side, A3 a zero-session backend renders the
 * Settings-ingest guidance instead of $0 charts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CostsPage } from '../pages/costs';

const OPUS = 'claude-opus-4-7';
const HAIKU = 'claude-haiku-4-5';

const PROMPTS = [
  { id: 'p1', session_id: 'sess-1', text: 'Refactor the link-verify pass', model: OPUS, cost_usd: 1.42, is_sidechain: 0, input_tokens: 1000, output_tokens: 500, cache_creation_tokens: 200, cache_read_tokens: 46500, ts: 2000 },
  { id: 'p2', session_id: 'sess-2', text: 'Trace the ingest watcher', model: HAIKU, cost_usd: 0.62, is_sidechain: 1, input_tokens: 900, output_tokens: 200, cache_creation_tokens: 100, cache_read_tokens: 19300, ts: 1000 },
];

const BY_MODEL = [
  { model: OPUS, prompts: 10, cost: 30 },
  { model: HAIKU, prompts: 5, cost: 12.5 },
];

const SERIES = [
  { day: 4, cost: 8, prompts: 12 }, { day: 3, cost: 6, prompts: 9 }, { day: 2, cost: 10, prompts: 14 },
  { day: 1, cost: 9, prompts: 11 }, { day: 0, cost: 9.5, prompts: 13 },
];

const CACHE = {
  readRate: 0.78, creationTokens: 1200000, readTokens: 8400000, inputTokens: 400000,
  outputTokens: 90000, totalCost: 40, dollarsSaved: 113, wowDelta: 0.06,
};

const STATS_LIVE = {
  lastSessionCost: { value: 1, delta: 0, series: [] }, toolCalls: { value: 5, delta: 0, series: [] },
  subagentPct: { value: 10, delta: 0, series: [] }, drift: { value: 0, delta: 0, series: [] }, sessionCount: 12,
};
const STATS_ZERO = { ...STATS_LIVE, sessionCount: 0 };

/** GET mock that narrows /api/claude/costs by its model query param. */
function mockFetch(stats: unknown): string[] {
  const gets: string[] = [];
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    gets.push(url);
    const u = new URL(url, 'http://local');
    const path = u.pathname;
    if (path === '/api/claude/stats') return ok(stats);
    if (path === '/api/claude/cache') return ok(CACHE);
    if (path === '/api/claude/costs') {
      const model = u.searchParams.get('model');
      const topPrompts = model ? PROMPTS.filter((p) => p.model === model) : PROMPTS;
      const byModel = model ? BY_MODEL.filter((m) => m.model === model) : BY_MODEL;
      const total = model ? byModel.reduce((a, m) => a + m.cost, 0) : 42.5;
      return ok({ total, topPrompts, series: SERIES, byModel, wowDelta: -0.08 });
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
  }));
  return gets;
}

beforeEach(() => {
  history.replaceState(null, '', '/costs');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CostsPage (REQ-DESKTOP-024)', () => {
  it('A1: total, by-model breakdown, top prompts and cache card render live values', async () => {
    mockFetch(STATS_LIVE);
    render(<CostsPage project={null} query={{}} />);

    await screen.findByText('$42.50');
    expect(screen.getByText('By model')).toBeTruthy();
    // Legend rows use the shortened model ids.
    expect(screen.getAllByText('opus-4-7').length).toBeGreaterThan(0);
    expect(screen.getByText('$30.0')).toBeTruthy();
    expect(screen.getByText('Most expensive prompts')).toBeTruthy();
    expect(screen.getByText('Refactor the link-verify pass')).toBeTruthy();
    expect(screen.getByText('$1.42')).toBeTruthy();
    // Cache analytics card (claudeCache-fed).
    expect(screen.getByText('Cache analytics')).toBeTruthy();
    expect(screen.getByText('78%')).toBeTruthy();
  });

  it('A2: the model filter narrows the cards and rides the request', async () => {
    const gets = mockFetch(STATS_LIVE);
    render(<CostsPage project={null} query={{}} />);
    await screen.findByText('$42.50');

    fireEvent.change(screen.getByLabelText('Model filter'), { target: { value: HAIKU } });
    await screen.findByText('$12.50');
    expect(screen.queryByText('Refactor the link-verify pass')).toBeNull();
    expect(screen.getByText('Trace the ingest watcher')).toBeTruthy();
    expect(gets.some((u) => u.includes('model=' + encodeURIComponent(HAIKU)))).toBe(true);
  });

  it('A3: zero ingested sessions renders Settings-ingest guidance, not zeros', async () => {
    mockFetch(STATS_ZERO);
    render(<CostsPage project={null} query={{}} />);

    await screen.findByText('No Claude Code data ingested yet');
    expect(screen.getByText(/Settings/)).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('Most expensive prompts')).toBeNull();
  });
});
