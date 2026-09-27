/**
 * A local HTTP server speaking JIRA REST shapes (REQ-TVIZ-002.A1).
 *
 * The rest of the JIRA suite replaces `globalThis.fetch` with a mock, which
 * proves the client's *logic* but never its *transport* — header assembly,
 * `redirect: 'manual'`, JSON parsing, non-JSON bodies, and connection faults
 * are all stubbed away. This fixture closes that gap: it is a real
 * `http.createServer` on 127.0.0.1, so tests drive the production `JiraClient`
 * over a real socket.
 *
 * `JiraClient` builds its URLs from the configured base URL and passes them
 * straight to `fetch`, with no scheme constraint — so pointing it at
 * `http://127.0.0.1:<port>` needs no production change and no TLS setup.
 *
 * Usage:
 *
 *   const stub = await startJiraStub();
 *   const client = new JiraClient({ baseUrl: stub.url, ... });
 *   stub.setRoute('GET /rest/api/2/myself', { status: 401, body: {...} });
 *   ...
 *   await stub.close();
 */

import * as http from 'http';
import { AddressInfo } from 'net';

/** What a route handler may return. Anything unset falls back to a default. */
export interface StubResponse {
  status?: number;
  /** Serialized as JSON unless `raw` is set. */
  body?: unknown;
  /** Exact bytes to write, bypassing JSON serialization (HTML error pages). */
  raw?: string;
  contentType?: string;
  /** Extra headers — e.g. `Location` for a redirect. */
  headers?: Record<string, string>;
}

/** A recorded inbound request, for asserting what actually went over the wire. */
export interface RecordedRequest {
  method: string;
  /** Path including query string, exactly as received. */
  url: string;
  /** Path only, query stripped. */
  pathname: string;
  headers: http.IncomingHttpHeaders;
  /** Raw request body (empty string for GET). */
  rawBody: string;
  /** Parsed JSON body, or undefined when the body isn't JSON. */
  body?: any;
}

export type StubHandler = (req: RecordedRequest) => StubResponse;

export interface JiraStub {
  /** Base URL to hand to `JiraClient`, e.g. `http://127.0.0.1:54321`. */
  url: string;
  port: number;
  /** Every request the stub received, in order. */
  requests: RecordedRequest[];
  /**
   * Override a route. The key is `"<METHOD> <path>"`; the path may end in `*`
   * to match a prefix (`'GET /rest/api/2/issue/*'`). A `StubResponse` is
   * returned as-is; a function is called per request.
   */
  setRoute(key: string, response: StubResponse | StubHandler): void;
  /** Drop all overrides, restoring the JIRA-shaped defaults. */
  reset(): void;
  /** Requests whose pathname matches (prefix if the pattern ends in `*`). */
  requestsFor(method: string, pathPattern: string): RecordedRequest[];
  close(): Promise<void>;
}

/** A JIRA v2 issue object, in the shape the real API returns. */
export function jiraIssue(over: {
  key?: string;
  id?: string;
  summary?: string;
  description?: string | null;
  status?: string;
  issueType?: string;
  parentKey?: string;
  subtasks?: Array<{ key: string; summary: string; status?: string }>;
} = {}): any {
  return {
    key: over.key ?? 'PROJ-1',
    id: over.id ?? '10001',
    fields: {
      summary: over.summary ?? 'A published story',
      description: over.description === undefined ? 'Story body' : over.description,
      status: { name: over.status ?? 'To Do' },
      issuetype: { name: over.issueType ?? 'Story' },
      ...(over.parentKey ? { parent: { key: over.parentKey } } : {}),
      subtasks: (over.subtasks ?? []).map((st) => ({
        key: st.key,
        fields: { summary: st.summary, status: { name: st.status ?? 'To Do' } },
      })),
    },
  };
}

/** A JIRA v2 `/search` (or `/search/jql`) result envelope. */
export function jiraSearchResult(issues: any[]): any {
  return { startAt: 0, maxResults: 50, total: issues.length, issues };
}

/**
 * True when `pathname` matches `pattern`. `*` is a wildcard anywhere in the
 * pattern: a trailing `*` matches any suffix (`/issue/*`), an interior one
 * matches a single segment (`/issue/*​/transitions`). Interior wildcards are
 * load-bearing — `/rest/api/2/issue/*` would otherwise swallow
 * `/rest/api/2/issue/PROJ-1/transitions` and the transitions routes would
 * never be reached.
 */
