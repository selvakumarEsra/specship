/**
 * ApiService — HTTP client over the specship Fastify backend.
 *
 * Resolution order for the API base URL:
 *   1. `?api=` query string on the page (e.g. http://localhost:4200?api=http://localhost:4242)
 *   2. localStorage `specship.api` (persists across reloads once set)
 *   3. window.SPECSHIP_API_URL global (set by an outer host shell)
 *   4. Default: http://localhost:4242 when running on localhost
 *   5. null — UI degrades to empty/error states
 *
 * `get()` / `post()` are low-level. Component-level data stores (see
 * ./resource.ts) wrap them as signals that auto-fetch and expose
 * { data, loading, error }.
 */
import { Injectable } from '@angular/core';

const LS_KEY = 'specship.api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base: string | null;

  constructor() {
    this.base = this.resolveBase();
  }

  private resolveBase(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const qp = new URLSearchParams(window.location.search).get('api');
      if (qp) {
        try { window.localStorage.setItem(LS_KEY, qp); } catch { /* noop */ }
        return qp.replace(/\/$/, '');
      }
    } catch { /* noop */ }
    try {
      const stored = window.localStorage.getItem(LS_KEY);
      if (stored) return stored.replace(/\/$/, '');
    } catch { /* noop */ }
    const glob = (window as unknown as { SPECSHIP_API_URL?: string }).SPECSHIP_API_URL;
    if (typeof glob === 'string') return glob.replace(/\/$/, '');
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      // When the dashboard is served by the specship server itself, use the
      // page's OWN origin so the API host matches exactly. Hardcoding
      // `localhost` broke a page opened at `127.0.0.1:<port>` — the browser
      // treats `127.0.0.1` and `localhost` as different origins, so every call
      // (including the SSE streams) became cross-origin and got CORS-blocked.
      // Only the Angular dev server (4200/4201) needs the separate API port.
      const port = window.location.port;
      if (port === '4200' || port === '4201') return 'http://localhost:4242';
      return window.location.origin.replace(/\/$/, '');
    }
    return null;
  }

  /** Public — used by the status strip's "● live" / "● mock" indicator. */
  get apiBase(): string | null {
    return this.base;
  }

  get isConfigured(): boolean {
    return this.base !== null;
  }

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    if (!this.base) throw new Error('no API base configured');
    const url = this.base + (path.startsWith('/') ? path : '/' + path);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) throw await buildApiError('GET', path, res);
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.base) throw new Error('no API base configured');
    const url = this.base + (path.startsWith('/') ? path : '/' + path);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await buildApiError('POST', path, res);
    return res.json() as Promise<T>;
  }

  async put<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.base) throw new Error('no API base configured');
    const url = this.base + (path.startsWith('/') ? path : '/' + path);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await buildApiError('PUT', path, res);
    return res.json() as Promise<T>;
  }

  /**
   * SSE helper — used by the run-detail page for live event streaming.
   *
   * The workflow event stream emits *named* events (`step_started`,
   * `step_completed`, `tool_called`, …, plus a `done` sentinel), so we add
   * an explicit listener per type. Anything not in the known set is still
   * caught by the default `message` channel.
   *
   * Returns a close function the caller invokes on teardown.
   */
  openEventStream(
    path: string,
    onEvent: (type: string, data: unknown) => void,
    onError?: (err: unknown) => void,
    eventTypes?: string[]
  ): () => void {
    if (!this.base) {
      onError?.(new Error('no API base configured'));
      return () => { /* noop */ };
    }
    const url = this.base + (path.startsWith('/') ? path : '/' + path);
    const es = new EventSource(url);
    const types = eventTypes ?? DEFAULT_WORKFLOW_EVENT_TYPES;
    const safeParse = (ev: MessageEvent<string>): unknown => {
      try { return JSON.parse(ev.data); } catch { return ev.data; }
    };
    const dispatchers: Array<[string, (ev: MessageEvent<string>) => void]> = [];
    for (const t of types) {
      const fn = (ev: MessageEvent<string>) => onEvent(t, safeParse(ev));
      es.addEventListener(t, fn as EventListener);
      dispatchers.push([t, fn]);
    }
    es.onmessage = (ev: MessageEvent<string>) => onEvent('message', safeParse(ev));
    es.onerror = (e: Event) => { onError?.(e); };
    return () => {
      for (const [t, fn] of dispatchers) es.removeEventListener(t, fn as EventListener);
      es.close();
    };
  }
}

/**
 * Rich error thrown by ApiService when the backend returns a non-2xx
 * status. The HTTP status and the parsed `code` field (e.g. `no_project`,
 * `no_primary`) are stashed on the error so consumers can branch on them
 * without parsing the message text.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    public readonly path: string,
    public readonly payload: unknown,
    message: string,
  ) { super(message); }
}

async function buildApiError(method: 'GET' | 'POST' | 'PUT', path: string, res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let payload: unknown = null;
  let code: string | null = null;
  if (text) {
    try {
      payload = JSON.parse(text);
      if (payload && typeof payload === 'object' && 'code' in (payload as Record<string, unknown>)) {
        const c = (payload as { code?: unknown }).code;
        if (typeof c === 'string') code = c;
      }
    } catch { payload = text; }
  }
  return new ApiError(res.status, code, path, payload, `${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
}

const DEFAULT_WORKFLOW_EVENT_TYPES: ReadonlyArray<string> = [
  'run_started', 'run_completed', 'run_failed', 'run_cancelled', 'run_paused',
  'step_started', 'step_completed', 'step_failed', 'step_skipped',
  'tool_called', 'artifact_created',
  'approval_requested', 'approval_granted', 'approval_rejected',
  'done',
];
