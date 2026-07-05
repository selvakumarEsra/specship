/**
 * REQ-DESKTOP-024 — Sessions: A1 the list and per-session detail render from
 * live (mocked) ingested data, A2 the project and model filters narrow the
 * rows server-side, A3 a zero-session backend renders the Settings-ingest
 * guidance instead of zeros.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionsPage } from '../pages/sessions';

const OPUS = 'claude-opus-4-7';
const HAIKU = 'claude-haiku-4-5';

const SESSIONS = [
  {
    id: 'sess-aaaa1111', project_path: '/Users/dev/specship', started_at: 1750000000000, ended_at: 1750003600000,
    prompt_count: 12, total_input_tokens: 1000, total_output_tokens: 400, total_cache_creation_tokens: 500,
    total_cache_read_tokens: 8500, total_cost_usd: 12.4, last_model: OPUS,
  },
  {
    id: 'sess-bbbb2222', project_path: '/Users/dev/other', started_at: 1750000100000, ended_at: 1750001100000,
    prompt_count: 3, total_input_tokens: 900, total_output_tokens: 100, total_cache_creation_tokens: 50,
    total_cache_read_tokens: 50, total_cost_usd: 3.1, last_model: HAIKU,
  },
];

const DETAIL = {
  session: SESSIONS[0],
  prompts: [
    {
      id: 'p1', session_id: 'sess-aaaa1111', text: 'Implement REQ-INGEST-004: incremental jsonl tailing over the watcher pipeline',
      ts: 1750000000000, model: OPUS, input_tokens: 800, output_tokens: 300, cache_creation_tokens: 100,
      cache_read_tokens: 5000, cost_usd: 1.42, is_sidechain: 0, durationMs: 60000,
    },
    {
      id: 'p2', session_id: 'sess-aaaa1111', text: 'grep for every call site of parseTranscript',
      ts: 1750000600000, model: OPUS, input_tokens: 900, output_tokens: 100, cache_creation_tokens: 0,
      cache_read_tokens: 100, cost_usd: 3.1, is_sidechain: 1, durationMs: 30000,
    },
  ],
  toolCalls: [
    { prompt_id: 'p2', session_id: 'sess-aaaa1111', tool_name: 'Bash', input_summary: 'grep -rn parseTranscript', result_length: 82000, ts: 1750000601000 },
  ],
};

const SUMMARY = {
  sessionId: 'sess-aaaa1111',
  byTool: [
    { name: 'Bash', calls: 1, totalBytes: 82000 },
    { name: 'Read', calls: 4, totalBytes: 52000 },
  ],
  byModel: [{ model: OPUS, prompts: 12, cost: 12.4 }],
  slashCommands: [{ name: '/specship:spec', count: 1 }],
  skills: [{ name: 'spec-implement', count: 2 }],
  filesTouched: [{ path: '/Users/dev/specship/src/index.ts', ops: 3, lastOp: 'Edit' }],
  durationMs: 3600000,
  specship: { spendTokens: 0, savedTokens: 0, netTokens: 0 },
};

const STATS_LIVE = {
  lastSessionCost: { value: 12.4, delta: 0, series: [] }, toolCalls: { value: 5, delta: 0, series: [] },
  subagentPct: { value: 10, delta: 0, series: [] }, drift: { value: 0, delta: 0, series: [] }, sessionCount: 12,
};
const STATS_ZERO = { ...STATS_LIVE, sessionCount: 0 };

/** GET mock that narrows /api/claude/sessions by its query params. */
function mockFetch(stats: unknown): string[] {
  const gets: string[] = [];
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    gets.push(url);
    const u = new URL(url, 'http://local');
    const path = u.pathname;
    if (path === '/api/claude/stats') return ok(stats);
    if (path === '/api/claude/projects') {
      return ok({ projects: [
        { path: '/Users/dev/specship', name: 'specship', sessions: 12, cost: 100, prompts: 200 },
        { path: '/Users/dev/other', name: 'other', sessions: 3, cost: 10, prompts: 30 },
      ] });
    }
    if (path === '/api/claude/sessions') {
      const model = u.searchParams.get('model');
      const project = u.searchParams.get('project');
      let rows = SESSIONS;
      if (model) rows = rows.filter((s) => s.last_model === model);
      if (project) rows = rows.filter((s) => s.project_path === project);
      return ok({ sessions: rows });
    }
    if (path === '/api/claude/session/sess-aaaa1111') return ok(DETAIL);
    if (path === '/api/claude/session/sess-aaaa1111/summary') return ok(SUMMARY);
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
  }));
  return gets;
}

