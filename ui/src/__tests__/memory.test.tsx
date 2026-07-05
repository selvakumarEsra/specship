/**
 * REQ-DESKTOP-025 — Memory: A1 real memory files render with scope, line
 * count and modified time, and the effective view composes them in load
 * order (server array order: user before project); A2 Copy places the file
 * body on the clipboard with a confirmed state; A3 Reload re-fetches from
 * disk and reflects external edits; A4 no memory files renders the explicit
 * empty state, never a blank panel. Rendered through the full App per the
 * suite's convention (tips.test.tsx).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { MemoryFile, MemoryResponse } from '../api';

const USER_FILE: MemoryFile = {
  id: 'm-user', level: 'user', type: 'instruction', name: 'CLAUDE.md', scope: '~/.claude',
  path: '~/.claude/CLAUDE.md', tokens: 420, lines: 12, modified: '3d ago',
  body: '# Personal prefs\n\n- USER-BODY-MARKER prefer terse replies.',
};

const PROJ_FILE: MemoryFile = {
  id: 'm-proj', level: 'project', type: 'instruction', name: 'CLAUDE.md', scope: 'project root',
  path: '~/dev/specship/CLAUDE.md', tokens: 760, lines: 28, modified: '2h ago',
  body: '# Project memory\n\n- PROJECT-BODY-MARKER spec ids are stable.',
  imports: ['m-imp-conv'],
};

const IMPORT_FILE: MemoryFile = {
  id: 'm-imp-conv', level: 'import', type: 'import', name: 'conventions.md', scope: '@import',
  path: 'docs/conventions.md', tokens: 120, lines: 6, modified: '5d ago',
  body: '# Conventions\n\n- IMPORT-BODY-MARKER no default exports.',
};

/** Roll up counts the way the server route does (routes/memory.ts). */
function resp(files: MemoryFile[]): MemoryResponse {
  return {
    totalTokens: files.reduce((a, b) => a + b.tokens, 0),
    instructionCount: files.filter((f) => f.type === 'instruction').length,
    noteCount: files.filter((f) => f.type === 'note').length,
    importCount: files.filter((f) => f.type === 'import').length,
    files,
  };
}

const APP_ROUTES: Record<string, unknown> = {
  '/api/status': {
    projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
    nodeCount: 100, edgeCount: 200, fileCount: 30, drift: 0, lastIndexed: null,
    nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
  },
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/workflows/runs': { runs: [] },
  '/api/drift': { links: [] },
  '/api/claude/tips': { tips: [] },
};

/**
 * Fetch mock serving /api/memory from a queue — one entry per fetch, the
 * last repeating — so A3 can serve v1 on mount and v2 after Reload.
 */
function mockFetch(memoryBodies: MemoryResponse[]): void {
  let call = 0;
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0] ?? url;
    if (path === '/api/memory') {
      return ok(memoryBodies[Math.min(call++, memoryBodies.length - 1)]);
    }
    const body = APP_ROUTES[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return ok(body);
  }));
}

beforeEach(() => {
  history.replaceState(null, '', '/memory');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MemoryPage via App (REQ-DESKTOP-025)', () => {
  it('A1: sources render with scope, line count and modified time', async () => {
    mockFetch([resp([USER_FILE, PROJ_FILE, IMPORT_FILE])]);
    render(<App />);

    // Rail rows: instruction files show their scope, imports their name.
    await screen.findByText('~/.claude');
    expect(screen.getByText('project root')).toBeTruthy();
    expect(screen.getByText('conventions.md')).toBeTruthy();

    // Detail defaults to the project file: lines + modified in the kv strip.
    expect(screen.getByText('28')).toBeTruthy();
    expect(screen.getByText('2h ago')).toBeTruthy();

    // Selecting the user file swaps the detail's lines/modified.
    fireEvent.click(screen.getByText('~/.claude'));
    expect(await screen.findByText('12')).toBeTruthy();
    expect(screen.getByText('3d ago')).toBeTruthy();
  });

  it('A1: effective view composes bodies in load order (user before project)', async () => {
    mockFetch([resp([USER_FILE, PROJ_FILE, IMPORT_FILE])]);
    render(<App />);
    await screen.findByText('project root');

    fireEvent.click(screen.getByRole('radio', { name: 'Effective' }));
    const userBody = await screen.findByText(/USER-BODY-MARKER/);
    const projBody = screen.getByText(/PROJECT-BODY-MARKER/);
    expect(screen.getByText(/IMPORT-BODY-MARKER/)).toBeTruthy();
    // The user file arrives before the project file (load order) and must
    // render above it.
    expect(userBody.compareDocumentPosition(projBody) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('A2: Copy contents writes the file body to the clipboard and confirms', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockFetch([resp([USER_FILE, PROJ_FILE, IMPORT_FILE])]);
    render(<App />);
    await screen.findByText('project root');

    // Default selection is the project file.
    fireEvent.click(screen.getByText('Copy contents'));
    expect(writeText).toHaveBeenCalledWith(PROJ_FILE.body);
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('A3: Reload re-fetches and reflects external edits', async () => {
    const edited: MemoryFile = { ...PROJ_FILE, modified: '1m ago', body: '# Project memory\n\n- PROJECT-BODY-V2-MARKER edited on disk.' };
    mockFetch([resp([USER_FILE, PROJ_FILE]), resp([USER_FILE, edited])]);
    render(<App />);

    await screen.findByText(/PROJECT-BODY-MARKER/);
    fireEvent.click(screen.getByText('Reload memory'));

    expect(await screen.findByText(/PROJECT-BODY-V2-MARKER/)).toBeTruthy();
    expect(screen.getByText('1m ago')).toBeTruthy();
    expect(screen.queryByText(/PROJECT-BODY-MARKER spec ids/)).toBeNull();
  });

  it('A4: no memory files renders the explicit empty state', async () => {
    mockFetch([resp([])]);
    render(<App />);

    await screen.findByText('No memory files found');
    expect(screen.getByText('~/.claude/CLAUDE.md')).toBeTruthy();
    expect(screen.getByText('Reload memory')).toBeTruthy();
    expect(screen.queryByText('project root')).toBeNull();
  });
});
