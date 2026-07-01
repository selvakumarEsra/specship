import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Chat } from './chat';
import { ApiService } from '../../api/api';

/**
 * Chat page (REQ-DASH-CHAT-003 / -004) — the send path faux-streams the
 * deterministic server reply over SSE. These tests stub ApiService.openEventStream
 * to capture the handler's callback, then feed the event sequence and assert:
 *   - the assistant text grows incrementally as `chunk` events arrive (A2),
 *   - the tool-call card reflects the real capability + truthful result summary,
 *   - no model / cost / token is ever set on the reply (CHAT-004.A1/A3),
 *   - `thinking` toggles and the stream close-fn fires on `done` and on destroy.
 */

interface ChatMsgView { role: string; text: string; tools?: { name: string; input: string; output: string }[]; model?: string; cost?: number; tokens?: number; }

class MockApiService {
  path?: string;
  types?: string[];
  onEvent?: (type: string, data: unknown) => void;
  onError?: (err: unknown) => void;
  closeCount = 0;

  get apiBase(): string { return 'http://test'; }
  get isConfigured(): boolean { return true; }

  async get<T>(): Promise<T> { return {} as T; }

  openEventStream(
    path: string,
    onEvent: (type: string, data: unknown) => void,
    onError: (err: unknown) => void,
    types?: string[],
  ): () => void {
    this.path = path;
    this.onEvent = onEvent;
    this.onError = onError;
    this.types = types;
    return () => { this.closeCount += 1; };
  }
}

function makeComponent() {
  TestBed.configureTestingModule({
    imports: [Chat],
    providers: [
      provideRouter([]),
      { provide: ApiService, useClass: MockApiService },
    ],
  });
  const fixture = TestBed.createComponent(Chat);
  fixture.detectChanges();
  const api = TestBed.inject(ApiService) as unknown as MockApiService;
  // Access protected members through a loose view for the test.
  const comp = fixture.componentInstance as unknown as {
    draft: { set(v: string): void };
    thinking: { (): boolean };
    messages: { (): ChatMsgView[] };
    send(): void;
    ngOnDestroy(): void;
  };
  return { fixture, api, comp };
}

describe('Chat', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('opens the faux-stream with the encoded question and the named event types', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('how does recordEntry work');
    comp.send();

    expect(api.path).toBe('/api/chat/stream?question=how%20does%20recordEntry%20work');
    expect(api.types).toEqual(['thinking', 'tool', 'result_summary', 'chunk', 'done']);
    expect(comp.thinking()).toBe(true);
    // A placeholder assistant message was pushed to grow in place.
    const msgs = comp.messages();
    expect(msgs[msgs.length - 1].role).toBe('assistant');
    expect(msgs[msgs.length - 1].text).toBe('');
  });

  it('grows the assistant text incrementally as chunk events arrive (A2)', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('how does recordEntry work');
    comp.send();
    const feed = api.onEvent!;

    feed('tool', { name: 'specship_explore', input: 'recordEntry' });
    feed('result_summary', { found: true, sourceCount: 3 });

    const last = () => comp.messages()[comp.messages().length - 1];
    feed('chunk', { text: 'Found 3 ' });
    expect(last().text).toBe('Found 3 ');
    feed('chunk', { text: 'symbols.' });
    expect(last().text).toBe('Found 3 symbols.');

    // The tool card reflects the real capability + a truthful, computed summary.
    const tool = last().tools![0];
    expect(tool.name).toBe('specship_explore');
    expect(tool.input).toBe('recordEntry');
    expect(tool.output).toBe('3 sources returned');
  });

  it('never sets a model, cost, or token count on the reply (CHAT-004.A1/A3)', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('how does recordEntry work');
    comp.send();
    const feed = api.onEvent!;
    feed('tool', { name: 'specship_explore', input: 'recordEntry' });
    feed('result_summary', { found: true, sourceCount: 1 });
    feed('chunk', { text: 'An answer.' });
    feed('done', { found: true, sources: [] });

    const reply = comp.messages()[comp.messages().length - 1];
    expect(reply.model).toBeUndefined();
    expect(reply.cost).toBeUndefined();
    expect(reply.tokens).toBeUndefined();
  });

  it('stops thinking and closes the stream on done', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('anything');
    comp.send();
    expect(comp.thinking()).toBe(true);

    api.onEvent!('done', { found: false, sources: [] });
    expect(comp.thinking()).toBe(false);
    expect(api.closeCount).toBe(1);
  });

  it('renders an honest not-found summary when nothing matched', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('frobnicate');
    comp.send();
    const feed = api.onEvent!;
    feed('tool', { name: 'specship_search', input: 'frobnicate' });
    feed('result_summary', { found: false, sourceCount: 0 });

    const last = comp.messages()[comp.messages().length - 1];
    expect(last.tools![0].output).toBe('no matches in the index');
  });

  it('tears down an in-flight stream on destroy', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('anything');
    comp.send();
    comp.ngOnDestroy();
    expect(api.closeCount).toBe(1);
  });

  it('ignores an empty draft (no stream opened)', () => {
    const { api, comp } = makeComponent();
    comp.draft.set('   ');
    comp.send();
    expect(api.path).toBeUndefined();
    expect(comp.thinking()).toBe(false);
  });
});
