import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JiraClient } from '../../src/jira/client';
import {
  JiraAuthError,
  JiraConfigError,
  type JiraCredentials,
} from '../../src/jira/types';

/**
 * REQ-JIRA-001.A3 — testConnection maps HTTP outcomes:
 *   200 → result, 401/403 → JiraAuthError, network → JiraConfigError,
 *   redirect → refused (never followed). Uses a stubbed fetch; no network.
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

describe('JiraClient.testConnection', () => {
  it('maps 200 to a connection result and hits /rest/api/2/myself', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { accountId: 'a1', displayName: 'Jane Doe' }),
    );
    const client = new JiraClient(CLOUD);
    const result = await client.testConnection();
    expect(result).toEqual({
      ok: true,
      accountId: 'a1',
      displayName: 'Jane Doe',
    });
    // URL is normalized (single slash) and uses the v2 myself endpoint.
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/2/myself');
    expect(opts.redirect).toBe('manual');
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  it('maps 401 to JiraAuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.testConnection()).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('maps 403 to JiraAuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.testConnection()).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('maps a network failure to JiraConfigError', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const client = new JiraClient(CLOUD);
    await expect(client.testConnection()).rejects.toBeInstanceOf(
      JiraConfigError,
    );
  });

  it('refuses a 3xx redirect instead of following it (REQ-JIRA-009.A2)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      type: 'default',
      headers: new Headers({ location: 'https://evil.example.com/' }),
      json: async () => ({}),
    } as Partial<Response>);
    const client = new JiraClient(CLOUD);
    let thrown: unknown;
    try {
      await client.testConnection();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(JiraConfigError);
    // The one fetch that DID fire opted out of auto-following redirects, so the
    // Authorization header could never be replayed to the redirect target.
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.redirect).toBe('manual');
    // Refused, not followed: exactly one fetch, and it hit only the configured
    // host — never the evil.example.com the Location header pointed at.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://acme.atlassian.net/rest/api/2/myself',
    );
    // The refusal names the configured host but never echoes the credential.
    const msg = (thrown as Error).message;
    expect(msg).toContain('acme.atlassian.net');
    expect(msg).not.toContain('tok-123');
    expect(msg).not.toContain('Basic ');
    expect(msg).not.toContain('evil.example.com');
  });

  it('refuses an opaqueredirect response without a second host hit (REQ-JIRA-009.A2)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 0,
      type: 'opaqueredirect',
      headers: new Headers(),
      json: async () => ({}),
    } as Partial<Response>);
    const client = new JiraClient(CLOUD);
    await expect(client.testConnection()).rejects.toBeInstanceOf(
      JiraConfigError,
    );
    // An opaqueredirect (redirect: 'manual' hid the target) is refused the same
    // way — one fetch, no follow-up to whatever host it pointed at.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.redirect).toBe('manual');
  });

  it('never leaks the credential in a thrown auth error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const client = new JiraClient(CLOUD);
    try {
      await client.testConnection();
      throw new Error('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('tok-123');
      expect(msg).not.toContain('Basic ');
    }
  });

  it('resolves Data Center identity from name/key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { name: 'jdoe', key: 'JIRAUSER1', displayName: 'J Doe' }),
    );
    const client = new JiraClient({
      baseUrl: 'https://jira.acme.internal',
      deployment: 'datacenter',
      pat: 'pat-abc',
    });
    const result = await client.testConnection();
    expect(result.displayName).toBe('J Doe');
    expect(result.accountId).toBe('JIRAUSER1');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer pat-abc');
  });
});

describe('JiraClient.listEpics (REQ-JIRATEAM-006)', () => {
  function searchResponse(
    issues: Array<{ key: string; summary: string; status: string }>,
  ): Partial<Response> {
    return jsonResponse(200, {
      issues: issues.map((i) => ({
        key: i.key,
        fields: { summary: i.summary, status: { name: i.status } },
      })),
    });
  }

  it('scopes the JQL to Epic + statusCategory != Done + project', async () => {
    fetchMock.mockResolvedValue(
      searchResponse([
        { key: 'EPIC-1', summary: 'Q3 billing', status: 'In Progress' },
        { key: 'EPIC-2', summary: 'Onboarding', status: 'To Do' },
      ]),
    );
    const client = new JiraClient(CLOUD);
    const epics = await client.listEpics('PROJ');
    expect(epics).toEqual([
      { key: 'EPIC-1', summary: 'Q3 billing', status: 'In Progress' },
      { key: 'EPIC-2', summary: 'Onboarding', status: 'To Do' },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    const jql = new URL(url).searchParams.get('jql') ?? '';
    expect(jql).toContain('project = "PROJ"');
    expect(jql).toContain('issuetype = Epic');
    expect(jql).toContain('statusCategory != Done');
    expect(jql).toContain('ORDER BY updated DESC');
    // Bounded, credential-carrying request.
    expect(new URL(url).searchParams.get('maxResults')).toMatch(/^\d+$/);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.redirect).toBe('manual');
  });

  it('quote-escapes the project value against JQL injection', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    await new JiraClient(CLOUD).listEpics('PR"OJ');
    const jql =
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('jql') ?? '';
    expect(jql).toContain('project = "PR\\"OJ"');
  });

  it('returns an empty list on 200 with no issues', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    const epics = await new JiraClient(CLOUD).listEpics('PROJ');
    expect(epics).toEqual([]);
  });

  it('maps 401 to JiraAuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    await expect(new JiraClient(CLOUD).listEpics('PROJ')).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });

  it('uses /search on Data Center, /search/jql on Cloud', async () => {
    fetchMock.mockResolvedValue(searchResponse([]));
    await new JiraClient(CLOUD).listEpics('PROJ');
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      '/rest/api/2/search/jql',
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(searchResponse([]));
    await new JiraClient({
      baseUrl: 'https://jira.acme.internal',
      deployment: 'datacenter',
      pat: 'pat-abc',
    }).listEpics('PROJ');
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      '/rest/api/2/search',
    );
  });

  it('rejects an empty project key without a network call', async () => {
    await expect(new JiraClient(CLOUD).listEpics('  ')).rejects.toBeInstanceOf(
      JiraConfigError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
