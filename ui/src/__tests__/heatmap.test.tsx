/**
 * REQ-DESKTOP-024 — Heatmap: A1 the files treemap, ranked tools and subagent
 * attribution render from live (mocked) data, drill-down rails fetch the
 * /api/claude/heatmap/* endpoints, A3 a zero-session backend renders the
 * Settings-ingest guidance instead of zero-valued charts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeatmapPage } from '../pages/heatmap';

const HEATMAP = {
  files: [
    { path: '/Users/dev/specship/src/mcp/tools.ts', calls: 42, resultBytes: 800000, trend: [0, 0, 0, 0, 0, 0, 42] },
    { path: '/Users/dev/specship/src/index.ts', calls: 17, resultBytes: 120000, trend: [0, 0, 0, 0, 0, 0, 17] },
  ],
  tools: [
    { name: 'Read', calls: 120, resultBytes: 900000 },
    { name: 'Bash', calls: 33, resultBytes: 400000 },
  ],
  subagents: [{ type: 'subagent', prompts: 5, tokens: 40000, cost: 2 }],
  subagentByName: [{ name: 'general-purpose', calls: 5, firstSeen: 1, lastSeen: 2 }],
};

const TOOL_DETAIL = {
  tool: 'Read',
  totals: { calls: 120, bytes: 900000, sessions: 3 },
  inputs: [{ input: 'src/index.ts', calls: 40, bytes: 500000, lastTs: 1 }],
  recentSessions: [{ session_id: 'sess-aaaa1111', last_model: 'claude-opus-4-7', project_path: '/x', calls: 12, lastTs: 1 }],
};

const FILE_DETAIL = {
  path: '/Users/dev/specship/src/mcp/tools.ts',
  sessions: [{ session_id: 'sess-aaaa1111', last_model: 'claude-opus-4-7', project_path: '/x', calls: 30, bytes: 700000, lastTs: 2, firstTs: 1 }],
  byTool: [{ name: 'Read', calls: 30, bytes: 700000 }, { name: 'Edit', calls: 12, bytes: 100000 }],
};

const STATS_LIVE = {
  lastSessionCost: { value: 1, delta: 0, series: [] }, toolCalls: { value: 153, delta: 0, series: [] },
  subagentPct: { value: 10, delta: 0, series: [] }, drift: { value: 0, delta: 0, series: [] }, sessionCount: 12,
};
const STATS_ZERO = { ...STATS_LIVE, sessionCount: 0 };

function mockFetch(stats: unknown, heatmap: unknown = HEATMAP): string[] {
  const gets: string[] = [];
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    gets.push(url);
    const path = url.split('?')[0] ?? url;
    if (path === '/api/claude/stats') return ok(stats);
    if (path === '/api/claude/heatmap') return ok(heatmap);
    if (path === '/api/claude/heatmap/tool') return ok(TOOL_DETAIL);
    if (path === '/api/claude/heatmap/file') return ok(FILE_DETAIL);
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
  }));
  return gets;
}

beforeEach(() => {
  history.replaceState(null, '', '/heatmap');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HeatmapPage (REQ-DESKTOP-024)', () => {
  it('A1: summary cards, files treemap, tools and subagents render live values', async () => {
    mockFetch(STATS_LIVE);
    render(<HeatmapPage project={null} query={{}} />);

    // Summary row: total calls 120 + 33.
    await screen.findByText('153');
    expect(screen.getByText('Busiest file')).toBeTruthy();
    expect(screen.getByText('Heaviest tool')).toBeTruthy();
    // Treemap cells (labels are the last two path segments).
    expect(screen.getAllByText('mcp/tools.ts').length).toBeGreaterThan(0);
    // Ranked tools with call counts ('Read' also names the heaviest-tool card).
    expect(screen.getAllByText('Read').length).toBeGreaterThan(0);
    expect(screen.getByText('×120')).toBeTruthy();
    // Subagent attribution.
    expect(screen.getByText('general-purpose')).toBeTruthy();
  });

  it('drills into a tool via /api/claude/heatmap/tool', async () => {
    const gets = mockFetch(STATS_LIVE);
    render(<HeatmapPage project={null} query={{}} />);
    // '×120' is unique to Read's ranked-tools row; the click bubbles to it.
    await screen.findByText('×120');

    fireEvent.click(screen.getByText('×120'));
    await screen.findByText('Top inputs');
    expect(screen.getByText('avg per call')).toBeTruthy();
    // The rail's input row ('src/index.ts' also labels a treemap cell).
    expect(screen.getByText('×40')).toBeTruthy();
    expect(gets.some((u) => u.startsWith('/api/claude/heatmap/tool?name=Read'))).toBe(true);

    // Close the rail.
    fireEvent.click(screen.getByLabelText('Close drill-down'));
    expect(screen.queryByText('Top inputs')).toBeNull();
  });

  it('drills into a file via /api/claude/heatmap/file', async () => {
    const gets = mockFetch(STATS_LIVE);
    render(<HeatmapPage project={null} query={{}} />);
    await screen.findByText('153');

    fireEvent.click(screen.getAllByText('mcp/tools.ts')[1]!); // the treemap cell (index 0 is the summary card)
    await screen.findByText('Tool breakdown');
    expect(gets.some((u) => u.startsWith('/api/claude/heatmap/file?path='))).toBe(true);
    expect(screen.getByText(/Touched in 1 session/)).toBeTruthy();
  });

  it('A3: zero ingested sessions renders Settings-ingest guidance, not zeros', async () => {
    mockFetch(STATS_ZERO);
    render(<HeatmapPage project={null} query={{}} />);

    await screen.findByText('No Claude Code data ingested yet');
    expect(screen.getByText(/Settings/)).toBeTruthy();
    expect(screen.queryByText('153')).toBeNull();
    expect(screen.queryByText('Busiest file')).toBeNull();
  });
});
