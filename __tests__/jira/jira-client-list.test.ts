import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JiraClient } from '../../src/jira/client';
import {
  JiraAuthError,
  JiraConfigError,
  type JiraCredentials,
} from '../../src/jira/types';

/**
 * REQ-JIRA-002 — listMyIssues maps the JIRA search endpoint:
 *   A1: assigned issues → key/summary/status/type, JQL uses currentUser().
 *   A2: an optional project filter narrows the JQL (quote-escaped).
 *   A3: empty issues → { ok, issues: [] }, not an error.
 *   A4: 401/403 → JiraAuthError, network → JiraConfigError, redirect refused;
 *       no partial list is ever returned on failure.
 * Uses a stubbed fetch; no network, no credentials.
 */

const CLOUD: JiraCredentials = {
  baseUrl: 'https://acme.atlassian.net/',
  deployment: 'cloud',
  email: 'jane@acme.com',
  apiToken: 'tok-123',
};

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    type: 'default',
    json: async () => body,
    headers: new Headers(),
  };
}

/** A JIRA v2 /search response with the given issues. */
function searchResponse(
  issues: Array<{
    key: string;
    id: string;
    summary: string;
    status: string;
    type: string;
  }>,
): Partial<Response> {
  return jsonResponse(200, {
    issues: issues.map(i => ({
      key: i.key,
      id: i.id,
      fields: {
        summary: i.summary,
        status: { name: i.status },
        issuetype: { name: i.type },
      },
    })),
  });
}

function requestedUrl(): string {
  return String(fetchMock.mock.calls[0][0]);
}

/** The decoded `jql` query param of the first request. */
function requestedJql(): string {
  return new URL(requestedUrl()).searchParams.get('jql') ?? '';
}

describe('JiraClient.listMyIssues', () => {
  it('A1: maps assigned issues and uses currentUser() in the JQL', async () => {
    fetchMock.mockResolvedValue(
      searchResponse([
        {
          key: 'PROJ-1',
          id: '10001',
          summary: 'Fix the thing',
          status: 'In Progress',
          type: 'Bug',
        },
        {
          key: 'PROJ-2',
          id: '10002',
          summary: 'Build the other thing',
          status: 'To Do',
          type: 'Story',
        },
      ]),
    );
    const client = new JiraClient(CLOUD);
    const result = await client.listMyIssues();

    expect(result).toEqual({
      ok: true,
      issues: [
        {
          key: 'PROJ-1',
          id: '10001',
          summary: 'Fix the thing',
          status: 'In Progress',
          issueType: 'Bug',
        },
        {
          key: 'PROJ-2',
          id: '10002',
          summary: 'Build the other thing',
          status: 'To Do',
          issueType: 'Story',
        },
      ],
    });

    const url = requestedUrl();
    expect(url).toContain('/rest/api/2/search');
    // Identity comes from the token, never a typed name.
    const jql = requestedJql();
    expect(jql).toContain('currentUser()');
    expect(jql).toContain('assignee');
    // Most-actionable-first ordering.
    expect(jql).toContain('ORDER BY');
    // Bounded fetch — never unbounded.
    expect(url).toMatch(/maxResults=\d+/);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.redirect).toBe('manual');
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  it('A2: an optional project filter narrows the JQL', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    const client = new JiraClient(CLOUD);
    await client.listMyIssues({ project: 'PROJ' });

    const jql = requestedJql();
    expect(jql).toContain('project = "PROJ"');
    expect(jql).toContain('currentUser()');
  });

  it('A2: quote-escapes a project value to prevent JQL injection', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    const client = new JiraClient(CLOUD);
    await client.listMyIssues({ project: 'PR"OJ' });

    const jql = requestedJql();
    // The embedded quote must be escaped, not left to break out of the string.
    expect(jql).toContain('project = "PR\\"OJ"');
  });

  it('A3: no assigned issues returns an empty list, not an error', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    const client = new JiraClient(CLOUD);
    const result = await client.listMyIssues();
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('A4: maps 401 to JiraAuthError and returns no list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.listMyIssues()).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('A4: maps 403 to JiraAuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.listMyIssues()).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('A4: maps a network failure to JiraConfigError', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const client = new JiraClient(CLOUD);
    await expect(client.listMyIssues()).rejects.toBeInstanceOf(JiraConfigError);
  });

  it('A4: refuses a redirect instead of following it', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      type: 'default',
      headers: new Headers({ location: 'https://evil.example.com/' }),
      json: async () => ({}),
    } as Partial<Response>);
    const client = new JiraClient(CLOUD);
    await expect(client.listMyIssues()).rejects.toBeInstanceOf(JiraConfigError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('A4 / REQ-JIRA-009: never leaks the credential in a thrown error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const client = new JiraClient(CLOUD);
    try {
      await client.listMyIssues();
      throw new Error('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('tok-123');
      expect(msg).not.toContain('Basic ');
    }
  });

  it('caps maxResults at a sane bound (never unbounded)', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    const client = new JiraClient(CLOUD);
    await client.listMyIssues();
    const max = Number(
      new URL(requestedUrl()).searchParams.get('maxResults'),
    );
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(50);
  });
});
