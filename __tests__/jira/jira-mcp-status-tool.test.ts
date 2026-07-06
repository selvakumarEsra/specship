import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  handleSpecshipJiraStart,
  handleSpecshipJiraPick,
  handleJiraRunCompletion,
  type JiraStartDeps,
  type JiraCompletionDeps,
  type JiraStatusContext,
} from '../../src/mcp/jira-tools';
import type {
  JiraConnectionResult,
  JiraTransitionResult,
} from '../../src/jira/types';
import type { PullRequestOutcome } from '../../src/jira/pull-request';

/**
 * REQ-JIRA-007 — status push at lifecycle moments, wired through the MCP tools:
 *   - A1 on start: the issue is assigned + transitioned toward "in progress"
 *     via the STUBBED client seam (never a real host); a skipped/failed push
 *     does NOT block the workflow from starting (reinforcement 4),
 *   - A2 on PR raised: the issue is transitioned toward "in review" and the PR
 *     link is commented; a skipped transition still comments + reports (A3),
 *   - a failed/rejected run never transitions the issue (REQ-JIRA-005.A2),
 *   - A4: no close/"done" transition is ever driven.
 * No network — the client is a fake; no token is present anywhere.
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
let tmpDir: string;
let projectDir: string;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-status-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-status-proj-'));
  process.env.SPECSHIP_JIRA_CONFIG = path.join(tmpDir, 'absent.json');
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function configureCloud(): void {
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'jane@acme.com';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok-secret-123';
  process.env.SPECSHIP_JIRA_DEPLOYMENT = 'cloud';
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

const FIELDS = {
  summary: 'Add a logout button',
  description: 'Users MUST be able to log out from the header menu.',
  status: { name: 'To Do' },
  issuetype: { name: 'Story' },
};

async function authorSpecFor(key: string): Promise<void> {
  configureCloud();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    type: 'default',
    headers: new Headers(),
    json: async () => ({ key, id: '1', fields: FIELDS }),
  } as Partial<Response>);
  const r = await handleSpecshipJiraPick({ key, projectPath: projectDir });
  expect(r.isError).toBeFalsy();
  fetchMock.mockReset();
}

/** Records the transition/assign/comment calls a status push makes. */
interface FakeClientCalls {
  assign: Array<[string, string]>;
  transition: Array<[string, string]>;
  comment: Array<[string, string]>;
}

/**
 * A fake JiraStatusContext factory. `transitionResult(target)` decides whether
 * each transition succeeds or is skipped, so tests exercise both the matched
 * and the A3 skip path without a host.
 */
function fakeMake(
  calls: FakeClientCalls,
  opts: {
    accountId?: string;
    transitionResult?: (target: string) => JiraTransitionResult;
  } = {},
): () => JiraStatusContext {
  const accountId = opts.accountId ?? 'acct-1';
  const transitionResult =
    opts.transitionResult ??
    ((target: string): JiraTransitionResult => ({ ok: true, transitioned: target }));
  return () => ({
    transitions: { inProgress: 'In Progress', inReview: 'In Review' },
    client: {
      async testConnection(): Promise<JiraConnectionResult> {
        return { ok: true, accountId, displayName: 'Jane Doe' };
      },
      async assignIssue(key: string, id: string): Promise<void> {
        calls.assign.push([key, id]);
      },
      async transitionIssue(
        key: string,
        target: string,
      ): Promise<JiraTransitionResult> {
        calls.transition.push([key, target]);
        return transitionResult(target);
      },
      async addComment(key: string, body: string): Promise<void> {
        calls.comment.push([key, body]);
      },
    },
  });
}

interface StartCall {
  opts: { runMetadata?: Record<string, unknown> };
}

function stubStartDeps(
  run: { id: string; status: string; errorMessage?: string; metadata?: unknown },
  make: () => JiraStatusContext,
  calls: StartCall[],
): JiraStartDeps {
  return {
    specQueries: {},
    projectRoot: projectDir,
    loadWorkflowByName: () => ({ workflow: { name: 'spec-implement' } }),
    WorktreeProvider: class {
      constructor(_sq: unknown) {}
    },
    WorkflowExecutor: class {
      constructor(_sq: unknown, _wt: unknown, _root: string) {}
      async start(_workflow: unknown, o: StartCall['opts']) {
        calls.push({ opts: o });
        return { run };
      }
    },
    getSpecShipDir: (root: string) => path.join(root, '.specship'),
    makeJiraClient: make,
  };
}

