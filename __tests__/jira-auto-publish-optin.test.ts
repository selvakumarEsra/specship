import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  autoPublishSpecsOnSync,
  publishPendingSpecs,
  readLastAutoPublishReport,
  summarizeAutoPublishReport,
  type AutoPublishDeps,
  type AutoPublishSpecQueries,
} from '../src/jira/auto-publish';
import { readRepoJiraBinding } from '../src/jira/repo-config';
import type { PublishJiraClient } from '../src/jira/publish';
import { ENFORCE_CONFIG_FILE } from '../src/enforce/enforce';

/**
 * REQ-THRU-006 (specs/throughput.md): `specship sync` publishes to JIRA only
 * with `jira.autoPublish: true`; without it sync makes no JIRA write and
 * reports how many specs are pending, and `specship jira publish --pending`
 * publishes them explicitly. Structural fakes only — no network.
 */

const ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_DEPLOYMENT',
  'SPECSHIP_JIRA_PROJECT',
];
const savedEnv: Record<string, string | undefined> = {};
let userHome: string;
let repoRoot: string;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'thru006-user-'));
  const userCfg = path.join(userHome, 'jira.json');
  fs.writeFileSync(
    userCfg,
    JSON.stringify({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.com', apiToken: 't' }),
  );
  process.env.SPECSHIP_JIRA_CONFIG = userCfg;
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thru006-repo-'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function bind(jira: Record<string, unknown>): void {
  fs.writeFileSync(path.join(repoRoot, ENFORCE_CONFIG_FILE), JSON.stringify({ jira }, null, 2));
}

interface Req {
  id: string;
  title: string;
  body: string;
  file: string;
  acceptance: Array<{ id: string; text: string }>;
}

const REQS: Req[] = [
  {
    id: 'REQ-OPT-001',
    title: 'Login MUST be rate-limited',
    body: 'The login endpoint MUST reject more than 5 attempts per minute.',
    file: 'opt-001.md',
    acceptance: [{ id: 'REQ-OPT-001.A1', text: 'A 6th attempt returns 429.' }],
  },
  {
    id: 'REQ-OPT-002',
    title: 'Sessions MUST expire',
    body: 'Idle sessions MUST expire after 15 minutes.',
    file: 'opt-002.md',
    acceptance: [{ id: 'REQ-OPT-002.A1', text: 'An idle session is rejected.' }],
  },
];

function writeSpecs(reqs: Req[]): void {
  fs.mkdirSync(path.join(repoRoot, 'specs'), { recursive: true });
  for (const r of reqs) {
    fs.writeFileSync(
      path.join(repoRoot, 'specs', r.file),
      ['---', `id: ${r.id}`, '---', '', `# ${r.title}`, '', r.body, ''].join('\n'),
    );
  }
}

function queries(reqs: Req[]): AutoPublishSpecQueries {
  return {
    getAllSpecs: () =>
      reqs.map((r) => ({
        id: r.id,
        kind: 'requirement',
        title: r.title,
        body: r.body,
        sourcePath: path.join('specs', r.file),
      })),
    getSpecsByParent: (id: string) =>
      (reqs.find((r) => r.id === id)?.acceptance ?? []).map((a) => ({
        id: a.id,
        kind: 'acceptance',
        title: a.text,
        body: '',
      })),
  };
}

function fakeClient(): { client: PublishJiraClient; writes: () => number; built: () => number; deps: AutoPublishDeps } {
  let next = 1;
  let writes = 0;
  let built = 0;
  const subtasks = new Map<string, Array<{ key: string; summary: string; status: string }>>();
  const client: PublishJiraClient = {
    async createIssue(fields) {
      writes++;
      const key = `PROJ-${next++}`;
      if (fields.parentKey) {
        const list = subtasks.get(String(fields.parentKey)) ?? [];
        list.push({ key, summary: String(fields.summary), status: 'To Do' });
        subtasks.set(String(fields.parentKey), list);
      }
      return { key, id: String(next) };
    },
    async updateIssue() {
      writes++;
    },
    async getIssue(key) {
      return {
        ok: true,
        issue: { key, id: '1', summary: 'x', status: 'To Do', issueType: 'Story', subtasks: subtasks.get(key) ?? [] },
      };
    },
    async listProjects() {
      return [];
    },
  };
  const deps: AutoPublishDeps = {
    specQueries: queries(REQS),
    projectRoot: repoRoot,
    makeClient: () => {
      built++;
      return client;
    },
  };
  return { client, writes: () => writes, built: () => built, deps };
}

describe('JIRA auto-publish is explicit opt-in — REQ-THRU-006', () => {
  it('REQ-THRU-006.A1: a bound repo without jira.autoPublish makes no JIRA write during sync', async function boundRepoWithoutOptInDoesNotPublish() {
    bind({ projectKey: 'PROJ' });
    writeSpecs(REQS);
    const before = REQS.map((r) => fs.readFileSync(path.join(repoRoot, 'specs', r.file), 'utf8'));
    const fake = fakeClient();

    expect(readRepoJiraBinding(repoRoot).binding?.autoPublish).toBeUndefined();
    const report = await autoPublishSpecsOnSync(fake.deps);

    expect(report.skipped).toBe('not-opted-in');
    expect(fake.built()).toBe(0);
    expect(fake.writes()).toBe(0);
    // No jira_issue write-back either.
    REQS.forEach((r, i) => {
      expect(fs.readFileSync(path.join(repoRoot, 'specs', r.file), 'utf8')).toBe(before[i]);
    });
    // A non-`true` value is not an opt-in.
    bind({ projectKey: 'PROJ', autoPublish: 'yes' });
    expect(readRepoJiraBinding(repoRoot).binding?.autoPublish).toBeUndefined();
    await autoPublishSpecsOnSync(fake.deps);
    expect(fake.writes()).toBe(0);
  });

  it('REQ-THRU-006.A2: with jira.autoPublish: true, sync publishes as before', async function optInPublishesOnSync() {
    bind({ projectKey: 'PROJ', autoPublish: true });
    writeSpecs(REQS);
    const fake = fakeClient();

    expect(readRepoJiraBinding(repoRoot).binding?.autoPublish).toBe(true);
    const report = await autoPublishSpecsOnSync(fake.deps);

    expect(report.skipped).toBeUndefined();
    expect(report.results.map((r) => r.status)).toEqual(['published', 'published']);
    expect(fake.writes()).toBe(4); // 2 Stories + 2 Sub-tasks
    expect(summarizeAutoPublishReport(report)).toBe(
      'JIRA auto-publish: 2 published, 0 unchanged, 0 opted out, 0 failed',
    );

    // Re-sync: fingerprints short-circuit, no further writes.
    const again = await autoPublishSpecsOnSync(fake.deps);
    expect(again.results.map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    expect(fake.writes()).toBe(4);
  });

  it('REQ-THRU-006.A3: without the opt-in, sync reports the number of specs pending publication', async function pendingCountIsReported() {
    bind({ projectKey: 'PROJ' });
    writeSpecs(REQS);
    const fake = fakeClient();

    const report = await autoPublishSpecsOnSync(fake.deps);
    expect(report.pending).toBe(2);
    const line = summarizeAutoPublishReport(report);
    expect(line).toBe(
      '2 spec(s) pending JIRA publication — run `specship jira publish --pending`',
    );
    // Persisted for pulse, which reads .specship/jira-publish-last.json.
    const last = readLastAutoPublishReport(repoRoot);
    expect(last?.skipped).toBe('not-opted-in');
    expect(last?.summary).toBe(line);

    // The explicit batch publishes them, and the pending count drops to 0.
    const explicit = await publishPendingSpecs(fake.deps);
    expect(explicit.results.map((r) => r.status)).toEqual(['published', 'published']);
    expect(fake.writes()).toBe(4);
    const after = await autoPublishSpecsOnSync(fake.deps);
    expect(after.pending).toBe(0);
    expect(summarizeAutoPublishReport(after)).toBe('');
    expect(fake.writes()).toBe(4);
  });
});
