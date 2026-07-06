/**
 * REQ-DESKTOP-026 — MCP: A1 configured servers render with live 5-state
 * status pills; A2 a server's detail shows its configuration, call
 * statistics and the real example call; A3 enable/disable asks for
 * confirmation, PATCHes the owning config file and reflects the new state;
 * A4 a failed server renders the failed treatment and empty/error responses
 * render explicit states, never a blank screen or crash. Rendered through
 * the full App per the suite's convention (memory.test.tsx).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { McpServer, McpServersResponse } from '../api';

function mkServer(over: Partial<McpServer> & { name: string }): McpServer {
  return {
    id: over.name,
    scope: 'user',
    state: 'idle',
    transport: 'stdio',
    command: over.name + '-bin',
    configFile: '/Users/dev/.claude.json',
    disabled: false,
    entry: { type: 'stdio', command: over.name + '-bin' },
    calls: 0,
    resultBytes: 0,
    lastUsed: null,
    tools: [],
    exampleCall: null,
    ...over,
  };
}

const SPECSHIP = mkServer({
  name: 'specship',
  scope: 'project',
  state: 'active',
  command: 'specship serve --mcp',
  configFile: '/Users/dev/app/.mcp.json',
  entry: { type: 'stdio', command: 'specship', args: ['serve', '--mcp'] },
  calls: 412,
  resultBytes: 210_000,
  lastUsed: new Date().toISOString(),
  tools: [{ name: 'specship_explore', calls: 300, resultBytes: 90_000 }],
  exampleCall: { tool: 'specship_explore', args: { query: 'auth flow' } },
});

const GITHUB = mkServer({ name: 'github', state: 'connected' });
const FILESYSTEM = mkServer({ name: 'filesystem', state: 'idle' });
const SENTRY = mkServer({ name: 'sentry', state: 'failed', transport: 'http', command: 'https://mcp.sentry.dev/sse', entry: { type: 'http', url: 'https://mcp.sentry.dev/sse' } });
const PLAYWRIGHT = mkServer({ name: 'playwright', scope: 'project', state: 'disabled', disabled: true, configFile: '/Users/dev/app/.mcp.json' });

const ALL = [SPECSHIP, GITHUB, FILESYSTEM, SENTRY, PLAYWRIGHT];

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

interface RecordedCall { url: string; method: string; body: unknown }

/**
 * Fetch mock serving /api/mcp/servers from a queue (one entry per GET, the
 * last repeating) so A3 can serve the pre-toggle list first and the toggled
 * list after the PATCH-triggered reload. Non-GET calls are recorded.
 */
function mockFetch(bodies: Array<McpServersResponse | { fail: true }>): RecordedCall[] {
  const recorded: RecordedCall[] = [];
  let call = 0;
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.split('?')[0] ?? url;
    if (method !== 'GET') {
      recorded.push({ url: path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return ok({ ok: true });
    }
    if (path === '/api/mcp/servers') {
      const body = bodies[Math.min(call++, bodies.length - 1)]!;
      if ('fail' in body) return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: 'probe machinery exploded' }) };
      return ok(body);
    }
    const body = APP_ROUTES[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return ok(body);
  }));
  return recorded;
}

beforeEach(() => {
  history.replaceState(null, '', '/mcp');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('McpPage via App (REQ-DESKTOP-026)', () => {
  it('A1: servers render grouped with a live status pill per state', async () => {
    mockFetch([{ servers: ALL }]);
    render(<App />);

    await screen.findByText('specship');
    // All five spec states appear as pills ("Connected" also names a summary
    // tile, so allow more than one).
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    // Scope groups render with their config-file hints.
    expect(screen.getByText('~/.claude.json')).toBeTruthy();
    expect(screen.getByText('.mcp.json')).toBeTruthy();
    // The failed server is called out in the Needs attention tile (its row
    // name is a span; the tile sub is a div).
    expect(screen.getByText('sentry', { selector: 'div' })).toBeTruthy();
  });

  it('A2: detail shows configuration, call statistics and the example call', async () => {
    mockFetch([{ servers: ALL }]);
    render(<App />);

    fireEvent.click(await screen.findByText('specship'));

    // Owning config file + config JSON.
    expect((await screen.findAllByText('/Users/dev/app/.mcp.json')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/"command": "specship"/)).toBeTruthy();
    // Per-tool call stats.
    expect(screen.getByText('specship_explore')).toBeTruthy();
    expect(screen.getByText('×300')).toBeTruthy();
    // The real example call from claude_tool_calls.input_json.
    expect(screen.getByText('specship_explore {"query":"auth flow"}')).toBeTruthy();
  });

  it('A3: enable/disable confirms, PATCHes the owning file and reflects the new state', async () => {
    const disabledSpecship = { ...SPECSHIP, state: 'disabled' as const, disabled: true };
    const recorded = mockFetch([
      { servers: ALL },
      { servers: [disabledSpecship, GITHUB, FILESYSTEM, SENTRY, PLAYWRIGHT] },
    ]);
    render(<App />);

    fireEvent.click(await screen.findByText('specship'));
    fireEvent.click(await screen.findByText('Disable server'));

    // Nothing is written until the dialog confirms.
    const dialog = await screen.findByRole('dialog');
    expect(recorded).toHaveLength(0);
    expect(within(dialog).getByText(/writes to/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable server' }));

    expect(await screen.findByText('Enable server')).toBeTruthy();
    expect(recorded).toEqual([
      { url: '/api/mcp/servers/specship', method: 'PATCH', body: { enabled: false } },
    ]);
    // The reloaded state is reflected in the banner.
    expect(screen.getByText('Disabled', { selector: 'span' })).toBeTruthy();
  });

  it('A4: a failed server renders the failed treatment, not a blank panel', async () => {
    mockFetch([{ servers: ALL }]);
    render(<App />);

    // 'sentry' also appears in the Needs attention tile — the row name is a span.
    fireEvent.click(await screen.findByText('sentry', { selector: 'span' }));

    await screen.findByText(/didn't answer an MCP initialize/);
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('A4: no servers anywhere renders the explicit empty state', async () => {
    mockFetch([{ servers: [] }]);
    render(<App />);

    await screen.findByText('No MCP servers configured');
    expect(screen.getAllByText('Add server').length).toBeGreaterThanOrEqual(1);
  });

  it('A4: an API error renders the shared error state with retry, never a crash', async () => {
    mockFetch([{ fail: true }, { servers: ALL }]);
    render(<App />);

    await screen.findByText(/Couldn't load MCP servers/);
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('specship')).toBeTruthy();
  });
});
