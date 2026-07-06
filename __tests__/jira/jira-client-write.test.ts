import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JiraClient } from '../../src/jira/client';
import {
  JiraAuthError,
  JiraConfigError,
  JiraNotFoundError,
  type JiraCredentials,
} from '../../src/jira/types';

/**
 * REQ-JIRA-007 — the JiraClient write path (transitions, assignee, comment):
 *   - transitionIssue matches by id or case-insensitive name and POSTs it,
 *   - a missing transition returns { skipped } and NEVER throws (A3),
 *   - assignIssue keys by accountId (Cloud) / name (Data Center),
 *   - addComment posts the body,
 *   - write() carries every guard request() has: redirect refused,
 *     401/403 → auth, 404 → not-found, non-2xx → config, and leaks no token.
 * Uses a stubbed fetch; no network, no real host.
 */

const CLOUD: JiraCredentials = {
  baseUrl: 'https://acme.atlassian.net/',
  deployment: 'cloud',
  email: 'jane@acme.com',
  apiToken: 'tok-secret-123',
};

const DC: JiraCredentials = {
  baseUrl: 'https://jira.acme.internal',
  deployment: 'datacenter',
  pat: 'pat-secret-abc',
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

function resp(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    type: 'default',
    json: async () => body,
    headers: new Headers(),
  };
}

const TRANSITIONS = {
  transitions: [
    { id: '21', name: 'In Progress' },
    { id: '31', name: 'In Review' },
  ],
};

describe('JiraClient.transitionIssue', () => {
  it('matches by case-insensitive name and POSTs the transition id', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(200, TRANSITIONS)) // GET transitions
      .mockResolvedValueOnce(resp(204, {})); // POST transition
    const client = new JiraClient(CLOUD);

    const result = await client.transitionIssue('PROJ-1', 'in progress');

    expect(result).toEqual({ ok: true, transitioned: 'In Progress' });
    // GET then POST, both to the same host + issue transitions endpoint.
    const [getUrl] = fetchMock.mock.calls[0];
    expect(getUrl).toBe(
      'https://acme.atlassian.net/rest/api/2/issue/PROJ-1/transitions',
    );
    const [postUrl, postOpts] = fetchMock.mock.calls[1];
    expect(postUrl).toBe(
      'https://acme.atlassian.net/rest/api/2/issue/PROJ-1/transitions',
    );
    expect(postOpts.method).toBe('POST');
    expect(postOpts.redirect).toBe('manual');
    expect(postOpts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(postOpts.body)).toEqual({ transition: { id: '21' } });
  });

  it('matches by exact transition id', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(200, TRANSITIONS))
      .mockResolvedValueOnce(resp(204, {}));
    const client = new JiraClient(CLOUD);

    const result = await client.transitionIssue('PROJ-1', '31');

    expect(result).toEqual({ ok: true, transitioned: 'In Review' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      transition: { id: '31' },
    });
  });

  it('A3: a missing transition returns { skipped } and never POSTs or throws', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, TRANSITIONS));
    const client = new JiraClient(CLOUD);

    const result = await client.transitionIssue('PROJ-1', 'Done');

    expect('skipped' in result && result.skipped).toBe('Done');
    expect('reason' in result && result.reason).toMatch(/no "Done" transition/i);
    // Only the GET fired — no POST for a transition that doesn't exist.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a blank target skips without any network call', async () => {
    const client = new JiraClient(CLOUD);
    const result = await client.transitionIssue('PROJ-1', '   ');
    expect('skipped' in result).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates a genuine auth failure on the transitions read', async () => {
    fetchMock.mockResolvedValueOnce(resp(401, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.transitionIssue('PROJ-1', 'In Progress')).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });
});

describe('JiraClient.assignIssue', () => {
  it('Cloud: PUTs { accountId } to the assignee endpoint', async () => {
    fetchMock.mockResolvedValueOnce(resp(204, {}));
    const client = new JiraClient(CLOUD);

    await client.assignIssue('PROJ-1', 'acct-1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/2/issue/PROJ-1/assignee');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ accountId: 'acct-1' });
  });

  it('Data Center: PUTs { name } instead of { accountId }', async () => {
    fetchMock.mockResolvedValueOnce(resp(204, {}));
    const client = new JiraClient(DC);

    await client.assignIssue('PROJ-1', 'jdoe');

    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ name: 'jdoe' });
  });
});

describe('JiraClient.addComment', () => {
  it('POSTs { body } to the comment endpoint', async () => {
    fetchMock.mockResolvedValueOnce(resp(201, { id: 'c1' }));
    const client = new JiraClient(CLOUD);

    await client.addComment('PROJ-1', 'SpecShip raised a pull request: https://x/y/1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/2/issue/PROJ-1/comment');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      body: 'SpecShip raised a pull request: https://x/y/1',
    });
  });
});

describe('JiraClient write() security guards', () => {
  it('refuses a redirect on a write instead of following it', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      type: 'default',
      headers: new Headers({ location: 'https://evil.example.com/' }),
      json: async () => ({}),
    } as Partial<Response>);
    const client = new JiraClient(CLOUD);
    await expect(client.addComment('PROJ-1', 'x')).rejects.toBeInstanceOf(
      JiraConfigError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 401 on a write to JiraAuthError', async () => {
    fetchMock.mockResolvedValueOnce(resp(401, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.addComment('PROJ-1', 'x')).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });

  it('maps 404 on a write to JiraNotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(resp(404, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.addComment('PROJ-1', 'x')).rejects.toBeInstanceOf(
      JiraNotFoundError,
    );
  });

  it('maps a network failure on a write to JiraConfigError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new JiraClient(CLOUD);
    await expect(client.addComment('PROJ-1', 'x')).rejects.toBeInstanceOf(
      JiraConfigError,
    );
  });

  it('never leaks the credential in a thrown write error', async () => {
    fetchMock.mockResolvedValueOnce(resp(401, {}));
    const client = new JiraClient(CLOUD);
    try {
      await client.addComment('PROJ-1', 'x');
      throw new Error('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('tok-secret-123');
      expect(msg).not.toContain('Basic ');
    }
  });
});
