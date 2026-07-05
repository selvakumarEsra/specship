/**
 * REQ-DESKTOP-028 — Settings + Design system. A1 appearance changes apply
 * immediately and persist (theme/density write documentElement attrs +
 * localStorage); A2 the transcript-ingest toggle PUTs /api/config so the
 * analytics screens' banner reacts; A3 About renders the real version + DB
 * backend from /api/status; A4 the design-system gallery renders control
 * states from the shared tokens in both themes. Rendered through the full
 * App per the suite convention (mcp.test.tsx).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const STATUS = {
  projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
  version: '9.9.9', nodeCount: 100, edgeCount: 200, fileCount: 42, drift: 0,
  lastIndexed: null, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
};

const APP_ROUTES: Record<string, unknown> = {
  '/api/status': STATUS,
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/workflows/runs': { runs: [] },
  '/api/drift': { links: [] },
  '/api/claude/tips': { tips: [] },
};

interface RecordedCall { url: string; method: string; body: unknown }

/**
 * Serves /api/config from a queue (one per GET, the last repeating) so the
 * post-PUT reload sees the toggled value; records non-GET calls.
 */
function mockFetch(configs: Array<{ ingestEnabled: boolean }>): RecordedCall[] {
  const recorded: RecordedCall[] = [];
  let call = 0;
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.split('?')[0] ?? url;
    if (method !== 'GET') {
      recorded.push({ url: path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return ok({ ...configs[Math.min(call, configs.length - 1)]!, version: '9.9.9' });
    }
    if (path === '/api/config') {
      return ok({ ...configs[Math.min(call++, configs.length - 1)]!, version: '9.9.9' });
    }
    const body = APP_ROUTES[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return ok(body);
  }));
  return recorded;
}

beforeEach(() => {
  history.replaceState(null, '', '/settings');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsPage via App (REQ-DESKTOP-028)', () => {
  it('A1: theme and density changes apply immediately and persist', async () => {
    mockFetch([{ ingestEnabled: false }]);
    render(<App />);

    // Appearance section renders; pick Light theme.
    const light = await screen.findByRole('radio', { name: 'Light' });
    fireEvent.click(light);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('specship-theme')).toBe('light');

    // Density → Compact.
    const compact = screen.getByRole('radio', { name: 'Compact' });
    fireEvent.click(compact);
    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
    expect(localStorage.getItem('specship-density')).toBe('compact');
  });

  it('A2: the ingest toggle PUTs /api/config', async () => {
    const recorded = mockFetch([{ ingestEnabled: false }, { ingestEnabled: true }]);
    render(<App />);

    const toggle = await screen.findByRole('switch', { name: 'Enable transcript ingest' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);

    // A PUT to /api/config carried the flipped flag.
    await vi.waitFor(() => {
      const put = recorded.find((c) => c.url === '/api/config' && c.method === 'PUT');
      expect(put).toBeTruthy();
      expect(put!.body).toEqual({ ingestEnabled: true });
    });
    // After the reload the switch reflects the new state.
    await vi.waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Enable transcript ingest' }).getAttribute('aria-checked')).toBe('true');
    });
  });

  it('A3: About shows the real version and DB backend from /api/status', async () => {
    mockFetch([{ ingestEnabled: true }]);
    render(<App />);

    // Version string from the mocked status (v-prefixed) and the backend.
    expect(await screen.findByText('v9.9.9')).toBeTruthy();
    expect(screen.getAllByText('native').length).toBeGreaterThanOrEqual(1);
  });

  it('A4: the design-system gallery renders control states from tokens in both themes', async () => {
    mockFetch([{ ingestEnabled: false }]);
    history.replaceState(null, '', '/designsystem');
    render(<App />);

    // Both theme wrappers present (A4: "in both themes").
    const darkWrap = await screen.findByTestId('theme-dark');
    const lightWrap = screen.getByTestId('theme-light');
    expect(darkWrap).toBeTruthy();
    expect(lightWrap).toBeTruthy();
    expect(document.querySelector('[data-theme="light"]')).toBeTruthy();

    // Button control states render (disabled, pressed) — asserted by aria-label.
    expect(screen.getAllByLabelText('Primary disabled').length).toBeGreaterThanOrEqual(2); // one per theme
    expect(screen.getAllByLabelText('Secondary pressed').length).toBeGreaterThanOrEqual(2);

    // Spec link + run state pills render (from the shared STATE record).
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(2);

    // A swatch derives from a token var, never a hard-coded hex.
    const swatch = darkWrap.parentElement!.querySelector('[style*="var(--bg-panel)"]');
    expect(swatch).toBeTruthy();
  });
});