function pathMatches(pathname: string, pattern: string): boolean {
  if (!pattern.includes('*')) return pathname === pattern;
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`).test(pathname);
}

/**
 * Default JIRA-shaped responses. Deliberately minimal but structurally real —
 * every field the client reads is present, nested exactly as JIRA nests it.
 */
function defaultRoutes(): Array<[string, StubHandler]> {
  return [
    // Auth probe — Cloud returns accountId, Data Center returns key/name.
    ['GET /rest/api/2/myself', () => ({
      status: 200,
      body: { accountId: 'acct-1', displayName: 'Jane Dev', key: 'jdev', name: 'jdev' },
    })],

    // Search — Cloud uses /search/jql, Data Center /search. Both here.
    ['GET /rest/api/2/search/jql', () => ({
      status: 200,
      body: jiraSearchResult([jiraIssue({ key: 'PROJ-1' }), jiraIssue({ key: 'PROJ-2', summary: 'Second' })]),
    })],
    ['GET /rest/api/2/search', () => ({
      status: 200,
      body: jiraSearchResult([jiraIssue({ key: 'PROJ-1' })]),
    })],

    // Transitions must precede the generic issue route (prefix ordering).
    ['GET /rest/api/2/issue/*/transitions', () => ({
      status: 200,
      body: { transitions: [{ id: '31', name: 'Done' }, { id: '11', name: 'In Progress' }] },
    })],
    ['POST /rest/api/2/issue/*/transitions', () => ({ status: 204 })],
    ['GET /rest/api/2/issue/*/comment', () => ({
      status: 200,
      body: { comments: [{ id: '1', body: 'an existing comment' }] },
    })],
    ['POST /rest/api/2/issue/*/comment', () => ({ status: 201, body: { id: '2' } })],

    // Create returns the new key; the client refuses a keyless 2xx.
    ['POST /rest/api/2/issue', (req) => {
      const summary = String(req.body?.fields?.summary ?? '');
      const isSubtask = String(req.body?.fields?.issuetype?.name ?? '').toLowerCase().includes('sub');
      return {
        status: 201,
        body: {
          id: String(20000 + summary.length),
          key: isSubtask ? 'PROJ-SUB' : 'PROJ-100',
          self: 'http://127.0.0.1/rest/api/2/issue/PROJ-100',
        },
      };
    }],

    // Single issue read.
    ['GET /rest/api/2/issue/*', () => ({ status: 200, body: jiraIssue({ key: 'PROJ-1' }) })],
    // Update — JIRA answers 204 No Content.
    ['PUT /rest/api/2/issue/*', () => ({ status: 204 })],

    ['GET /rest/api/2/project', () => ({
      status: 200,
      body: [{ key: 'PROJ', name: 'The Project' }],
    })],
    ['GET /rest/api/2/project/*', () => ({ status: 200, body: { key: 'PROJ', name: 'The Project' } })],
  ];
}

/** Start the stub on an ephemeral loopback port. */
export async function startJiraStub(): Promise<JiraStub> {
  const overrides = new Map<string, StubResponse | StubHandler>();
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      const url = req.url ?? '/';
      const pathname = url.split('?')[0] ?? '/';
      let parsed: any;
      try { parsed = rawBody ? JSON.parse(rawBody) : undefined; } catch { parsed = undefined; }

      const record: RecordedRequest = {
        method: req.method ?? 'GET',
        url,
        pathname,
        headers: req.headers,
        rawBody,
        body: parsed,
      };
      requests.push(record);

      // Overrides win, in insertion order; then the JIRA-shaped defaults.
      let chosen: StubResponse | StubHandler | undefined;
      for (const [key, value] of overrides) {
        const [method, pattern] = key.split(' ', 2);
        if (method === record.method && pattern && pathMatches(pathname, pattern)) {
          chosen = value;
          break;
        }
      }
      if (chosen === undefined) {
        for (const [key, handler] of defaultRoutes()) {
          const [method, pattern] = key.split(' ', 2);
          if (method === record.method && pattern && pathMatches(pathname, pattern)) {
            chosen = handler;
            break;
          }
        }
      }

      const out: StubResponse =
        chosen === undefined
          ? { status: 404, body: { errorMessages: ['Issue does not exist'], errors: {} } }
          : typeof chosen === 'function'
            ? chosen(record)
            : chosen;

      const status = out.status ?? 200;
      const headers: Record<string, string> = { ...(out.headers ?? {}) };
      let payload = '';
      if (out.raw !== undefined) {
        payload = out.raw;
        headers['Content-Type'] = out.contentType ?? 'text/html; charset=utf-8';
      } else if (out.body !== undefined) {
        payload = JSON.stringify(out.body);
        headers['Content-Type'] = out.contentType ?? 'application/json';
      }
      // 204 carries no body, per HTTP — matches how JIRA answers a PUT.
      if (status === 204) {
        res.writeHead(204, headers);
        res.end();
        return;
      }
      headers['Content-Length'] = String(Buffer.byteLength(payload));
      res.writeHead(status, headers);
      res.end(payload);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    setRoute(key, response) {
      overrides.set(key, response);
    },
    reset() {
      overrides.clear();
      requests.length = 0;
    },
    requestsFor(method, pathPattern) {
      return requests.filter(
        (r) => r.method === method && pathMatches(r.pathname, pathPattern),
      );
    },
    close() {
      return new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
