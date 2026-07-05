/**
 * REQ-DESKTOP-023 — the Workflows screen lists discovered definitions with a
 * launch affordance; the launch dialog gates on required inputs, POSTs the
 * run, and navigates to its detail.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowsPage } from '../pages/workflows';

const WORKFLOWS = {
  workflows: [
    {
      workflow: {
        name: 'spec-implement',
        description: 'Plan, implement and verify a spec end to end.',
        requires: ['specship', 'git'],
        inputs: [{ name: 'SPEC_ID', required: true }],
        nodes: [
          { id: 'plan', kind: 'prompt' },
          { id: 'implement', kind: 'prompt', depends_on: ['plan'] },
          { id: 'verify', kind: 'bash', depends_on: ['implement'] },
        ],
      },
      scope: 'bundled',
      sourcePath: 'bundled:spec-implement.yaml',
    },
    {
      workflow: { name: 'quick-check', nodes: [{ id: 'run', kind: 'bash' }] },
      scope: 'project',
      sourcePath: '.specship/workflows/quick-check.yaml',
    },
  ],
  errors: [],
};

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

beforeEach(() => {
  history.replaceState(null, '', '/workflows');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkflowsPage (REQ-DESKTOP-023)', () => {
  it('lists discovered definitions with scope, node count, and inputs', async () => {
    mockFetch({ '/api/workflows': WORKFLOWS });
    render(<WorkflowsPage project={null} query={{}} />);

    await screen.findByText('spec-implement');
    expect(screen.getByText('Plan, implement and verify a spec end to end.')).toBeTruthy();
    expect(screen.getByText('3 nodes')).toBeTruthy();
    expect(screen.getByText('bundled')).toBeTruthy();
    expect(screen.getByText('$SPEC_ID')).toBeTruthy();
    expect(screen.getByText('quick-check')).toBeTruthy();
    expect(screen.getByText('1 nodes')).toBeTruthy();
  });

  it('launch dialog gates on required inputs, POSTs the run, and navigates to it', async () => {
    const calls = mockFetch({
      '/api/workflows': WORKFLOWS,
      'POST /api/workflows/runs': { runId: 'r-new', status: 'running' },
    });
    render(<WorkflowsPage project={null} query={{}} />);
    await screen.findByText('spec-implement');

    fireEvent.click(screen.getAllByText('Launch')[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    // Required input empty → Launch run disabled.
    const launchBtn = () => screen.getByText('Launch run').closest('button') as HTMLButtonElement;
    expect(launchBtn().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/SPEC_ID/), { target: { value: 'REQ-AUTH-005' } });
    expect(launchBtn().disabled).toBe(false);
    fireEvent.click(launchBtn());

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/workflows/runs'));
      expect(post?.body).toEqual({ workflowName: 'spec-implement', inputs: { SPEC_ID: 'REQ-AUTH-005' } });
    });
    await waitFor(() => expect(location.pathname).toBe('/runs/r-new'));
  });

  it('a definition-less project renders the guidance empty state', async () => {
    mockFetch({ '/api/workflows': { workflows: [], errors: [] } });
    render(<WorkflowsPage project={null} query={{}} />);
    await screen.findByText('No workflows found');
  });
});
