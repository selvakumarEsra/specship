/**
 * JIRA transport contract tests (REQ-TVIZ-002).
 *
 * Every other file in this suite replaces `globalThis.fetch`, so the client's
 * logic is well covered but its *transport* is not: header assembly, real JSON
 * framing, `redirect: 'manual'`, a non-JSON error page, and a refused
 * connection are all mocked away. These tests drive the production
 * `JiraClient` over a real socket against a local HTTP stub
 * (`fixtures/jira-stub-server.ts`) — the real `fetch`, untouched.
 *
 *   A1 — happy paths: auth, issue read, publish, reconcile.
 *   A2 — negative transport: 401, 429, 5xx, and an HTML (non-JSON) error body,
 *        each surfacing a typed JiraError rather than crashing.
 *
 * No production code was changed to make this possible: `JiraClient` builds
 * URLs from its configured base URL with no scheme constraint, so an
 * `http://127.0.0.1:<port>` base is enough. (The TLS path in `sendViaTls` is
 * `https`-only by construction and stays covered by `jira-tls.test.ts`.)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { JiraClient } from '../../src/jira/client';
import {
  JiraAuthError,
  JiraConfigError,
  JiraNotFoundError,
  JiraError,
  type JiraCredentials,
} from '../../src/jira/types';
import {
  publishSpecToJira,
  buildIssueFields,
  issueContentFingerprint,
  subtaskSummary,
  type SpecPublishSource,
} from '../../src/jira/publish';
import { diffIssueVsSpec, reportHasDivergence } from '../../src/jira/reconcile';
import {
  startJiraStub,
  jiraIssue,
  jiraSearchResult,
  type JiraStub,
} from './fixtures/jira-stub-server';

const API_TOKEN = 'super-secret-token-value';
const PAT = 'super-secret-pat-value';

let stub: JiraStub;

beforeAll(async () => {
  stub = await startJiraStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  stub.reset();
});

function cloudClient(): JiraClient {
  const creds: JiraCredentials = {
    baseUrl: stub.url,
    deployment: 'cloud',
    email: 'jane@acme.com',
    apiToken: API_TOKEN,
    project: 'PROJ',
  };
  return new JiraClient(creds);
}

function datacenterClient(): JiraClient {
  const creds: JiraCredentials = {
    baseUrl: stub.url,
    deployment: 'datacenter',
    pat: PAT,
    project: 'PROJ',
  };
  return new JiraClient(creds);
}

/** Assert a thrown JIRA error is typed and leaks no credential. */
function expectTypedAndCredentialFree(err: unknown): JiraError {
  expect(err).toBeInstanceOf(JiraError);
  const e = err as JiraError;
  expect(typeof e.code).toBe('string');
  expect(e.code.length).toBeGreaterThan(0);
  const text = `${e.name} ${e.message} ${e.stack ?? ''}`;
  expect(text).not.toContain(API_TOKEN);
  expect(text).not.toContain(PAT);
  expect(text).not.toContain('Basic ');
  expect(text).not.toContain('Bearer ');
  return e;
}

/** Run `fn`, returning whatever it threw. Fails the test if it resolves. */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject, but it resolved');
}

// ---------------------------------------------------------------------------
// A1 — happy paths over real HTTP
// ---------------------------------------------------------------------------

