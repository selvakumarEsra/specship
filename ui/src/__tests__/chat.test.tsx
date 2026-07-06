/**
 * REQ-DESKTOP-027 — Chat: A1 the seeded suggestions render and send as
 * messages; A2 a sent message round-trips to the chat API and renders the
 * streamed answer with its tool-call context and source disclosure; A3 an
 * attached spec id renders as a chip the message carries; A4 a backend
 * failure renders an error bubble and preserves the composer's unsent
 * text. Rendered through the full App per the suite's convention
 * (mcp.test.tsx); the SSE leg is driven by a fake EventSource.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { ChatSource } from '../api';

/** Manual-drive EventSource double — tests emit the server's named events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
  }
  url: string;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  private listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
  error(): void {
    this.onerror?.({});
  }
  close(): void {
    this.closed = true;
  }
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
  '/api/specs': { specs: [{ id: 'REQ-DESKTOP-001', title: 'App shell' }], linkStates: {} },
  '/api/mcp/servers': {
    servers: [{
      id: 'specship', name: 'specship', scope: 'project', state: 'active', transport: 'stdio',
      command: 'specship serve --mcp', configFile: '/Users/dev/app/.mcp.json', disabled: false,
      entry: null, calls: 3, resultBytes: 100, lastUsed: null, exampleCall: null,
      tools: [
        { name: 'specship_explore', calls: 2, resultBytes: 60 },
        { name: 'specship_search', calls: 1, resultBytes: 40 },
      ],
    }],
  },
};

/** Fetch mock over APP_ROUTES; paths listed in `fail` return 500. */
function mockFetch(fail: string[] = []): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0] ?? url;
    if (fail.includes(path)) {
      return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: 'backend exploded' }) };
    }
    const body = APP_ROUTES[path];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + path }) };
    return { ok: true, json: async () => body };
  }));
}

const SYMBOL_SOURCE: ChatSource = {
  kind: 'symbol',
  ref: 'src/db/connection.ts:DatabaseConnection',
  label: 'DatabaseConnection',
  filePath: 'src/db/connection.ts',
  line: 12,
  detail: {
    signature: 'class DatabaseConnection',
    body: 'export class DatabaseConnection {\n  open() {}\n}',
    callers: [{ name: 'openDb', qualifiedName: 'db.openDb', filePath: 'src/db/index.ts', line: 3 }],
    callees: [],
  },
};

beforeEach(() => {
  history.replaceState(null, '', '/chat');
  localStorage.clear();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatPage via App (REQ-DESKTOP-027)', () => {
  it('A1: a seeded suggestion sends as a message and opens the chat stream', async () => {
    mockFetch();
    render(<App />);

    fireEvent.click(await screen.findByText('Summarize the drift queue'));

    // The question became a user bubble (the empty-state hero is gone) …
    expect(await screen.findByText('Summarize the drift queue')).toBeTruthy();
    expect(screen.queryByText('Ask with specship context')).toBeNull();
    // … and hit the chat SSE endpoint with the suggestion as the question.
    expect(FakeEventSource.instances.length).toBe(1);
    expect(decodeURIComponent(FakeEventSource.last().url)).toContain('/api/chat/stream?question=Summarize the drift queue');
  });

  it('A2: stream events render the answer, the tool-call card, and the source disclosure', async () => {
    mockFetch();
    render(<App />);

    const input = await screen.findByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'who calls DatabaseConnection?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    // Two matches: the user bubble AND the textarea — the draft only clears
    // once the backend answers (see A4).
    expect((await screen.findAllByText('who calls DatabaseConnection?')).length).toBe(2);
    expect(screen.getByText(/thinking with specship context/)).toBeTruthy();

    const es = FakeEventSource.last();
    act(() => {
      es.emit('thinking', { started: true });
      es.emit('tool', { name: 'specship_callers', input: 'DatabaseConnection' });
      es.emit('result_summary', { found: true, sourceCount: 1 });
      es.emit('chunk', { text: '**DatabaseConnection** is called ' });
      es.emit('chunk', { text: 'from 1 place.' });
      es.emit('done', { found: true, sources: [SYMBOL_SOURCE] });
    });

    // Streamed answer accumulated across chunks (bold rendered as <strong>).
    await screen.findByText(/from 1 place\./);
    expect(screen.getByText('DatabaseConnection', { selector: 'strong' })).toBeTruthy();
    // Tool-call context carried by the stream's `tool` event.
    expect(screen.getByText('specship_callers')).toBeTruthy();
    // Show-context affordance expands into the source's full detail.
    fireEvent.click(screen.getByText('Show context · 1 source'));
    expect(screen.getByText('src/db/connection.ts:12')).toBeTruthy();
    expect(screen.getByText(/export class DatabaseConnection/)).toBeTruthy();
    expect(screen.getByText('1 callers · 0 callees')).toBeTruthy();
    expect(es.closed).toBe(true);
  });

  it('A3: an attached spec id renders as a chip the sent message carries', async () => {
    mockFetch();
    render(<App />);

    fireEvent.click(await screen.findByLabelText('Attach files or spec IDs'));
    fireEvent.click(await screen.findByText('REQ-DESKTOP-001 · App shell'));
    // The chip sits in the composer before the send.
    expect(screen.getByText('REQ-DESKTOP-001')).toBeTruthy();

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'What is its link state?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    const es = FakeEventSource.last();
    // The ref travels inside the question (the API contract is question-only).
    expect(decodeURIComponent(es.url)).toContain('question=What is its link state? REQ-DESKTOP-001');

    // After the backend answers, the composer clears but the sent user
    // bubble keeps the chip.
    act(() => { es.emit('thinking', { started: true }); });
    await screen.findByText('What is its link state?');
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('REQ-DESKTOP-001')).toBeTruthy();
  });

  it('A4: a backend failure renders an error bubble and preserves the composer text', async () => {
    mockFetch();
    render(<App />);

    const input = await screen.findByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'explain the parser' } });
    fireEvent.click(screen.getByLabelText('Send'));

    act(() => { FakeEventSource.last().error(); });

    await screen.findByText(/The chat backend didn't answer/);
    // The unsent draft is untouched — nothing streamed, nothing cleared.
    expect((input as HTMLTextAreaElement).value).toBe('explain the parser');
    expect(FakeEventSource.last().closed).toBe(true);
  });

  it('never blank-screens: context endpoints failing still renders hero and composer', async () => {
    mockFetch(['/api/status', '/api/specs', '/api/mcp/servers']);
    render(<App />);

    expect(await screen.findByText('Ask with specship context')).toBeTruthy();
    expect(screen.getByLabelText('Chat message')).toBeTruthy();
    // Fallback suggestions still render without a loaded spec id.
    expect(screen.getByText('What specs does this project have?')).toBeTruthy();
  });
});
