/**
 * REQ-DESKTOP-023 — the Runs screen lists live executions with status pills
 * (A1); opening one shows node progression, per-node cost, the event stream,
 * and run totals (A1); Approve/Reject call the engine on a gate-paused run
 * (A2); running runs expose Cancel; a failed run surfaces its error and an
 * empty history renders the explicit empty state (A3).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsPage } from '../pages/runs';

const NOW = Date.now();

const DEFINITION = {
  workflow: {
    name: 'spec-fix',
    description: 'Fix a drifted spec link.',
    inputs: [],
    nodes: [
      { id: 'plan', kind: 'prompt' },
      { id: 'gate', kind: 'approval', depends_on: ['plan'] },
      { id: 'verify', kind: 'bash', depends_on: ['gate'] },
    ],
  },
  scope: 'bundled',
  sourcePath: 'bundled:spec-fix.yaml',
};

const PAUSED_RUN = {
  id: 'r1',
  workflowName: 'spec-fix',
  status: 'paused',
  inputs: { SPEC_ID: 'REQ-A-2' },
  startedAt: NOW - 120_000,
  lastActivityAt: NOW - 10_000,
  createdAt: NOW - 120_000,
  metadata: {
    nodeStates: { plan: 'completed' },
    approval: { type: 'approval', nodeId: 'gate', message: 'Review the diff before merge' },
  },
};

const EVENTS = [
  { id: 1, workflowRunId: 'r1', eventType: 'run_started', data: {}, createdAt: NOW - 120_000 },
  { id: 2, workflowRunId: 'r1', eventType: 'step_started', data: { stepId: 'plan', stepKind: 'prompt' }, createdAt: NOW - 119_000 },
  { id: 3, workflowRunId: 'r1', eventType: 'tool_called', data: { stepId: 'plan', name: 'Read', input: 'src/auth.ts' }, createdAt: NOW - 100_000 },
  {
    id: 4, workflowRunId: 'r1', eventType: 'step_completed',
    data: { stepId: 'plan', stats: { costUsd: 0.41, durationMs: 90_000, model: 'claude-sonnet-5' } },
    createdAt: NOW - 30_000,
  },
  { id: 5, workflowRunId: 'r1', eventType: 'approval_requested', data: { nodeId: 'gate', message: 'Review the diff before merge' }, createdAt: NOW - 10_000 },
];

interface Call { url: string; method: string; body?: unknown }

function mockFetch(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const u = new URL(url, 'http://local');
    const body = routes[method + ' ' + u.pathname] ?? routes[u.pathname];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + method + ' ' + u.pathname }) };
    }
    return { ok: true, json: async () => body };
  }));
  return calls;
}

function detailRoutes(run: Record<string, unknown>, events: unknown[] = EVENTS): Record<string, unknown> {
  return {
    '/api/workflows': { workflows: [DEFINITION], errors: [] },
    '/api/workflows/runs/r1': { run, events },
    '/api/workflows/runs/r1/artifacts': {
      artifacts: [{ nodeId: 'plan', name: 'plan.md', kind: 'prompt', outputType: 'plan', length: 20, body: '## Plan: fix the link' }],
    },
  };
}

beforeEach(() => {
  history.replaceState(null, '', '/runs');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RunsPage list (REQ-DESKTOP-023.A1/A3)', () => {
  it('lists runs with status pills and model/cost columns; row click opens the detail', async () => {
    mockFetch({
      '/api/workflows/runs': {
        runs: [
          { id: 'r1', workflowName: 'spec-fix', status: 'completed', startedAt: NOW - 300_000, completedAt: NOW - 100_000, lastActivityAt: NOW - 100_000, createdAt: NOW - 300_000, totalCostUsd: 2.29, model: 'claude-sonnet-5' },
          { id: 'r2', workflowName: 'quick-check', status: 'running', startedAt: NOW - 20_000, lastActivityAt: NOW - 1_000, createdAt: NOW - 20_000, totalCostUsd: null, model: null },
        ],
      },
    });
    render(<RunsPage project={null} query={{}} />);

    await screen.findByText('spec-fix');
    // The segmented filter also says Completed/Running — anchor to the pills.
    expect(screen.getByText('Completed', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('Running', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('$2.29')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy();

    fireEvent.click(screen.getByText('spec-fix'));
    expect(location.pathname).toBe('/runs/r1');
  });

  it('A3: an empty run history renders the explicit empty state', async () => {
    mockFetch({ '/api/workflows/runs': { runs: [] } });
    render(<RunsPage project={null} query={{}} />);
    await screen.findByText('No runs yet');
    expect(screen.getByText('Browse workflows')).toBeTruthy();
  });

  it('the Launch-run affordance leads to the Workflows screen', async () => {
    mockFetch({ '/api/workflows/runs': { runs: [] } });
    render(<RunsPage project={null} query={{}} />);
    fireEvent.click(await screen.findByText('Launch run'));
    expect(location.pathname).toBe('/workflows');
  });
});

describe('RunDetail (REQ-DESKTOP-023.A1/A2/A3)', () => {
  it('A1: derives node progression from metadata + events, shows per-node cost, totals, and the event stream', async () => {
    mockFetch(detailRoutes(PAUSED_RUN));
    render(<RunsPage project={null} param="r1" query={{}} />);

    // The gate message shows in the approval banner AND the event log row.
    await screen.findAllByText('Review the diff before merge');

    // Node chips: plan completed (with its cost), gate paused, verify pending.
    await waitFor(() => {
      const chips = Object.fromEntries(
        [...document.querySelectorAll('[data-node-id]')].map((el) => [el.getAttribute('data-node-id'), el.getAttribute('data-node-state')]),
      );
      expect(chips).toEqual({ plan: 'completed', gate: 'paused', verify: 'pending' });
    });
    expect(screen.getAllByText(/\$0\.41/).length).toBeGreaterThanOrEqual(1);

    // Header totals from step_completed stats.
    expect(screen.getByTitle('Run-total cost').textContent).toBe('$0.41');
    expect(screen.getByTitle('Model').textContent).toBe('claude-sonnet-5');

    // Event stream rows from the fetched log.
    expect(screen.getByText('run_started')).toBeTruthy();
    expect(screen.getByText('tool_called')).toBeTruthy();
    expect(screen.getByText(/Read · src\/auth\.ts/)).toBeTruthy();
  });

  it('A2: Approve calls approve then resume and refetches the run', async () => {
    const calls = mockFetch({
      ...detailRoutes(PAUSED_RUN),
      'POST /api/workflows/runs/r1/approve': { ok: true },
      'POST /api/workflows/runs/r1/resume': { ok: true },
    });
    render(<RunsPage project={null} param="r1" query={{}} />);
    await screen.findAllByText('Review the diff before merge');

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => {
      const posts = calls.filter((c) => c.method === 'POST').map((c) => new URL(c.url, 'http://x').pathname);
      expect(posts).toEqual(['/api/workflows/runs/r1/approve', '/api/workflows/runs/r1/resume']);
    });
    await waitFor(() => {
      const gets = calls.filter((c) => c.method === 'GET' && c.url.includes('/api/workflows/runs/r1'));
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('A2: Reject asks for a reason and posts it to the engine', async () => {
    const calls = mockFetch({
      ...detailRoutes(PAUSED_RUN),
      'POST /api/workflows/runs/r1/reject': { ok: true },
    });
    render(<RunsPage project={null} param="r1" query={{}} />);
    await screen.findAllByText('Review the diff before merge');

    fireEvent.click(screen.getByText('Reject'));
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'diff touches unrelated files' } });
    fireEvent.click(screen.getByText('Confirm reject'));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/reject'));
      expect(post?.body).toEqual({ reason: 'diff touches unrelated files' });
    });
  });

  it('a running run exposes Cancel and calls the engine', async () => {
    const calls = mockFetch({
      ...detailRoutes({ ...PAUSED_RUN, status: 'running', metadata: { nodeStates: { plan: 'completed' } } }),
      'POST /api/workflows/runs/r1/cancel': { ok: true },
    });
    render(<RunsPage project={null} param="r1" query={{}} />);
    await screen.findByText('spec-fix');

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/cancel'))).toBe(true);
    });
  });

  it('A3: a failed run surfaces its failure state and error context', async () => {
    mockFetch(detailRoutes({
      ...PAUSED_RUN, status: 'failed', errorMessage: 'claude exited with code 1: boom', metadata: { nodeStates: { plan: 'failed' } },
    }));
    render(<RunsPage project={null} param="r1" query={{}} />);

    await screen.findByText('Run failed');
    expect(screen.getByText(/claude exited with code 1: boom/)).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy(); // status pill
  });

  it('a completed run exposes Inspect artifacts and renders the artifact bodies', async () => {
    mockFetch(detailRoutes({
      ...PAUSED_RUN, status: 'completed', completedAt: NOW - 5_000,
      metadata: { nodeStates: { plan: 'completed', gate: 'completed', verify: 'completed' } },
    }));
    render(<RunsPage project={null} param="r1" query={{}} />);
    await screen.findByText('spec-fix');

    fireEvent.click(screen.getByText('Inspect artifacts'));
    await screen.findByText('plan.md');
    expect(screen.getByText(/## Plan: fix the link/)).toBeTruthy();
  });
});
