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

    // Expand the drifted row: meta grid + gated Fix (REQ-DESKTOP-005.A2).
    fireEvent.click(screen.getByText('REQ-A-2'));
    expect(screen.getByText('Drift axis')).toBeTruthy();
    const fix = screen.getByText('Fix').closest('button') as HTMLButtonElement;
    expect(fix.disabled).toBe(true);
    expect(fix.title).toContain('workflow');

    // Broken → gated Re-verify; orphaned → gated Re-attach.
    fireEvent.click(screen.getByText('REQ-A-9'));
    const reverify = screen.getByText('Re-verify').closest('button') as HTMLButtonElement;
    expect(reverify.disabled).toBe(true);
    expect(reverify.title).toContain('verification workflow');
    fireEvent.click(screen.getByText('REQ-I-1'));
    const reattach = screen.getByText('Re-attach').closest('button') as HTMLButtonElement;
    expect(reattach.disabled).toBe(true);
    expect(reattach.title).toContain('workflow');

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
