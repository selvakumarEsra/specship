import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  autoPublishSpecsOnSync,
  type AutoPublishDeps,
  type AutoPublishSpecQueries,
} from '../../src/jira/auto-publish';
import type { PublishJiraClient } from '../../src/jira/publish';
import { readFrontmatterValue } from '../../src/jira/publish';
import { enumeratePublishedSpecs } from '../../src/jira/published-specs';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';

/**
 * REQ-JIRATEAM-010 — one issue per requirement in multi-requirement files.
 *
 * Publish keying was file-level, so in a file holding several requirements
 * every requirement after the first UPDATED the first one's issue — last
 * writer wins, permanent churn on every sync. 73 of this repo's 74 spec
 * files are multi-requirement; these tests pin the per-requirement keying
 * that makes the backfill safe.
 */

let userHome: string;
let userCfgPath: string;
let repoRoot: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_DEPLOYMENT',
  'SPECSHIP_JIRA_PROJECT',
];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-multireq-user-'));
  userCfgPath = path.join(userHome, 'jira.json');
  process.env.SPECSHIP_JIRA_CONFIG = userCfgPath;
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-multireq-repo-'));
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify({ jira: { projectKey: 'PROJ' } }, null, 2),
  );
  fs.writeFileSync(
    userCfgPath,
    JSON.stringify({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.com', apiToken: 't' }),
  );
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

const REQ_A = {
  id: 'REQ-MR-001',
  title: 'First requirement',
  body: 'Body of the first requirement.',
  acceptance: [{ id: 'REQ-MR-001.A1', text: 'First A1.' }],
};
const REQ_B = {
  id: 'REQ-MR-002',
  title: 'Second requirement',
  body: 'Body of the second requirement.',
  acceptance: [{ id: 'REQ-MR-002.A1', text: 'Second A1.' }],
};
const FILE = 'multi.md';

function writeMultiSpecFile(): string {
  const specsDir = path.join(repoRoot, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const absPath = path.join(specsDir, FILE);
  fs.writeFileSync(
    absPath,
    [
      '---', 'id: MR-DOC', '---', '',
      `<!-- id: ${REQ_A.id} -->`, `## ${REQ_A.title}`, '', REQ_A.body, '',
      `<!-- id: ${REQ_B.id} -->`, `## ${REQ_B.title}`, '', REQ_B.body, '',
    ].join('\n'),
  );
  return absPath;
}

function makeQueries(): AutoPublishSpecQueries {
  const reqs = [REQ_A, REQ_B];
  return {
    getAllSpecs: () =>
      reqs.map((r) => ({
        id: r.id,
        kind: 'requirement',
        title: r.title,
        body: r.body,
        sourcePath: path.join('specs', FILE),
      })),
    getSpecsByParent: (id: string) => {
      const r = reqs.find((x) => x.id === id);
      return r
        ? r.acceptance.map((a) => ({ id: a.id, kind: 'acceptance', title: a.text, body: '' }))
        : [];
    },
  };
}

interface Fake {
  client: PublishJiraClient;
  createCalls: Array<Record<string, unknown>>;
  updateCalls: Array<{ key: string }>;
}

function makeFake(): Fake {
  let next = 100;
  const fake: Fake = { createCalls: [], updateCalls: [], client: null as unknown as PublishJiraClient };
  fake.client = {
    async createIssue(fields) {
      fake.createCalls.push({ ...fields });
      return { key: `PROJ-${next++}`, id: String(next) };
    },
    async updateIssue(key) {
      fake.updateCalls.push({ key });
    },
    async getIssue(key) {
      return { ok: true, issue: { key, id: '1', summary: 'x', status: 'To Do', issueType: 'Story', subtasks: [] } };
    },
    async listProjects() { return []; },
  };
  return fake;
}

function deps(fake: Fake): AutoPublishDeps {
  return { specQueries: makeQueries(), projectRoot: repoRoot, makeClient: () => fake.client };
}

describe('multi-requirement publish (REQ-JIRATEAM-010)', () => {
  it('A1/A2: two requirements → two distinct issues, per-requirement frontmatter, no plain jira_issue', async () => {
    const absPath = writeMultiSpecFile();
    const fake = makeFake();

    const report = await autoPublishSpecsOnSync(deps(fake));
    expect(report.results.map((r) => r.status)).toEqual(['published', 'published']);
    const keys = report.results.map((r) => r.jiraKey);
    expect(new Set(keys).size).toBe(2);

    // Each issue carries only its own requirement: 2 main creates + 1 subtask each.
    const mains = fake.createCalls.filter((c) => !c.parentKey);
    expect(mains).toHaveLength(2);
    expect(String(mains[0]!.summary)).toContain('First requirement');
    expect(String(mains[1]!.summary)).toContain('Second requirement');
    // A4 regression: the second requirement must CREATE, never UPDATE the first's issue.
    expect(fake.updateCalls).toHaveLength(0);

    const content = fs.readFileSync(absPath, 'utf8');
    expect(readFrontmatterValue(content, `jira_issue_${REQ_A.id}`)).toBe(keys[0]);
    expect(readFrontmatterValue(content, `jira_issue_${REQ_B.id}`)).toBe(keys[1]);
    expect(readFrontmatterValue(content, `jira_fingerprint_${REQ_A.id}`)).toBeTruthy();
    expect(readFrontmatterValue(content, 'jira_issue')).toBeNull();
  });

  it('A3: a second sync performs zero JIRA writes for both requirements', async () => {
    writeMultiSpecFile();
    const fake = makeFake();
    await autoPublishSpecsOnSync(deps(fake));
    const callsAfterFirst = fake.createCalls.length;

    const report2 = await autoPublishSpecsOnSync(deps(fake));
    expect(report2.results.map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    expect(fake.createCalls.length).toBe(callsAfterFirst);
    expect(fake.updateCalls).toHaveLength(0);
  });

  it('A4: a stale plain jira_issue in a multi-requirement file is ignored, not clobbered', async () => {
    const absPath = writeMultiSpecFile();
    // Simulate the pre-fix state: a file-level key left by the old code path.
    const content = fs.readFileSync(absPath, 'utf8');
    fs.writeFileSync(absPath, content.replace('id: MR-DOC', 'id: MR-DOC\njira_issue: PROJ-9'));
    const fake = makeFake();

    await autoPublishSpecsOnSync(deps(fake));
    // Both requirements CREATE fresh issues; PROJ-9 is never updated.
    expect(fake.createCalls.filter((c) => !c.parentKey)).toHaveLength(2);
    expect(fake.updateCalls).toHaveLength(0);
  });

  it('A5: enumeratePublishedSpecs returns one ref per requirement with its specId', async () => {
    writeMultiSpecFile();
    const fake = makeFake();
    const report = await autoPublishSpecsOnSync(deps(fake));

    const refs = enumeratePublishedSpecs(repoRoot);
    expect(refs).toHaveLength(2);
    const byId = new Map(refs.map((r) => [r.specId, r.issueKey]));
    expect(byId.get(REQ_A.id)).toBe(report.results[0]!.jiraKey);
    expect(byId.get(REQ_B.id)).toBe(report.results[1]!.jiraKey);
  });

  it('back-compat: a single-requirement file keeps the plain frontmatter form', async () => {
    const specsDir = path.join(repoRoot, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    const absPath = path.join(specsDir, 'solo.md');
    fs.writeFileSync(absPath, ['---', 'id: SOLO-DOC', '---', '', '# Solo', '', 'Body.'].join('\n'));
    const solo = {
      getAllSpecs: () => [
        { id: 'REQ-SOLO-001', kind: 'requirement', title: 'Solo', body: 'Body.', sourcePath: path.join('specs', 'solo.md') },
      ],
      getSpecsByParent: () => [],
    } as AutoPublishSpecQueries;
    const fake = makeFake();

    await autoPublishSpecsOnSync({ specQueries: solo, projectRoot: repoRoot, makeClient: () => fake.client });
    const content = fs.readFileSync(absPath, 'utf8');
    expect(readFrontmatterValue(content, 'jira_issue')).toMatch(/^PROJ-/);
    expect(readFrontmatterValue(content, 'jira_issue_REQ-SOLO-001')).toBeNull();
  });
});
