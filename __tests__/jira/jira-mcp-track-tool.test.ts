import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleSpecshipJiraTrack,
  deriveWorkState,
  type JiraTrackDeps,
  type JiraTrackClient,
} from '../../src/mcp/jira-tools';
import {
  JiraError,
  type JiraIssue,
  type JiraIssueListResult,
  type JiraIssueResult,
} from '../../src/jira/types';

/**
 * REQ-JIRA-008 — a read-only tracking view joining each picked issue's SpecShip
 * work-state (derived from its workflow run) with its LIVE JIRA status (a fresh
 * read at track time). Key contracts:
 *   - A1: every picked issue row shows both its SpecShip work-state and its JIRA
 *     status,
 *   - A2: the JIRA column comes from the FRESH read, never the pick-time cached
 *     metadata — an issue moved outside SpecShip shows its current status,
 *   - dedup by issue key keeping the most-recent run,
 *   - a JIRA read failure degrades PER ROW to a clear "unreachable" marker and
 *     never fails the whole view,
 *   - empty state points at specship_jira_pick, not-configured points at
 *     specship jira configure.
 * No network — the client seam is a fake; no token is present anywhere.
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

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Point config resolution at a path that does not exist, so a developer's real
  // ~/.specship/jira.json never bleeds in and makes the default state read as
  // "configured" (it does on any machine that has run `specship jira configure`;
  // CI has no such file, which is why this was invisible there). Tests opt into
  // the configured state explicitly via configured().
  process.env.SPECSHIP_JIRA_CONFIG = '/does/not/exist.json';
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function configured(): void {
  // Enough for notConfiguredResult() to treat JIRA as configured; the client is
  // always stubbed so nothing here is ever used to reach a host.
  process.env.SPECSHIP_JIRA_CONFIG = '/does/not/exist.json';
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

function issue(key: string, status: string): JiraIssue {
  return { key, id: key, summary: `${key} summary`, status, issueType: 'Story' };
}

interface Run {
  id: string;
  status: string;
  metadata?: unknown;
}

/** A fake specQueries exposing only getAllWorkflowRuns (newest-first). */
function stubSpecQueries(runs: Run[]): unknown {
  return {
    getAllWorkflowRuns(limit: number): Run[] {
      return runs.slice(0, limit);
    },
  };
}

/**
 * A fake track client. `listed` is what listMyIssues returns; `getByKey` backs
 * the single-issue fallback for keys absent from `listed`. Either can be told to
 * throw a JiraError to exercise the per-row degradation.
 */
function fakeTrackClient(opts: {
  listed?: JiraIssue[];
  listThrows?: boolean;
  getByKey?: Record<string, JiraIssue>;
  getThrowsFor?: string[];
  calls?: { list: number; get: string[] };
}): () => JiraTrackClient {
  const calls = opts.calls ?? { list: 0, get: [] };
  return () => ({
    async listMyIssues(): Promise<JiraIssueListResult> {
      calls.list += 1;
      if (opts.listThrows) throw new JiraError('JIRA list failed', 'list');
      return { ok: true, issues: opts.listed ?? [] };
    },
    async getIssue(key: string): Promise<JiraIssueResult> {
      calls.get.push(key);
      if (opts.getThrowsFor?.includes(key)) {
        throw new JiraError(`get ${key} failed`, 'get');
      }
      const found = opts.getByKey?.[key];
      if (!found) throw new JiraError(`no ${key}`, 'get');
      return { ok: true, issue: found };
    },
  });
}

function deps(specQueries: unknown, make: () => JiraTrackClient): JiraTrackDeps {
  return { specQueries, makeJiraClient: make };
}

const authored: Run = { id: 'r1', status: 'pending', metadata: { jira: { issueKey: 'PROJ-1', title: 'One' } } };
const implementing: Run = { id: 'r2', status: 'paused', metadata: { jira: { issueKey: 'PROJ-2', title: 'Two' } } };
const prRaised: Run = {
  id: 'r3',
  status: 'completed',
  metadata: { jira: { issueKey: 'PROJ-3', title: 'Three', prUrl: 'https://gh/acme/repo/pull/3' } },
};
const verified: Run = {
  id: 'r4',
  status: 'completed',
  metadata: {
    jira: { issueKey: 'PROJ-4', title: 'Four' },
    nodeStates: { verify: 'completed' },
    outputs: { verify: { text: 'VERIFY_RESULT=ran-and-passed' } },
  },
};

describe('deriveWorkState', () => {
  it('maps each lifecycle stage to its SpecShip work-state', () => {
    expect(deriveWorkState(authored)).toBe('spec authored');
    expect(deriveWorkState(implementing)).toBe('implementing');
    expect(deriveWorkState(prRaised)).toBe('PR raised');
    expect(deriveWorkState(verified)).toBe('verified');
    expect(deriveWorkState({ id: 'x', status: 'running', metadata: {} })).toBe('implementing');
  });
});

