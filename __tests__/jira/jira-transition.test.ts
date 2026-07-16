import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import {
  handleSpecshipJiraTransition,
  validateConfiguredTransitions,
  type TransitionValidationClient,
} from '../../src/mcp/jira-tools';
import { JiraClient } from '../../src/jira/client';
import type { JiraIssueListResult } from '../../src/jira/types';

/**
 * JIRATRANS-DOC — first-class transition control + configured-transition
 * visibility.
 *
 * REQ-JIRATRANS-001 (handler): apply a transition, list transitions with no
 * target, skip (naming available states) an unavailable target, surface a
 * credential-free error on a host fault — never a throw, never a token.
 * REQ-JIRATRANS-002 (validateConfiguredTransitions): report per configured
 * lifecycle name whether the sampled issue offers it; "couldn't verify" when
 * nothing can be sampled — never a false "missing".
 *
 * The handler builds its own JiraClient, so it runs against a stubbed fetch and
 * env-only credentials pointed at a non-existent config file (no real host, no
 * token). The validator takes an injected client — a pure fake.
 */

const JIRA_ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_DEPLOYMENT',
];

let saved: Record<string, string | undefined>;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

/** @verifies REQ-JIRATRANS-001 */
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
    { id: '11', name: 'To Do' },
    { id: '21', name: 'In Progress' },
    { id: '41', name: 'Done' },
  ],
};

