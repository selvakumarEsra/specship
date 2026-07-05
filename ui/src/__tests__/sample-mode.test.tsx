/**
 * REQ-DESKTOP-030 — live data or a labeled SAMPLE state, never silent mock.
 * A1 a live-data screen backed by a real endpoint shows no SAMPLE badge; A2 a
 * module without a real backend (the design-system primitives) shows the
 * SAMPLE badge; A3 a failing module degrades to error-with-retry (and the
 * retry re-fetches) without taking its siblings down. (A4 — no mock dataset in
 * the bundle — is the build-guard's job, covered in __tests__/ui-build-guard.)
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { Module } from '../components/dashboard-modules';
import type { ApiState } from '../hooks';

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
  '/api/memory': { totalTokens: 10, instructionCount: 1, noteCount: 0, importCount: 0, files: [
    { id: 'u', level: 'user', type: 'instruction', name: 'CLAUDE.md', scope: '~/.claude', path: '~/.claude/CLAUDE.md', tokens: 10, lines: 3, modified: null, body: 'Be terse.', imports: [] },
  ] },
};

function mockFetch(routes: Record<string, unknown>) {
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') return ok({ ok: true });
    const path = url.split('?')[0] ?? url;
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return ok(body);
  }));
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SAMPLE / live-data integrity (REQ-DESKTOP-030)', () => {
  it('A1: a live screen backed by a real endpoint shows no SAMPLE badge', async () => {
    history.replaceState(null, '', '/memory');
    mockFetch(APP_ROUTES);
    render(<App />);
    // Memory binds its live file(s)…
    expect(await screen.findByText('Be terse.')).toBeTruthy();
    // …and nothing on a real-endpoint screen wears the SAMPLE badge.
    expect(document.querySelector('[data-sample-badge]')).toBeNull();
  });

  it('A2: the design-system primitives module (no backend) shows the SAMPLE badge', async () => {
    history.replaceState(null, '', '/designsystem');
    mockFetch(APP_ROUTES);
    render(<App />);
    const badge = await screen.findByText('SAMPLE');
    expect(badge.getAttribute('data-sample-badge')).not.toBeNull();
  });

  it('A3: a failing module degrades to error-with-retry, and retry re-fetches', () => {
    const reload = vi.fn();
    const errored: ApiState<string> = { data: null, loading: false, error: new Error('endpoint boom'), reload };
    render(<Module state={errored} label="Cache analytics" minHeight={80}>{(d) => <div>{d}</div>}</Module>);
    // The module shows its own error, not a blank pane or a whole-screen crash.
    expect(screen.getByText(/Couldn't load Cache analytics/)).toBeTruthy();
    expect(screen.getByText('endpoint boom')).toBeTruthy();
    // Retry re-runs the fetch for just this module.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('A3b: a live module renders its data with no error treatment', () => {
    const ok: ApiState<string> = { data: 'hello', loading: false, error: null, reload: vi.fn() };
    render(<Module state={ok} label="X" minHeight={80}>{(d) => <div>{d}</div>}</Module>);
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
