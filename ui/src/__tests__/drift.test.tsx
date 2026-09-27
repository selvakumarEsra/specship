/**
 * REQ-DESKTOP-022 (A3/A4) — the Drift queue lists live drifted/broken/orphaned
 * links with axis pills and workflow-gated repair actions (REQ-DESKTOP-005.A2),
 * renders the all-healthy state at zero items, and the sidebar badge equals
 * the queue's actual row count.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { DriftPage } from '../pages/drift';

const NOW = Date.now();

const LINKS = [
  { id: 1, specId: 'REQ-A-2', state: 'drifted', specTitle: 'Reject expired tokens', targetFilePath: 'src/auth.ts', targetQualifiedName: 'rejectExpired', driftAxis: 'code', provenance: 'agent-asserted', updatedAt: NOW - 3 * 86_400_000 },
  { id: 2, specId: 'REQ-A-9', state: 'broken', specTitle: 'Rotate signing keys', targetFilePath: 'src/auth.ts', targetQualifiedName: 'rotateKeys', provenance: 'tree-sitter', updatedAt: NOW - 3_600_000 },
  { id: 3, specId: 'REQ-I-1', state: 'orphaned', specTitle: 'Tail JSONL incrementally', targetFilePath: 'src/sync/watcher.ts', targetQualifiedName: 'tail', provenance: 'agent-asserted', updatedAt: NOW - 60_000 },
];

const APP_ROUTES: Record<string, unknown> = {
  '/api/status': {
    projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
    nodeCount: 100, edgeCount: 200, fileCount: 30,
    // Deliberately wrong so the test proves the badge uses the queue count.
    drift: 99,
    lastIndexed: null, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
  },
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/workflows/runs': { runs: [] },
  '/api/claude/tips': { tips: [] },
  '/api/drift': { links: LINKS },
};

function mockFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    const body = routes[u.pathname];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    }
    return { ok: true, json: async () => body };
  }));
  return calls;
}

beforeEach(() => {
  history.replaceState(null, '', '/drift');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DriftPage (REQ-DESKTOP-022)', () => {
  it('A3: lists live links with state + axis pills and per-state workflow-gated actions', async () => {
    mockFetch({ '/api/drift': { links: LINKS } });
    render(<DriftPage project={null} query={{}} />);

    await screen.findByText('REQ-A-2');
    expect(screen.getByText('3 links need attention')).toBeTruthy();
    expect(screen.getByText('Drifted')).toBeTruthy();
    expect(screen.getByText('Broken')).toBeTruthy();
    expect(screen.getByText('Orphaned')).toBeTruthy();
    expect(screen.getByText('code')).toBeTruthy(); // axis pill on the drifted row

    // Expand the drifted row: meta grid + a live Fix (REQ-TVIZ-009.A2).
    fireEvent.click(screen.getByText('REQ-A-2'));
    expect(screen.getByText('Drift axis')).toBeTruthy();
    const fix = screen.getByText('Fix').closest('button') as HTMLButtonElement;
    expect(fix.disabled).toBe(false);
    expect(fix.title).toContain('spec-fix');

    // Broken → Re-verify; orphaned → Re-attach. Both launch, neither is gated.
    fireEvent.click(screen.getByText('REQ-A-9'));
    const reverify = screen.getByText('Re-verify').closest('button') as HTMLButtonElement;
    expect(reverify.disabled).toBe(false);
    expect(reverify.title).toContain('spec-verify');
    fireEvent.click(screen.getByText('REQ-I-1'));
    const reattach = screen.getByText('Re-attach').closest('button') as HTMLButtonElement;
    expect(reattach.disabled).toBe(false);
    expect(reattach.title).toContain('spec-relink');

    // Open spec deep-links to the Specs screen with the selection.
    fireEvent.click(screen.getAllByText('Open spec')[0]!);
    expect(location.pathname).toBe('/specs');
    expect(location.search).toContain('sel=REQ-A-2');
  });

  it('A3: state filter chips narrow the list with per-state counts', async () => {
    mockFetch({ '/api/drift': { links: LINKS } });
    render(<DriftPage project={null} query={{}} />);
    await screen.findByText('REQ-A-2');

    // Anchored: drift rows are focusable buttons too, and the broken row's
    // accessible name starts with its "Broken" state pill.
    const brokenChip = screen.getByRole('button', { name: /^broken \d+$/ });
    expect(brokenChip.textContent).toBe('broken1');
    fireEvent.click(brokenChip);
    expect(screen.queryByText('REQ-A-9')).toBeNull();
    expect(screen.getByText('REQ-A-2')).toBeTruthy();
    fireEvent.click(brokenChip);
    expect(screen.getByText('REQ-A-9')).toBeTruthy();
  });

  it('A3: zero items renders the all-healthy state', async () => {
    mockFetch({ '/api/drift': { links: [] } });
    render(<DriftPage project={null} query={{}} />);
    await screen.findByText('Nothing drifted');
    expect(screen.getByText(/Every spec link is intact/)).toBeTruthy();
  });

  it('A4: the sidebar Drift-queue badge equals the queue row count, not the status roll-up', async () => {
    mockFetch(APP_ROUTES);
    render(<App />);

    // "Drift queue" is both the nav label and the page title — badge lives on
    // the one inside the sidebar link.
    const navItem = () =>
      screen.getAllByText('Drift queue').find((e) => e.closest('a'))!.closest('a') as HTMLElement;
    await waitFor(() => {
      expect(within(navItem()).getByText('3')).toBeTruthy();
    });
    expect(within(navItem()).queryByText('99')).toBeNull();
  });
});

/**
 * REQ-TVIZ-009.A2 — the queue's repair actions launch their existing
 * workflows through POST /api/workflows/runs and hand the user the run.
 */