const textOf = (r: { content: Array<{ text: string }> }) =>
  r.content.map((c) => c.text).join('\n');

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Env-only Cloud creds; point config at a path that doesn't exist so the
  // real ~/.specship/jira.json is never read.
  process.env.SPECSHIP_JIRA_CONFIG = path.join(os.tmpdir(), 'no-such-jira-cfg.json');
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'jane@acme.com';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok-secret-123';
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('handleSpecshipJiraTransition (REQ-JIRATRANS-001)', () => {
  it('A1/A2: applies a transition and reports the state it moved to', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(200, TRANSITIONS)) // GET transitions
      .mockResolvedValueOnce(resp(204, {})); // POST transition
    const r = await handleSpecshipJiraTransition({ key: 'PROJ-1', state: 'in progress' });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toBe('Moved PROJ-1 to "In Progress".');
    // POSTed the resolved id.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ transition: { id: '21' } });
  });

  it('A3: with no state, lists the available transitions', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, TRANSITIONS));
    const r = await handleSpecshipJiraTransition({ key: 'PROJ-1' });
    expect(textOf(r)).toBe('PROJ-1 can transition to: To Do, In Progress, Done.');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the GET, no write
  });

  it('A4: a target the workflow does not offer is skipped, names the available states, writes nothing, never throws', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, TRANSITIONS));
    const r = await handleSpecshipJiraTransition({ key: 'PROJ-1', state: 'In Review' });
    expect(r.isError).toBeFalsy();
    const t = textOf(r);
    expect(t).toMatch(/Did not transition PROJ-1/);
    expect(t).toMatch(/no "In Review" transition/i);
    expect(t).toMatch(/To Do, In Progress, Done/); // available states named
    expect(fetchMock).toHaveBeenCalledTimes(1); // GET only — nothing written
  });

  it('A5: an auth fault surfaces a credential-free error with no token', async () => {
    fetchMock.mockResolvedValueOnce(resp(401, { message: 'unauthorized' }));
    const r = await handleSpecshipJiraTransition({ key: 'PROJ-1', state: 'Done' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).not.toMatch(/tok-secret-123/);
  });

  it('a missing key returns a usage pointer, not a stack', async () => {
    const r = await handleSpecshipJiraTransition({});
    expect(textOf(r)).toMatch(/An issue key is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// A fake client for the validator — no network.
/** @verifies REQ-JIRATRANS-002 */
function fakeClient(opts: {
  issues?: Array<{ key: string }>;
  transitionsByKey?: Record<string, Array<{ id: string; name: string }>>;
  throwOnList?: boolean;
  throwOnTransitions?: boolean;
}): TransitionValidationClient {
  return {
    async listMyIssues(): Promise<JiraIssueListResult> {
      if (opts.throwOnList) throw new Error('boom');
      return {
        ok: true,
        issues: (opts.issues ?? []).map((i) => ({
          key: i.key,
          id: '1',
          summary: '',
          status: '',
          issueType: '',
        })),
      };
    },
    async listTransitions(key: string) {
      if (opts.throwOnTransitions) throw new Error('boom');
      return opts.transitionsByKey?.[key] ?? [];
    },
  };
}

const CONFIG = { inProgress: 'In Progress', inReview: 'In Review', done: 'Done' };

describe('validateConfiguredTransitions (REQ-JIRATRANS-002)', () => {
  it('A1: reports per configured transition whether the sampled issue offers it', async () => {
    // TSHIP-style workflow: To Do / In Progress / Done — no "In Review".
    const client = fakeClient({
      issues: [{ key: 'TSHIP-2' }],
      transitionsByKey: { 'TSHIP-2': [{ id: '1', name: 'To Do' }, { id: '2', name: 'In Progress' }, { id: '4', name: 'Done' }] },
    });
    const v = await validateConfiguredTransitions(client, CONFIG);
    expect(v.verified).toBe(true);
    expect(v.sampleKey).toBe('TSHIP-2');
    expect(v.available).toEqual(['To Do', 'In Progress', 'Done']);
    expect(v.checks).toEqual([
      { role: 'inProgress', configured: 'In Progress', found: true },
      { role: 'inReview', configured: 'In Review', found: false },
      { role: 'done', configured: 'Done', found: true },
    ]);
  });

  it('A1: matching is case-insensitive', async () => {
    const client = fakeClient({
      issues: [{ key: 'P-1' }],
      transitionsByKey: { 'P-1': [{ id: '1', name: 'in progress' }, { id: '2', name: 'DONE' }, { id: '3', name: 'in review' }] },
    });
    const v = await validateConfiguredTransitions(client, CONFIG);
    expect(v.checks.every((c) => c.found)).toBe(true);
  });

  it('A3: when every configured transition resolves, all checks are found', async () => {
    const client = fakeClient({
      issues: [{ key: 'P-1' }],
      transitionsByKey: { 'P-1': [{ id: '1', name: 'In Progress' }, { id: '2', name: 'In Review' }, { id: '3', name: 'Done' }] },
    });
    const v = await validateConfiguredTransitions(client, CONFIG);
    expect(v.verified).toBe(true);
    expect(v.checks.map((c) => c.found)).toEqual([true, true, true]);
  });

  it('A4: no issue to sample → verified:false, never a false "missing"', async () => {
    const v = await validateConfiguredTransitions(fakeClient({ issues: [] }), CONFIG);
    expect(v.verified).toBe(false);
    expect(v.sampleKey).toBeNull();
    expect(v.checks).toEqual([]);
  });

  it('A4: a listMyIssues fault → verified:false, never throws', async () => {
    const v = await validateConfiguredTransitions(fakeClient({ throwOnList: true }), CONFIG);
    expect(v.verified).toBe(false);
  });

  it('A4: an unreadable transitions list → verified:false (couldn\'t verify), never throws', async () => {
    const client = fakeClient({ issues: [{ key: 'P-1' }], throwOnTransitions: true });
    const v = await validateConfiguredTransitions(client, CONFIG);
    expect(v.verified).toBe(false);
    expect(v.sampleKey).toBe('P-1');
  });

  it('honors an explicit sampleKey without listing issues', async () => {
    const client = fakeClient({
      transitionsByKey: { 'X-9': [{ id: '1', name: 'Done' }] },
    });
    const v = await validateConfiguredTransitions(client, CONFIG, { sampleKey: 'X-9' });
    expect(v.sampleKey).toBe('X-9');
    expect(v.checks.find((c) => c.role === 'done')?.found).toBe(true);
  });
});

describe('REQ-JIRATRANS-002.A2 — the skip reason carries the note content', () => {
  it('transitionIssue skip reason names the missing transition AND the available states', async () => {
    // This is exactly the string pushJiraReviewStatus surfaces on a skipped
    // completion push, so the note names both the missing transition and the
    // states the workflow offers.
    fetchMock.mockResolvedValueOnce(resp(200, TRANSITIONS));
    const client = new JiraClient({
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: 'tok-secret-123',
    });
    const res = await client.transitionIssue('PROJ-1', 'In Review');
    expect('skipped' in res).toBe(true);
    if ('reason' in res) {
      expect(res.reason).toMatch(/no "In Review" transition/i);
      expect(res.reason).toMatch(/To Do, In Progress, Done/);
    }
  });
});
