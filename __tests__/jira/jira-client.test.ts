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

  it('refuses a redirect instead of following it', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      type: 'default',
      headers: new Headers({ location: 'https://evil.example.com/' }),
      json: async () => ({}),
    } as Partial<Response>);
    const client = new JiraClient(CLOUD);
    await expect(client.testConnection()).rejects.toBeInstanceOf(
      JiraConfigError,
    );
    // Only the original host was contacted — no follow-up fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an opaqueredirect response', async () => {
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
