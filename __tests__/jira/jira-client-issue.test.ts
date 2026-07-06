import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JiraClient } from '../../src/jira/client';
import {
  JiraAuthError,
  JiraConfigError,
  JiraNotFoundError,
  type JiraCredentials,
} from '../../src/jira/types';

/**
 * REQ-JIRA-003 — getIssue fetches a single issue by key:
 *   A1: 200 → summary/description/status/type/subtasks mapped.
 *   A2: 404 → JiraNotFoundError; 403 → JiraAuthError (clear no-access, no
 *       downstream work); an empty/absent description tolerated.
 *   Guards: empty key → JiraConfigError; the key is URL-encoded into the path
 *   (a slash/space can't traverse or inject); redirect still refused; the
 *   credential never leaks into a thrown message.
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

/** A JIRA v2 /issue response body. */
function issueResponse(fields: Record<string, unknown>): Partial<Response> {
  return jsonResponse(200, {
    key: 'PROJ-1',
    id: '10001',
    fields,
  });
}

function requestedUrl(): string {
  return String(fetchMock.mock.calls[0][0]);
}

describe('JiraClient.getIssue', () => {
  it('A1: maps summary/description/status/type/subtasks', async () => {
    fetchMock.mockResolvedValue(
      issueResponse({
        summary: 'Fix the thing',
        description: 'A longer body describing the work.',
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        subtasks: [
          {
            key: 'PROJ-2',
            fields: { summary: 'Sub one', status: { name: 'To Do' } },
          },
          {
            key: 'PROJ-3',
            fields: { summary: 'Sub two', status: { name: 'Done' } },
          },
        ],
      }),
    );
    const client = new JiraClient(CLOUD);
    const result = await client.getIssue('PROJ-1');

    expect(result).toEqual({
      ok: true,
      issue: {
        key: 'PROJ-1',
        id: '10001',
        summary: 'Fix the thing',
        status: 'In Progress',
        issueType: 'Bug',
        description: 'A longer body describing the work.',
        subtasks: [
          { key: 'PROJ-2', summary: 'Sub one', status: 'To Do' },
          { key: 'PROJ-3', summary: 'Sub two', status: 'Done' },
        ],
      },
    });

    const url = requestedUrl();
    expect(url).toContain('/rest/api/2/issue/PROJ-1');
    expect(url).toContain('fields=');
    // Auth + no-follow-redirect guards ride the shared request() path.
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.redirect).toBe('manual');
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  it('A1: tolerates a missing description and no subtasks', async () => {
    fetchMock.mockResolvedValue(
      issueResponse({
        summary: 'No body',
        status: { name: 'To Do' },
        issuetype: { name: 'Story' },
      }),
    );
    const client = new JiraClient(CLOUD);
    const result = await client.getIssue('PROJ-1');
    expect(result.issue.description).toBe('');
    expect(result.issue.subtasks).toEqual([]);
  });

  it('guards a non-string (future ADF object) description without printing [object Object]', async () => {
    fetchMock.mockResolvedValue(
      issueResponse({
        summary: 'ADF body',
        description: { type: 'doc', content: [] },
        status: { name: 'To Do' },
        issuetype: { name: 'Story' },
      }),
    );
    const client = new JiraClient(CLOUD);
    const result = await client.getIssue('PROJ-1');
    expect(result.issue.description).toBe('');
    expect(result.issue.description).not.toContain('[object Object]');
  });

  it('URL-encodes the key so a slash cannot traverse the path', async () => {
    fetchMock.mockResolvedValue(
      issueResponse({ summary: 's', status: { name: 'x' }, issuetype: { name: 'y' } }),
    );
    const client = new JiraClient(CLOUD);
    await client.getIssue('PROJ-1/../../secret');
    const url = requestedUrl();
    // The raw slashes must be percent-encoded, not left as path separators.
    expect(url).toContain('/rest/api/2/issue/PROJ-1%2F..%2F..%2Fsecret');
    expect(url).not.toContain('/rest/api/2/issue/PROJ-1/../../secret');
  });

  it('URL-encodes a key containing a space', async () => {
    fetchMock.mockResolvedValue(
      issueResponse({ summary: 's', status: { name: 'x' }, issuetype: { name: 'y' } }),
    );
    const client = new JiraClient(CLOUD);
    await client.getIssue('PROJ 1');
    expect(requestedUrl()).toContain('/rest/api/2/issue/PROJ%201');
  });

  it('A2: maps 404 to JiraNotFoundError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.getIssue('PROJ-999')).rejects.toBeInstanceOf(
      JiraNotFoundError,
    );
  });

  it('A2: maps 403 to JiraAuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    const client = new JiraClient(CLOUD);
    await expect(client.getIssue('PROJ-1')).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });

  it('rejects an empty key with JiraConfigError before any fetch', async () => {
    const client = new JiraClient(CLOUD);
    await expect(client.getIssue('   ')).rejects.toBeInstanceOf(
      JiraConfigError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
    await expect(client.getIssue('PROJ-1')).rejects.toBeInstanceOf(
      JiraConfigError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('REQ-JIRA-009: never leaks the credential in a thrown error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    const client = new JiraClient(CLOUD);
    try {
      await client.getIssue('PROJ-1');
      throw new Error('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('tok-123');
      expect(msg).not.toContain('Basic ');
    }
  });
});