describe('JIRA contract — auth over real HTTP (REQ-TVIZ-002.A1)', () => {
  it('testConnection succeeds and sends Basic auth for Cloud (REQ-TVIZ-002.A1)', async () => {
    const result = await cloudClient().testConnection();
    expect(result.ok).toBe(true);
    expect(result.accountId).toBe('acct-1');
    expect(result.displayName).toBe('Jane Dev');

    // The header really travelled — this is the bit a fetch mock can't prove.
    const [req] = stub.requestsFor('GET', '/rest/api/2/myself');
    expect(req).toBeDefined();
    const expected = `Basic ${Buffer.from(`jane@acme.com:${API_TOKEN}`).toString('base64')}`;
    expect(req!.headers.authorization).toBe(expected);
    expect(req!.headers.accept).toContain('application/json');
  });

  it('testConnection sends Bearer auth for Data Center (REQ-TVIZ-002.A1)', async () => {
    const result = await datacenterClient().testConnection();
    // Data Center has no accountId; the client falls back to key/name.
    expect(result.ok).toBe(true);
    expect(result.accountId).toBe('acct-1');

    const [req] = stub.requestsFor('GET', '/rest/api/2/myself');
    expect(req!.headers.authorization).toBe(`Bearer ${PAT}`);
  });

  it('listMyIssues returns mapped issues from a real response body (REQ-TVIZ-002.A1)', async () => {
    const result = await cloudClient().listMyIssues({ project: 'PROJ' });
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2']);
    expect(result.issues[0]!.status).toBe('To Do');
    expect(result.issues[0]!.issueType).toBe('Story');

    // Cloud hits the enhanced-search endpoint; the JQL rides the query string.
    const [req] = stub.requestsFor('GET', '/rest/api/2/search/jql');
    expect(req).toBeDefined();
    const jql = new URL(`http://x${req!.url}`).searchParams.get('jql');
    expect(jql).toContain('assignee = currentUser()');
    expect(jql).toContain('project = "PROJ"');
  });

  it('Data Center uses the classic /search endpoint (REQ-TVIZ-002.A1)', async () => {
    const result = await datacenterClient().listMyIssues();
    expect(result.ok).toBe(true);
    expect(stub.requestsFor('GET', '/rest/api/2/search').length).toBe(1);
    expect(stub.requestsFor('GET', '/rest/api/2/search/jql').length).toBe(0);
  });

  it('getIssue maps summary/description/status/subtasks/parent (REQ-TVIZ-002.A1)', async () => {
    stub.setRoute('GET /rest/api/2/issue/*', {
      status: 200,
      body: jiraIssue({
        key: 'PROJ-42',
        summary: 'Rate-limit failed logins',
        description: 'The login endpoint rejects more than 5 attempts.',
        status: 'In Progress',
        issueType: 'Story',
        parentKey: 'PROJ-7',
        subtasks: [
          { key: 'PROJ-43', summary: 'A 6th attempt returns 429', status: 'Done' },
          { key: 'PROJ-44', summary: 'The counter resets after 60s' },
        ],
      }),
    });

    const { ok, issue } = await cloudClient().getIssue('PROJ-42');
    expect(ok).toBe(true);
    expect(issue.key).toBe('PROJ-42');
    expect(issue.summary).toBe('Rate-limit failed logins');
    expect(issue.description).toContain('rejects more than 5 attempts');
    expect(issue.status).toBe('In Progress');
    expect(issue.parentKey).toBe('PROJ-7');
    expect(issue.subtasks?.map((s) => s.key)).toEqual(['PROJ-43', 'PROJ-44']);
    expect(issue.subtasks?.[0]!.status).toBe('Done');

    // The key is URL-encoded into a single path segment.
    const [req] = stub.requestsFor('GET', '/rest/api/2/issue/*');
    expect(req!.pathname).toBe('/rest/api/2/issue/PROJ-42');
  });

  it('getIssue URL-encodes a key containing a slash (REQ-TVIZ-002.A1)', async () => {
    stub.setRoute('GET /rest/api/2/issue/*', { status: 200, body: jiraIssue({ key: 'PROJ-1' }) });
    await cloudClient().getIssue('PROJ/../admin');
    const [req] = stub.requestsFor('GET', '/rest/api/2/issue/*');
    // No path traversal reached the server — the slash stayed encoded.
    expect(req!.pathname).toBe('/rest/api/2/issue/PROJ%2F..%2Fadmin');
  });

  it('publish creates a Story and one Sub-task per criterion (REQ-TVIZ-002.A1)', async () => {
    const source: SpecPublishSource = {
      specId: 'REQ-AUTH-005',
      title: 'Failed login attempts must be rate-limited',
      body: 'The login endpoint rejects more than 5 failed attempts per IP per minute.',
      specRelPath: 'specs/auth.md',
      acceptance: [
        { id: 'REQ-AUTH-005.A1', text: 'A 6th failed attempt within 60s returns 429.' },
        { id: 'REQ-AUTH-005.A2', text: 'The counter resets after 60s of quiet.' },
      ],
    };

    // The real client is the injected publish client — the publish path runs
    // end to end over HTTP.
    const result = await publishSpecToJira(cloudClient(), source, { projectKey: 'PROJ' }, null);

    expect(result.created).toBe(true);
    expect(result.key).toBe('PROJ-100');
    expect(result.subtasksCreated).toBe(2);

    const posts = stub.requestsFor('POST', '/rest/api/2/issue');
    expect(posts.length).toBe(3); // 1 Story + 2 Sub-tasks

    const story = posts[0]!;
    expect(story.headers['content-type']).toContain('application/json');
    expect(story.body.fields.project.key).toBe('PROJ');
    expect(story.body.fields.issuetype.name).toBe('Story');
    expect(story.body.fields.summary).toBe(source.title);
    expect(story.body.fields.description).toContain('specs/auth.md');

    const subtasks = posts.slice(1);
    expect(subtasks.map((s) => s.body.fields.summary)).toEqual(
      source.acceptance.map((a) => subtaskSummary(a.text)),
    );
    for (const st of subtasks) {
      expect(st.body.fields.issuetype.name).toBe('Sub-task');
      expect(st.body.fields.parent.key).toBe('PROJ-100');
    }

    // Nothing the client sent carries the credential in the body.
    for (const p of posts) expect(p.rawBody).not.toContain(API_TOKEN);
  });

  it('re-publishing updates in place and skips existing Sub-tasks (REQ-TVIZ-002.A1)', async () => {
    const source: SpecPublishSource = {
      specId: 'REQ-AUTH-005',
      title: 'Failed login attempts must be rate-limited',
      body: 'Body.',
      specRelPath: 'specs/auth.md',
      acceptance: [
        { id: 'REQ-AUTH-005.A1', text: 'A 6th failed attempt within 60s returns 429.' },
        { id: 'REQ-AUTH-005.A2', text: 'The counter resets after 60s of quiet.' },
      ],
    };
    // JIRA already has the first criterion as a Sub-task.
    stub.setRoute('GET /rest/api/2/issue/*', {
      status: 200,
      body: jiraIssue({
        key: 'PROJ-9',
        subtasks: [{ key: 'PROJ-10', summary: subtaskSummary(source.acceptance[0]!.text) }],
      }),
    });

    const result = await publishSpecToJira(cloudClient(), source, { projectKey: 'PROJ' }, 'PROJ-9');

    expect(result.created).toBe(false);
    expect(result.key).toBe('PROJ-9');
    expect(result.subtasksCreated).toBe(1); // only the missing one

    // The update really went out as a PUT that the stub answered with 204 —
    // the empty-body success path a fetch mock rarely models.
    const puts = stub.requestsFor('PUT', '/rest/api/2/issue/*');
    expect(puts.length).toBe(1);
    expect(puts[0]!.body.fields.summary).toBe(source.title);

    const posts = stub.requestsFor('POST', '/rest/api/2/issue');
    expect(posts.length).toBe(1);
    expect(posts[0]!.body.fields.summary).toBe(subtaskSummary(source.acceptance[1]!.text));
  });

  it('reconcile reads the live issue and reports divergence (REQ-TVIZ-002.A1)', async () => {
    const spec = {
      specRelPath: 'specs/auth.md',
      requirementId: 'REQ-AUTH-005',
      title: 'Failed login attempts must be rate-limited',
      body: 'The login endpoint rejects more than 5 failed attempts per IP per minute.',
      acceptance: [{ id: 'REQ-AUTH-005.A1', text: 'A 6th failed attempt within 60s returns 429.' }],
    };
    const published = buildIssueFields({
      specId: spec.requirementId,
      title: spec.title,
      body: spec.body,
      specRelPath: spec.specRelPath,
      acceptance: spec.acceptance,
    });
    const storedFingerprint = issueContentFingerprint(published.summary, published.description);

    // Someone edited the summary in JIRA and added a Sub-task by hand.
    stub.setRoute('GET /rest/api/2/issue/*', {
      status: 200,
      body: jiraIssue({
        key: 'PROJ-9',
        summary: 'Rate limiting — edited in JIRA',
        description: published.description,
        subtasks: [
          { key: 'PROJ-10', summary: subtaskSummary(spec.acceptance[0]!.text) },
          { key: 'PROJ-11', summary: 'Also log the offending IP' },
        ],
      }),
    });

    const { issue } = await cloudClient().getIssue('PROJ-9');
    const report = diffIssueVsSpec(issue, spec, storedFingerprint);

    expect(reportHasDivergence(report)).toBe(true);
    expect(report.content?.liveSummary).toBe('Rate limiting — edited in JIRA');
    expect(report.content?.storedFingerprint).toBe(storedFingerprint);
    expect(report.content?.liveFingerprint).not.toBe(storedFingerprint);
    // The hand-added Sub-task becomes a proposed new criterion; the one publish
    // itself wrote is recognized as in-sync.
    expect(report.subtasks.length).toBe(1);
    expect(report.subtasks[0]!.subtaskKey).toBe('PROJ-11');
    expect(report.subtasks[0]!.proposedCriterionId).toBe('REQ-AUTH-005.A2');
  });

  it('reconcile reports clean when JIRA matches the spec (REQ-TVIZ-002.A1)', async () => {
    const spec = {
      specRelPath: 'specs/auth.md',
      requirementId: 'REQ-AUTH-005',
      title: 'Failed login attempts must be rate-limited',
      body: 'Body text.',
      acceptance: [{ id: 'REQ-AUTH-005.A1', text: 'A 6th failed attempt returns 429.' }],
    };
    const published = buildIssueFields({ ...spec, specId: spec.requirementId });
    const fp = issueContentFingerprint(published.summary, published.description);

    stub.setRoute('GET /rest/api/2/issue/*', {
      status: 200,
      body: jiraIssue({
        key: 'PROJ-9',
        summary: published.summary,
        description: published.description,
        subtasks: [{ key: 'PROJ-10', summary: subtaskSummary(spec.acceptance[0]!.text) }],
      }),
    });

    const { issue } = await cloudClient().getIssue('PROJ-9');
    expect(reportHasDivergence(diffIssueVsSpec(issue, spec, fp))).toBe(false);
  });

  it('a 204 transition write resolves rather than failing on an empty body (REQ-TVIZ-002.A1)', async () => {
    const result = await cloudClient().transitionIssue('PROJ-1', 'Done');
    expect(result).toEqual({ ok: true, transitioned: 'Done' });
    // The name was resolved to an id against the live transition list, and the
    // stub's 204 (genuinely empty body) did not trip the JSON parse.
    const [post] = stub.requestsFor('POST', '/rest/api/2/issue/*/transitions');
    expect(post!.body.transition.id).toBe('31');
  });

  it('an unavailable transition is skipped, never thrown (REQ-TVIZ-002.A1)', async () => {
    stub.setRoute('GET /rest/api/2/issue/*/transitions', {
      status: 200,
      body: { transitions: [{ id: '11', name: 'In Progress' }] },
    });
    const result = await cloudClient().transitionIssue('PROJ-1', 'Released');
    expect(result.ok).toBe(true);
    // `skipped` carries the transition that wasn't available, not a boolean.
    expect('skipped' in result && result.skipped).toBe('Released');
    expect('skipped' in result && result.reason).toContain('In Progress');
    expect(stub.requestsFor('POST', '/rest/api/2/issue/*/transitions').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A2 — negative transport
// ---------------------------------------------------------------------------

describe('JIRA contract — negative transport (REQ-TVIZ-002.A2)', () => {
  it('401 surfaces JiraAuthError, not a crash (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/myself', {
      status: 401,
      body: { errorMessages: ['Client must be authenticated to access this resource.'], errors: {} },
    });
    const err = await captureThrow(() => cloudClient().testConnection());
    expectTypedAndCredentialFree(err);
    expect(err).toBeInstanceOf(JiraAuthError);
    expect((err as JiraAuthError).message).toContain('401');
  });

  it('403 surfaces JiraAuthError on a read (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/issue/*', { status: 403, body: { errorMessages: ['Forbidden'] } });
    const err = await captureThrow(() => cloudClient().getIssue('PROJ-1'));
    expectTypedAndCredentialFree(err);
    expect(err).toBeInstanceOf(JiraAuthError);
  });

  it('404 surfaces JiraNotFoundError (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/issue/*', {
      status: 404,
      body: { errorMessages: ['Issue does not exist or you do not have permission to see it.'] },
    });
    const err = await captureThrow(() => cloudClient().getIssue('PROJ-999'));
    expectTypedAndCredentialFree(err);
    expect(err).toBeInstanceOf(JiraNotFoundError);
  });

  it('429 surfaces JiraConfigError and is NOT retried (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/search/jql', {
      status: 429,
      headers: { 'Retry-After': '30' },
      body: { errorMessages: ['Rate limit exceeded'], errors: {} },
    });
    const err = await captureThrow(() => cloudClient().listMyIssues());
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('429');
    // The client implements no retry/backoff today. Pinning that here means a
    // future retry policy has to update this test consciously rather than
    // silently multiplying every rate-limited call.
    expect(stub.requestsFor('GET', '/rest/api/2/search/jql').length).toBe(1);
  });

  it('500 surfaces JiraConfigError carrying JIRA’s own detail (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/myself', {
      status: 500,
      body: { errorMessages: ['Internal server error'], errors: { issuetype: 'The issue type is invalid' } },
    });
    const err = await captureThrow(() => cloudClient().testConnection());
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('500');
    expect(e.message).toContain('Internal server error');
    expect(e.message).toContain('issuetype: The issue type is invalid');
  });

  it('503 on a write surfaces JiraConfigError (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('POST /rest/api/2/issue', { status: 503, body: { errorMessages: ['Service unavailable'] } });
    const err = await captureThrow(() =>
      cloudClient().createIssue({ projectKey: 'PROJ', issueType: 'Story', summary: 'x' }),
    );
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('503');
  });

  it('an HTML error page surfaces JiraConfigError, not a JSON parse crash (REQ-TVIZ-002.A2)', async () => {
    // The classic corporate-proxy / SSO-interstitial failure: HTTP 200 with an
    // HTML login page where JSON was expected.
    stub.setRoute('GET /rest/api/2/myself', {
      status: 200,
      raw: '<!DOCTYPE html><html><head><title>Sign in</title></head><body>SSO required</body></html>',
      contentType: 'text/html; charset=utf-8',
    });
    const err = await captureThrow(() => cloudClient().testConnection());
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('non-JSON');
  });

  it('an HTML body on a 5xx still yields a typed error (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/myself', {
      status: 502,
      raw: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      contentType: 'text/html',
    });
    const err = await captureThrow(() => cloudClient().testConnection());
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    // The unreadable body is tolerated; the status still reaches the user.
    expect(e.message).toContain('502');
  });

  it('a redirect is refused, never followed (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('GET /rest/api/2/myself', {
      status: 302,
      headers: { Location: 'https://evil.example.com/steal' },
      body: {},
    });
    const err = await captureThrow(() => cloudClient().testConnection());
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('redirect');
    // Only the original request happened — `redirect: 'manual'` held.
    expect(stub.requests.length).toBe(1);
  });

  it('a refused connection surfaces JiraConfigError with guidance (REQ-TVIZ-002.A2)', async () => {
    // A port nothing is listening on: a genuine transport fault, not a status.
    const dead = new JiraClient({
      baseUrl: 'http://127.0.0.1:1',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: API_TOKEN,
    });
    const err = await captureThrow(() => dead.testConnection());
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('Could not reach JIRA');
  });

  it('a 2xx create with no key surfaces JiraConfigError (REQ-TVIZ-002.A2)', async () => {
    stub.setRoute('POST /rest/api/2/issue', { status: 201, body: { id: '123' } });
    const err = await captureThrow(() =>
      cloudClient().createIssue({ projectKey: 'PROJ', issueType: 'Story', summary: 'x' }),
    );
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('did not return a key');
  });

  it('a publish that fails mid-flight reports the error, not a partial success (REQ-TVIZ-002.A2)', async () => {
    let calls = 0;
    stub.setRoute('POST /rest/api/2/issue', () => {
      calls++;
      // Story creates fine; the first Sub-task is rejected.
      return calls === 1
        ? { status: 201, body: { id: '1', key: 'PROJ-100' } }
        : { status: 400, body: { errorMessages: [], errors: { issuetype: 'Sub-task is not available' } } };
    });

    const err = await captureThrow(() =>
      publishSpecToJira(
        cloudClient(),
        {
          specId: 'REQ-X-001',
          title: 'A requirement',
          body: 'Body.',
          specRelPath: 'specs/x.md',
          acceptance: [{ id: 'REQ-X-001.A1', text: 'It holds.' }],
        },
        { projectKey: 'PROJ' },
        null,
      ),
    );
    const e = expectTypedAndCredentialFree(err);
    expect(e).toBeInstanceOf(JiraConfigError);
    expect(e.message).toContain('400');
    expect(e.message).toContain('Sub-task is not available');
  });
});
