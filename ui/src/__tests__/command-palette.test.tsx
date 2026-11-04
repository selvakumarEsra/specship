/**
 * REQ-DESKTOP-019 A1/A2/A4 — the ⌘K palette searches pages, graph nodes and
 * specs from live (mocked) endpoints (the agent-specific prompts section was
 * removed by REQ-DASHSIMPLE-001), navigates on
 * Enter/click, and degrades to "No matches" when the backend has nothing
 * (or answers 409 no_project) — never an error state.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PalettePage } from '../components/command-palette';

const PAGES: PalettePage[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'graph', label: 'Graph', icon: 'graph' },
];

const LIVE_ROUTES: Record<string, unknown> = {
  '/api/specs': { specs: [{ id: 'REQ-DASH-001', title: 'Dashboard modules spec' }], linkStates: {} },
  '/api/graph/search': { results: [{ node: { id: 'n1', name: 'DashboardPage', kind: 'function', filePath: 'ui/src/pages/dashboard.tsx', degree: 3 } }] },
};

function mockFetch(routes: Record<string, unknown> | 'no_project'): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (routes === 'no_project') {
      return { ok: false, status: 409, statusText: 'Conflict', json: async () => ({ error: 'no project', code: 'no_project' }) };
    }
    const path = url.split('?')[0] ?? url;
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found' }) };
    return { ok: true, json: async () => body };
  }));
}

function type(text: string): void {
  fireEvent.change(screen.getByPlaceholderText(/Search pages/), { target: { value: text } });
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CommandPalette (REQ-DESKTOP-019)', () => {
  it('A1: filters across all three result types as typed, Enter navigates to the selection', async () => {
    mockFetch(LIVE_ROUTES);
    render(<CommandPalette open onClose={() => {}} pages={PAGES} project={null} />);

    type('dash');
    await screen.findByText('DashboardPage'); // node search is debounced + async

    // One row per source, each with its type badge.
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('REQ-DASH-001')).toBeTruthy();
    for (const badge of ['Page', 'Node', 'Spec']) expect(screen.getByText(badge)).toBeTruthy();
    expect(screen.queryByText('Prompt')).toBeNull();

    // Row order is pages → nodes → specs; arrow down to the node row.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(location.pathname).toBe('/graph');
    expect(location.search).toBe('?focus=n1');
  });

  it('A1: a spec row navigates to that requirement in Review', async () => {
    mockFetch(LIVE_ROUTES);
    render(<CommandPalette open onClose={() => {}} pages={PAGES} project={null} />);
    type('dash');
    await screen.findByText('DashboardPage');

    fireEvent.click(screen.getByText('REQ-DASH-001'));
    expect(location.pathname).toBe('/review/REQ-DASH-001');
  });

  it('A2: arrows move the selection; Escape closes without navigating', async () => {
    mockFetch(LIVE_ROUTES);
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} pages={PAGES} project={null} />);

    const selectedLabels = () =>
      screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');

    expect(selectedLabels()[0]?.textContent).toContain('Dashboard');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(selectedLabels()[0]?.textContent).toContain('Graph');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(selectedLabels()[0]?.textContent).toContain('Dashboard');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(location.pathname).toBe('/');
  });

  it('A4: empty backends degrade to the "No matches" row, not an error', async () => {
    mockFetch({ '/api/specs': { specs: [], linkStates: {} }, '/api/graph/search': { results: [] } });
    render(<CommandPalette open onClose={() => {}} pages={PAGES} project={null} />);
    type('zzzz');
    expect(await screen.findByText('No matches')).toBeTruthy();
  });

  it('A4: a 409 no_project backend degrades to pages-only, never an error', async () => {
    mockFetch('no_project');
    render(<CommandPalette open onClose={() => {}} pages={PAGES} project={null} />);

    // Pages still filter locally even though every live fetch failed.
    type('gra');
    expect(await screen.findByText('Graph')).toBeTruthy();
    expect(screen.queryByText('No matches')).toBeNull();

    // And a query nothing matches shows the empty row, not a crash.
    type('zzzz');
    expect(await screen.findByText('No matches')).toBeTruthy();
  });
});