describe('Drift repair actions (REQ-TVIZ-009.A2)', () => {
  function mockWithPosts(): Array<{ url: string; body: Record<string, unknown> }> {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://local');
      if (init?.method === 'POST') {
        posts.push({ url: u.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return { ok: true, json: async () => ({ runId: 'run-9', status: 'running' }) };
      }
      if (u.pathname === '/api/drift') return { ok: true, json: async () => ({ links: LINKS }) };
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found' }) };
    }));
    return posts;
  }

  it('A2: Fix launches spec-fix with the SPEC_ID and navigates to the created run', async () => {
    const posts = mockWithPosts();
    render(<DriftPage project={null} query={{}} />);
    await screen.findByText('REQ-A-2');

    fireEvent.click(screen.getByText('REQ-A-2'));
    fireEvent.click(screen.getByText('Fix').closest('button')!);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe('/api/workflows/runs');
    expect(posts[0]!.body).toEqual({ workflowName: 'spec-fix', inputs: { SPEC_ID: 'REQ-A-2' } });
    await waitFor(() => expect(location.pathname).toBe('/runs/run-9'));
  });

  it('A2: Re-attach launches spec-relink; Re-verify launches spec-verify with no inputs', async () => {
    const posts = mockWithPosts();
    render(<DriftPage project={null} query={{}} />);
    await screen.findByText('REQ-I-1');

    fireEvent.click(screen.getByText('REQ-I-1'));
    fireEvent.click(screen.getByText('Re-attach').closest('button')!);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({ workflowName: 'spec-relink', inputs: { SPEC_ID: 'REQ-I-1' } });

    cleanup();
    const posts2 = mockWithPosts();
    render(<DriftPage project={null} query={{}} />);
    await screen.findByText('REQ-A-9');
    fireEvent.click(screen.getByText('REQ-A-9'));
    fireEvent.click(screen.getByText('Re-verify').closest('button')!);
    await waitFor(() => expect(posts2).toHaveLength(1));
    // spec-verify declares no inputs — don't invent one.
    expect(posts2[0]!.body).toEqual({ workflowName: 'spec-verify', inputs: {} });
  });

  it('A2: a failed launch surfaces the error and leaves the row usable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://local');
      if (init?.method === 'POST') {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'workflow not found' }) };
      }
      if (u.pathname === '/api/drift') return { ok: true, json: async () => ({ links: LINKS }) };
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found' }) };
    }));
    render(<DriftPage project={null} query={{}} />);
    await screen.findByText('REQ-A-2');

    fireEvent.click(screen.getByText('REQ-A-2'));
    fireEvent.click(screen.getByText('Fix').closest('button')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('workflow not found');
    expect((screen.getByText('Fix').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