beforeEach(() => {
  history.replaceState(null, '', '/sessions');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SessionsPage (REQ-DESKTOP-024)', () => {
  it('A1: renders the sessions table from live data', async () => {
    mockFetch(STATS_LIVE);
    render(<SessionsPage project={null} query={{}} />);

    await screen.findByText('sess-aaa');
    expect(screen.getByText('sess-bbb')).toBeTruthy();
    expect(screen.getByText('$12.40')).toBeTruthy();
    // Cache rate 8500 / (1000 + 500 + 8500) = 85%.
    expect(screen.getByText('85%')).toBeTruthy();
    // Project pill in the row (the filter <option> matches too).
    expect(screen.getAllByText('specship').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2 sessions · across all projects')).toBeTruthy();
  });

  it('A2: the model filter narrows the rows and rides the request', async () => {
    const gets = mockFetch(STATS_LIVE);
    render(<SessionsPage project={null} query={{}} />);
    await screen.findByText('sess-aaa');

    fireEvent.change(screen.getByLabelText('Model filter'), { target: { value: HAIKU } });
    await screen.findByText('1 sessions · across all projects');
    expect(screen.queryByText('sess-aaa')).toBeNull();
    expect(screen.getByText('sess-bbb')).toBeTruthy();
    expect(gets.some((u) => u.includes('model=' + encodeURIComponent(HAIKU)))).toBe(true);
  });

  it('A2: the project filter narrows the rows and rides the request', async () => {
    const gets = mockFetch(STATS_LIVE);
    render(<SessionsPage project={null} query={{}} />);
    await screen.findByText('sess-aaa');

    fireEvent.change(screen.getByLabelText('Project filter'), { target: { value: '/Users/dev/specship' } });
    await screen.findByText('1 sessions · specship');
    expect(screen.queryByText('sess-bbb')).toBeNull();
    expect(screen.getByText('sess-aaa')).toBeTruthy();
    expect(gets.some((u) => u.includes('project=' + encodeURIComponent('/Users/dev/specship')))).toBe(true);
  });

  it('A1: clicking a row opens the session detail with prompts and quality signals', async () => {
    mockFetch(STATS_LIVE);
    render(<SessionsPage project={null} query={{}} />);
    await screen.findByText('sess-aaa');

    fireEvent.click(screen.getByText('sess-aaa'));
    await screen.findByText('Prompt timeline · 2');
    expect(screen.getByText(/Implement REQ-INGEST-004/)).toBeTruthy();
    expect(screen.getByText('subagent')).toBeTruthy();
    expect(screen.getByText('Cache effectiveness')).toBeTruthy();
    expect(screen.getByText('Avg prompt quality')).toBeTruthy();
    // Summary-fed rail sections.
    await screen.findByText('/specship:spec');
    expect(screen.getByText('spec-implement')).toBeTruthy();
    expect(screen.getByText('Tools used · 2')).toBeTruthy();
    expect(screen.getByText('Files touched · 1')).toBeTruthy();

    // Back returns to the list.
    fireEvent.click(screen.getByText('Sessions', { selector: 'button' }));
    await screen.findByText('sess-bbb');
  });

  it('deep-links straight into the session named by ?sel=', async () => {
    mockFetch(STATS_LIVE);
    render(<SessionsPage project={null} query={{ sel: 'sess-aaaa1111' }} />);
    await screen.findByText('Prompt timeline · 2');
  });

  it('A3: zero ingested sessions renders Settings-ingest guidance, not zeros', async () => {
    mockFetch(STATS_ZERO);
    render(<SessionsPage project={null} query={{}} />);

    await screen.findByText('No Claude Code data ingested yet');
    expect(screen.getByText(/Settings/)).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('sess-aaa')).toBeNull();
  });
});
