/**
 * REQ-DASHSIMPLE-001 — the navigation shows only agent-agnostic screens.
 * Rendered through the full App against fixture API data:
 *   A1 the sidebar lists exactly Overview, Plan, Review, Graph, Traceability,
 *      Runs, then Settings and Design system;
 *   A2 retired routes redirect (analytics screens → Overview, Specs / Drift →
 *      Review, /specs/<id> → that requirement in Review);
 *   A3 the ⌘K palette offers no removed screen;
 *   A4 no sidebar, palette or screen-title text names a coding agent;
 *   A5 specs/specship-desktop.md carries the dated SUPERSEDED note on
 *      REQ-DESKTOP-018.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewRoutesFromSpecs } from './review-fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { __clearApiCache } from '../hooks';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const AGENT_NAMES = /claude|gemini|codex|cursor|copilot/i;

const REMOVED_ROUTES = ['sessions', 'heatmap', 'costs', 'compare', 'memory', 'mcp', 'tips'];
const REMOVED_LABELS = ['Sessions', 'Heatmap', 'Costs', 'Compare projects', 'Memory', 'MCP', 'Tips', 'Specs', 'Drift queue'];

const STATUS = {
  projectPath: '/Users/dev/acme', backend: 'native', journalMode: 'wal',
  version: '9.9.9', nodeCount: 100, edgeCount: 200, fileCount: 42, drift: 0,
  lastIndexed: null, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
};

const SPECS = {
  specs: [
    { id: 'X-DOC', kind: 'document', title: 'Example', sourcePath: 'specs/x.md' },
    { id: 'REQ-X-001', kind: 'requirement', title: 'Widgets render on time', sourcePath: 'specs/x.md', parentId: 'X-DOC' },
  ],
  linkStates: {},
};

const DETAIL_X1 = {
  spec: {
    id: 'REQ-X-001', kind: 'requirement', title: 'Widgets render on time',
    body: 'The widget MUST render within one frame.', sourcePath: 'specs/x.md', parentId: 'X-DOC',
  },
  parent: { id: 'X-DOC', kind: 'document', title: 'Example', sourcePath: 'specs/x.md' },
  siblings: [], children: [], links: [], childLinks: {}, source: null,
};

const ROUTES: Record<string, unknown> = {
  '/api/status': STATUS,
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/workflows/runs': { runs: [] },
  '/api/workflows': { workflows: [], errors: [] },
  ...reviewRoutesFromSpecs(SPECS),
  '/api/specs': SPECS,
  '/api/spec/REQ-X-001': DETAIL_X1,
  '/api/graph/search': { results: [] },
};

function mockFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') return { ok: true, json: async () => ({ ok: true }) };
    const path = url.split('?')[0] ?? url;
    const body = ROUTES[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return { ok: true, json: async () => body };
  }));
}

function sidebar(): HTMLElement {
  return document.querySelector('nav') as HTMLElement;
}

function sidebarLabels(): string[] {
  return Array.from(sidebar().querySelectorAll('a')).map((a) => {
    const label = a.querySelector('span.grow');
    return (label?.textContent ?? '').trim();
  });
}

function openPalette(): void {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
}

function paletteOptions(): string[] {
  return screen.queryAllByRole('option').map((o) => o.textContent ?? '');
}

/** Navigate the way a pasted deep link does: a fresh load of that URL. */
function renderAt(path: string): void {
  history.replaceState(null, '', path);
  render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  __clearApiCache();
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

function reqDashsimple001A1(): void {
  renderAt('/dashboard');
  expect(sidebarLabels()).toEqual([
    'Overview', 'Plan', 'Review', 'Graph', 'Traceability', 'Runs', 'Settings', 'Design system',
  ]);
  // No group header from the old two-group layout survives.
  expect(sidebar().textContent).not.toMatch(/Project|Claude Code/);
}

async function reqDashsimple001A2(): Promise<void> {
  for (const r of REMOVED_ROUTES) {
    renderAt('/' + r);
    expect(location.pathname, `/${r} → Overview`).toBe('/dashboard');
    expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('dashboard');
    cleanup();
  }

  for (const r of ['specs', 'drift']) {
    renderAt('/' + r);
    expect(location.pathname, `/${r} → Review`).toBe('/review');
    expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('review');
    cleanup();
  }

  // A deep link to a requirement keeps its id and renders it in Review.
  renderAt('/specs/REQ-X-001');
  expect(location.pathname).toBe('/review/REQ-X-001');
  expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('review');
  // The body's MUST keyword is decorated, so match the trailing prose.
  expect(await screen.findByText(/render within one frame/)).toBeTruthy();
  cleanup();

  // In-app navigation through history (pushState + popstate) redirects too.
  renderAt('/runs');
  act(() => {
    history.pushState(null, '', '/costs');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() => expect(location.pathname).toBe('/dashboard'));
  expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('dashboard');
}

function reqDashsimple001A3(): void {
  renderAt('/dashboard');
  openPalette();
  const options = paletteOptions();
  expect(options.length).toBeGreaterThan(0);
  for (const label of REMOVED_LABELS) {
    expect(options.some((o) => o.startsWith(label + '/')), `palette offers removed "${label}"`).toBe(false);
  }
  for (const r of [...REMOVED_ROUTES, 'specs', 'drift']) {
    expect(options.some((o) => o.includes('/' + r)), `palette jumps to /${r}`).toBe(false);
  }
  // The live screens are all still there.
  for (const label of ['Overview', 'Plan', 'Review', 'Graph', 'Traceability', 'Runs', 'Workflows', 'Design system', 'Settings']) {
    expect(options.some((o) => o.startsWith(label)), `palette offers "${label}"`).toBe(true);
  }
}

async function reqDashsimple001A4(): Promise<void> {
  const routes = ['dashboard', 'plan', 'review', 'graph', 'traceability', 'runs', 'workflows', 'settings', 'designsystem'];
  for (const r of routes) {
    renderAt('/' + r);
    expect(sidebar().textContent ?? '', `sidebar on /${r}`).not.toMatch(AGENT_NAMES);
    // Screen titles: every PageHead title plus the placeholder screen's title.
    await waitFor(() => expect(document.querySelector('[data-screen]')).not.toBeNull());
    for (const t of Array.from(document.querySelectorAll('[data-page-title]'))) {
      expect(t.textContent ?? '', `screen title on /${r}`).not.toMatch(AGENT_NAMES);
    }
    cleanup();
  }
  renderAt('/dashboard');
  openPalette();
  const listbox = screen.getByRole('listbox');
  expect(listbox.textContent ?? '').not.toMatch(AGENT_NAMES);
  expect((screen.getByPlaceholderText(/Search pages/) as HTMLInputElement).placeholder).not.toMatch(AGENT_NAMES);
}

function reqDashsimple001A5(): void {
  const md = readFileSync(join(REPO, 'specs', 'specship-desktop.md'), 'utf8');
  const start = md.indexOf('<!-- id: REQ-DESKTOP-018 -->');
  expect(start).toBeGreaterThanOrEqual(0);
  const next = md.indexOf('<!-- id: REQ-DESKTOP-', start + 1);
  const section = md.slice(start, next === -1 ? undefined : next);
  expect(section).toMatch(/SUPERSEDED \d{4}-\d{2}-\d{2}\*{0,2} by REQ-DASHSIMPLE-001/);
}

describe('agent-agnostic navigation (REQ-DASHSIMPLE-001)', () => {
  it('REQ-DASHSIMPLE-001.A1: the sidebar lists exactly the agent-agnostic screens, then Settings and Design system', reqDashsimple001A1);
  it('REQ-DASHSIMPLE-001.A2: retired routes redirect to Overview or Review, keeping a requirement id', reqDashsimple001A2);
  it('REQ-DASHSIMPLE-001.A3: the command palette offers no removed screen', reqDashsimple001A3);
  it('REQ-DASHSIMPLE-001.A4: no sidebar, palette or screen-title text names a coding agent', reqDashsimple001A4);
  it('REQ-DASHSIMPLE-001.A5: specship-desktop.md marks REQ-DESKTOP-018 SUPERSEDED by REQ-DASHSIMPLE-001', reqDashsimple001A5);
});
