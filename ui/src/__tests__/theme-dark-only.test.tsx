/**
 * REQ-DASHTHEME-003 — the dashboard is dark-only, with no theme switch
 * (specs/dashboard-theme-bmg.md). No toggle in the top bar, no Theme option
 * in Settings, a stored light/system pref is ignored without error, the OS
 * colour scheme never changes the dashboard, and no light-theme token values
 * remain in the stylesheets. Rendered through the full App per the suite
 * convention (settings.test.tsx).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { applyTheme } from '../theme';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');

const STATUS = {
  projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
  version: '9.9.9', nodeCount: 100, edgeCount: 200, fileCount: 42, drift: 0,
  lastIndexed: null, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
};

const ROUTES: Record<string, unknown> = {
  '/api/status': STATUS,
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/workflows/runs': { runs: [] },
  '/api/drift': { links: [] },
  '/api/claude/tips': { tips: [] },
  '/api/config': { ingestEnabled: false, version: '9.9.9' },
};

function mockFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0] ?? url;
    const body = ROUTES[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return { ok: true, json: async () => body };
  }));
}

beforeEach(() => {
  history.replaceState(null, '', '/settings');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function reqDashtheme003A1() {
  mockFetch();
  render(<App />);

  // Settings renders its Appearance section with Density but no Theme field.
  await screen.findByText('Density');
  expect(screen.queryByText('Theme')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Light' })).toBeNull();
  expect(screen.queryByRole('radio', { name: 'System' })).toBeNull();

  // The top bar carries no theme toggle.
  const toggles = Array.from(document.querySelectorAll('[aria-label]'))
    .filter((el) => /^Theme:/.test(el.getAttribute('aria-label') ?? ''));
  expect(toggles).toHaveLength(0);
  expect(screen.queryByTitle(/^Theme:/)).toBeNull();
}

async function reqDashtheme003A2() {
  localStorage.setItem('specship-theme', 'light');
  const errorSpy = vi.spyOn(console, 'error');
  mockFetch();

  applyTheme();
  render(<App />);
  await screen.findByText('Density');

  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  expect(localStorage.getItem('specship-theme')).toBeNull();
  expect(errorSpy).not.toHaveBeenCalled();
}

async function reqDashtheme003A3() {
  const addEventListener = vi.fn();
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-color-scheme: light)',
    media: query,
    onchange: null,
    addEventListener,
    removeEventListener: vi.fn(),
    addListener: addEventListener,
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  mockFetch();

  applyTheme();
  render(<App />);
  await screen.findByText('Density');

  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  const colourSchemeQueries = matchMedia.mock.calls.filter(([q]) => /prefers-color-scheme/.test(q));
  expect(colourSchemeQueries).toHaveLength(0);
  expect(addEventListener).not.toHaveBeenCalledWith('change', expect.anything());
}

function reqDashtheme003A4() {
  const sheets = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
  expect(sheets.length).toBeGreaterThan(0);
  for (const sheet of sheets) {
    const css = readFileSync(join(STYLES, sheet), 'utf8');
    expect(css, sheet).not.toMatch(/data-theme\s*=\s*["']?light/);
    expect(css, sheet).not.toMatch(/prefers-color-scheme\s*:\s*light/);
    expect(css, sheet).not.toMatch(/color-scheme\s*:\s*light/);
  }
}

describe('REQ-DASHTHEME-003 — dark-only dashboard', () => {
  it('REQ-DASHTHEME-003.A1: the top bar has no theme toggle and Settings has no theme option', reqDashtheme003A1);
  it('REQ-DASHTHEME-003.A2: a stored light preference renders dark and logs no error', reqDashtheme003A2);
  it('REQ-DASHTHEME-003.A3: an OS light colour scheme still renders dark', reqDashtheme003A3);
  it('REQ-DASHTHEME-003.A4: no light-theme token values remain in the stylesheets', reqDashtheme003A4);
});