describe('handleSpecshipJiraTrack (REQ-JIRA-008)', () => {
  it('A1: every picked issue shows both its SpecShip and its live JIRA state', async () => {
    configured();
    const sq = stubSpecQueries([verified, prRaised, implementing, authored]);
    const make = fakeTrackClient({
      listed: [
        issue('PROJ-1', 'To Do'),
        issue('PROJ-2', 'In Progress'),
        issue('PROJ-3', 'In Review'),
        issue('PROJ-4', 'Done'),
      ],
    });

    const result = await handleSpecshipJiraTrack({}, deps(sq, make));
    const out = text(result);

    expect(result.isError).toBeFalsy();
    expect(out).toMatch(/PROJ-1.*spec authored.*To Do/s);
    expect(out).toMatch(/PROJ-2.*implementing.*In Progress/s);
    expect(out).toMatch(/PROJ-3.*PR raised.*In Review/s);
    expect(out).toMatch(/PROJ-4.*verified.*Done/s);
  });

  it('A2: the JIRA column comes from the FRESH read, not pick-time cached metadata', async () => {
    configured();
    // The run carries a STALE cached status; the live read says "Done".
    const stale: Run = {
      id: 'r1',
      status: 'paused',
      metadata: { jira: { issueKey: 'PROJ-1', title: 'One', status: 'To Do' } },
    };
    const sq = stubSpecQueries([stale]);
    const make = fakeTrackClient({ listed: [issue('PROJ-1', 'Done')] });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    expect(out).toMatch(/PROJ-1.*Done/s);
    expect(out).not.toMatch(/To Do/);
  });

  it('falls back to a single getIssue read for a key not in the assigned list', async () => {
    configured();
    const sq = stubSpecQueries([implementing]);
    const calls = { list: 0, get: [] as string[] };
    const make = fakeTrackClient({
      listed: [], // PROJ-2 no longer assigned to the user
      getByKey: { 'PROJ-2': issue('PROJ-2', 'In Progress') },
      calls,
    });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    expect(calls.get).toEqual(['PROJ-2']);
    expect(out).toMatch(/PROJ-2.*In Progress/s);
  });

  it('dedups by issue key, keeping the most-recent run', async () => {
    configured();
    const older: Run = { id: 'old', status: 'pending', metadata: { jira: { issueKey: 'PROJ-1', title: 'One' } } };
    const newer: Run = { id: 'new', status: 'paused', metadata: { jira: { issueKey: 'PROJ-1', title: 'One' } } };
    // getAllWorkflowRuns is newest-first, so `newer` precedes `older`.
    const sq = stubSpecQueries([newer, older]);
    const make = fakeTrackClient({ listed: [issue('PROJ-1', 'In Progress')] });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    // One row only, reflecting the most-recent run's work-state.
    const rows = out.split('\n').filter((l) => /PROJ-1/.test(l));
    expect(rows).toHaveLength(1);
    expect(out).toMatch(/PROJ-1.*implementing/s);
  });

  it('degrades per row to an unreachable marker when the JIRA read fails', async () => {
    configured();
    const sq = stubSpecQueries([implementing]);
    const make = fakeTrackClient({ listThrows: true });

    const result = await handleSpecshipJiraTrack({}, deps(sq, make));
    const out = text(result);

    // The whole view still renders — the row degrades, it does not error out.
    expect(result.isError).toBeFalsy();
    expect(out).toMatch(/PROJ-2.*implementing/s);
    expect(out).toMatch(/unreachable/i);
  });

  it('degrades only the failing row when the fallback getIssue throws', async () => {
    configured();
    const sq = stubSpecQueries([authored, implementing]);
    const make = fakeTrackClient({
      listed: [issue('PROJ-1', 'To Do')], // PROJ-2 absent → falls back to getIssue
      getThrowsFor: ['PROJ-2'],
    });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    expect(out).toMatch(/PROJ-1.*To Do/s);
    expect(out).toMatch(/PROJ-2.*unreachable/i);
  });

  it('empty state points at specship_jira_pick', async () => {
    configured();
    const sq = stubSpecQueries([]);
    const make = fakeTrackClient({ listed: [] });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    expect(out).toMatch(/no picked issues/i);
    expect(out).toMatch(/specship_jira_pick/);
  });

  it('ignores non-JIRA runs (no jira metadata)', async () => {
    configured();
    const nonJira: Run = { id: 'x', status: 'paused', metadata: {} };
    const sq = stubSpecQueries([nonJira]);
    const make = fakeTrackClient({ listed: [] });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    expect(out).toMatch(/no picked issues/i);
  });

  it('not-configured returns a clear pointer to specship jira configure', async () => {
    // No env set → not configured.
    const sq = stubSpecQueries([implementing]);
    const make = fakeTrackClient({ listed: [] });

    const out = text(await handleSpecshipJiraTrack({}, deps(sq, make)));

    expect(out).toMatch(/not configured/i);
    expect(out).toMatch(/specship jira configure/);
  });

  it('narrows the assigned-issues read to the given project', async () => {
    configured();
    const sq = stubSpecQueries([implementing]);
    let seenProject: string | undefined = 'UNSET';
    const make = (): JiraTrackClient => ({
      async listMyIssues(o?: { project?: string }): Promise<JiraIssueListResult> {
        seenProject = o?.project;
        return { ok: true, issues: [issue('PROJ-2', 'In Progress')] };
      },
      async getIssue(): Promise<JiraIssueResult> {
        throw new JiraError('nope', 'get');
      },
    });

    await handleSpecshipJiraTrack({ project: 'PROJ' }, deps(sq, make));

    expect(seenProject).toBe('PROJ');
  });
});
