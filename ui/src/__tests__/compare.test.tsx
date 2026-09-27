/**
 * REQ-DESKTOP-024 — Compare projects: A1 the comparison table, most-efficient
 * callout and cost-by-model stacks render from live (mocked) data, A2 the
 * project toggle chips narrow the rendered rows, A3 a backend with nothing
 * ingested renders the Settings-ingest guidance.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparePage } from '../pages/compare';

const OPUS = 'claude-opus-4-7';
const HAIKU = 'claude-haiku-4-5';

const COMPARE = {
  projects: [
    {
      path: '/Users/dev/specship', name: 'specship', sessions: 24, cost: 120, avgCost: 5, prompts: 300,
      cacheHit: 0.82, drift: 2, byModel: [{ model: OPUS, cost: 80 }, { model: HAIKU, cost: 40 }],
      topTools: ['Read', 'Edit', 'Bash', 'specship_explore'],
    },
    {
      path: '/Users/dev/other', name: 'other', sessions: 6, cost: 30, avgCost: 5, prompts: 60,
      // drift null: no indexed spec graph for a non-primary project, so its
      // drift is unmeasured — never 0 (REQ-REVINT-007.A3).
      cacheHit: 0.44, drift: null, byModel: [{ model: OPUS, cost: 30 }],
      topTools: ['Read'],
    },
  ],
};

const STATS_LIVE = {
  lastSessionCost: { value: 1, delta: 0, series: [] }, toolCalls: { value: 5, delta: 0, series: [] },
  subagentPct: { value: 10, delta: 0, series: [] }, drift: { value: 0, delta: 0, series: [] }, sessionCount: 12,
};
const STATS_ZERO = { ...STATS_LIVE, sessionCount: 0 };

function mockFetch(stats: unknown, compare: unknown = COMPARE): void {
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0] ?? url;
    if (path === '/api/claude/stats') return ok(stats);
    if (path === '/api/claude/compare') return ok(compare);
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
  }));
}

beforeEach(() => {
  history.replaceState(null, '', '/compare');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ComparePage (REQ-DESKTOP-024)', () => {
  it('A1: table rows, most-efficient callout and model stacks render live values', async () => {
    mockFetch(STATS_LIVE);
    render(<ComparePage project={null} query={{}} />);

    await screen.findByText(/Most efficient/);
    // specship wins on cache hit: callout cites its numbers.
    expect(screen.getByText(/82% cache hit/)).toBeTruthy();
    // Table columns ('$120' also totals specship's stacked bar).
    expect(screen.getAllByText('$120').length).toBeGreaterThan(0);
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('44%')).toBeTruthy();
    expect(screen.getByText('specship_explore')).toBeTruthy();
    // Stacked bars card with the model legend.
    expect(screen.getByText('Cost by model per project')).toBeTruthy();
    expect(screen.getAllByText('opus-4-7').length).toBeGreaterThan(0);
  });

  it('A2: toggling a project chip removes its row', async () => {
    mockFetch(STATS_LIVE);
    render(<ComparePage project={null} query={{}} />);
    await screen.findByText('44%');

    fireEvent.click(screen.getByRole('button', { name: 'other' }));
    expect(screen.queryByText('44%')).toBeNull();
    expect(screen.getByText('82%')).toBeTruthy();

    // Toggling back restores it.
    fireEvent.click(screen.getByRole('button', { name: 'other' }));
    expect(screen.getByText('44%')).toBeTruthy();
  });

  it('REQ-REVINT-007.A3: an unmeasured project shows — for drift, not 0', async () => {
    mockFetch(STATS_LIVE);
    render(<ComparePage project={null} query={{}} />);

    await screen.findByText('44%');
    // The 'other' row's drift cell.
    expect(screen.getByTitle(/Not measured/)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('REQ-REVINT-007.A3: the callout says "not measured", never "no drifted links"', async () => {
    // Make the unmeasured project the most efficient one so it drives the prose.
    mockFetch(STATS_LIVE, {
      projects: [
        { ...COMPARE.projects[0]!, cacheHit: 0.1, avgCost: 9 },
        { ...COMPARE.projects[1]!, cacheHit: 0.95, avgCost: 1 },
      ],
    });
    render(<ComparePage project={null} query={{}} />);

    await screen.findByText(/Most efficient/);
    expect(screen.getByText(/drift not measured for this project/)).toBeTruthy();
    expect(screen.queryByText(/no drifted links/)).toBeNull();
  });

  it('A3: zero ingested sessions renders Settings-ingest guidance', async () => {
    mockFetch(STATS_ZERO, { projects: [] });
    render(<ComparePage project={null} query={{}} />);

    await screen.findByText('No Claude Code data ingested yet');
    expect(screen.getByText(/Settings/)).toBeTruthy();
    expect(screen.queryByText(/Most efficient/)).toBeNull();
  });
});