describe('handleSpecshipJiraStart status push (REQ-JIRA-007.A1)', () => {
  it('assigns the issue and transitions it toward "in progress"', async () => {
    await authorSpecFor('PROJ-1');
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const deps = stubStartDeps(
      { id: 'run-abc', status: 'paused' },
      fakeMake(cc),
      [],
    );

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    expect(result.isError).toBeFalsy();
    expect(cc.assign).toEqual([['PROJ-1', 'acct-1']]);
    expect(cc.transition).toEqual([['PROJ-1', 'In Progress']]);
    // The push outcome is surfaced in the returned text.
    expect(text(result)).toMatch(/assigned PROJ-1 to you/i);
    expect(text(result)).toMatch(/moved PROJ-1 to "In Progress"/i);
  });

  it('a skipped transition does NOT block the workflow and is reported', async () => {
    await authorSpecFor('PROJ-1');
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const make = fakeMake(cc, {
      transitionResult: (target) => ({
        ok: true,
        skipped: target,
        reason: 'no such transition on this workflow',
      }),
    });
    const startCalls: StartCall[] = [];
    const deps = stubStartDeps({ id: 'run-abc', status: 'paused' }, make, startCalls);

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    // The run still started (executor.start ran) despite the skipped transition.
    expect(result.isError).toBeFalsy();
    expect(startCalls).toHaveLength(1);
    expect(text(result)).toMatch(/didn't transition PROJ-1/i);
    expect(text(result)).toMatch(/plan\/approve gate|approve to proceed/i);
  });

  it('A2 (005): a failed run pushes NO status (issue stays un-transitioned)', async () => {
    await authorSpecFor('PROJ-1');
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const deps = stubStartDeps(
      { id: 'run-fail', status: 'failed', errorMessage: 'plan crashed' },
      fakeMake(cc),
      [],
    );

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    expect(result.isError).toBe(true);
    expect(cc.assign).toEqual([]);
    expect(cc.transition).toEqual([]);
  });

  it('A4: never drives a "done"/close transition on start', async () => {
    await authorSpecFor('PROJ-1');
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const deps = stubStartDeps({ id: 'r', status: 'paused' }, fakeMake(cc), []);
    await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);
    for (const [, target] of cc.transition) {
      expect(target).not.toMatch(/done|close|resolve/i);
    }
  });
});

// --- completion (PR raised) -------------------------------------------------

const PASSING_RUN = {
  id: 'run-done',
  status: 'completed',
  isolationEnvId: 'env-1',
  metadata: {
    jira: { issueKey: 'PROJ-1', title: 'Add a logout button' },
    outputs: { verify: { text: 'VERIFY_RESULT=ran-and-passed' } },
  },
};

function completionDeps(
  make: () => JiraStatusContext,
  raiseOutcome: PullRequestOutcome,
  log: string[],
): JiraCompletionDeps {
  return {
    getIsolationEnvById: () => ({
      branchName: 'specship/PROJ-1-abcd1234',
      workingPath: '/tmp/wt',
      metadata: { repoRoot: projectDir },
    }),
    raisePullRequest: async () => raiseOutcome,
    makeJiraClient: make,
    log: (m: string) => log.push(m),
  };
}

describe('handleJiraRunCompletion status push (REQ-JIRA-007.A2)', () => {
  it('on PR raised: transitions to "in review" and comments the PR link', async () => {
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const log: string[] = [];
    const deps = completionDeps(
      fakeMake(cc),
      { ok: true, url: 'https://gh/acme/repo/pull/7' },
      log,
    );

    const outcome = await handleJiraRunCompletion(PASSING_RUN, deps);

    expect(outcome?.ok).toBe(true);
    expect(cc.transition).toEqual([['PROJ-1', 'In Review']]);
    expect(cc.comment).toHaveLength(1);
    expect(cc.comment[0]![0]).toBe('PROJ-1');
    expect(cc.comment[0]![1]).toContain('https://gh/acme/repo/pull/7');
    expect(log.join('\n')).toMatch(/moved PROJ-1 to "In Review"/i);
  });

  it('A3: a skipped transition still comments the PR link and reports the skip', async () => {
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const log: string[] = [];
    const make = fakeMake(cc, {
      transitionResult: (target) => ({
        ok: true,
        skipped: target,
        reason: 'no "In Review" transition on this issue\'s workflow',
      }),
    });
    const deps = completionDeps(
      make,
      { ok: true, url: 'https://gh/acme/repo/pull/7' },
      log,
    );

    await handleJiraRunCompletion(PASSING_RUN, deps);

    // Transition attempted but skipped — the PR-link comment still posts (A3).
    expect(cc.transition).toEqual([['PROJ-1', 'In Review']]);
    expect(cc.comment).toHaveLength(1);
    const logged = log.join('\n');
    expect(logged).toMatch(/didn't transition PROJ-1/i);
    expect(logged).toMatch(/commented the PR link/i);
  });

  it('a failed PR raise never transitions the issue (stays in-progress)', async () => {
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const log: string[] = [];
    const deps = completionDeps(
      fakeMake(cc),
      { ok: false, reason: 'gh-missing', message: 'gh is not installed' },
      log,
    );

    await handleJiraRunCompletion(PASSING_RUN, deps);

    expect(cc.transition).toEqual([]);
    expect(cc.comment).toEqual([]);
  });

  it('A4: never drives a "done"/close transition on completion', async () => {
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const deps = completionDeps(
      fakeMake(cc),
      { ok: true, url: 'https://gh/acme/repo/pull/7' },
      [],
    );
    await handleJiraRunCompletion(PASSING_RUN, deps);
    for (const [, target] of cc.transition) {
      expect(target).not.toMatch(/done|close|resolve/i);
    }
  });

  it('a run whose verify did not pass raises no PR and pushes no status', async () => {
    const cc: FakeClientCalls = { assign: [], transition: [], comment: [] };
    const log: string[] = [];
    const deps = completionDeps(
      fakeMake(cc),
      { ok: true, url: 'https://gh/acme/repo/pull/7' },
      log,
    );
    const skippedVerify = {
      ...PASSING_RUN,
      metadata: {
        jira: { issueKey: 'PROJ-1' },
        outputs: { verify: { text: 'VERIFY_RESULT=skipped' } },
      },
    };

    const outcome = await handleJiraRunCompletion(skippedVerify, deps);

    expect(outcome).toBeNull();
    expect(cc.transition).toEqual([]);
    expect(cc.comment).toEqual([]);
  });
});
