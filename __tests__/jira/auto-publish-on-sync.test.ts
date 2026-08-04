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
import { readSpecJiraKey } from '../../src/jira/spec-writer';
import { readFrontmatterValue } from '../../src/jira/publish';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';
import { JiraConfigError } from '../../src/jira/types';

/**
 * REQ-JIRATEAM-002 — auto-publish specs to JIRA on sync.
 *
 * Every path runs against structural fakes; no real JIRA host, no
 * credential, is ever touched (REQ-JIRA-009).
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
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-user-'));
  userCfgPath = path.join(userHome, 'jira.json');
  process.env.SPECSHIP_JIRA_CONFIG = userCfgPath;
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-repo-'));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeUserCfg(obj: unknown): void {
  fs.writeFileSync(userCfgPath, JSON.stringify(obj));
}

function writeRepoBinding(projectKey = 'PROJ'): void {
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify({ jira: { projectKey } }, null, 2),
  );
}

interface SpecOnDisk {
  id: string;
  title: string;
  body: string;
  file: string;
  acceptance: Array<{ id: string; text: string }>;
  frontmatter?: Record<string, string>;
}

function writeSpec(spec: SpecOnDisk): string {
  const specsDir = path.join(repoRoot, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const absPath = path.join(specsDir, spec.file);
  const lines: string[] = ['---'];
  lines.push(`id: ${spec.id}`);
  for (const [k, v] of Object.entries(spec.frontmatter ?? {})) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', `# ${spec.title}`, '', spec.body, '');
  fs.writeFileSync(absPath, lines.join('\n'));
  return absPath;
}

/** In-memory SpecQueries that mirror what the DB would return post-index. */
function makeQueries(specs: SpecOnDisk[]): AutoPublishSpecQueries {
  return {
    getAllSpecs() {
      return specs.map((s) => ({
        id: s.id,
        kind: 'requirement',
        title: s.title,
        body: s.body,
        sourcePath: path.join('specs', s.file),
      }));
    },
    getSpecsByParent(id: string) {
      const parent = specs.find((s) => s.id === id);
      if (!parent) return [];
      return parent.acceptance.map((a) => ({
        id: a.id,
        kind: 'acceptance',
        title: a.text,
        body: '',
      }));
    },
  };
}

/** Structural fake PublishJiraClient — records every call. */
interface FakeClientState {
  client: PublishJiraClient;
  createCalls: Array<Record<string, unknown>>;
  updateCalls: Array<{ key: string; fields: Record<string, unknown> }>;
  /** Existing sub-tasks per parent key. */
  subtasks: Map<string, Array<{ key: string; summary: string; status: string }>>;
  factoryCalls: number;
}

function makeFake(opts?: {
  failOnSpecId?: string;
  existingKey?: string;
}): FakeClientState {
  let next = 100;
  const state: FakeClientState = {
    createCalls: [],
    updateCalls: [],
    subtasks: new Map(),
    factoryCalls: 0,
    // Filled in below.
    client: null as unknown as PublishJiraClient,
  };
  state.client = {
    async createIssue(fields) {
      state.createCalls.push({ ...fields });
      if (opts?.failOnSpecId && String(fields.summary ?? '').includes(opts.failOnSpecId)) {
        throw new JiraConfigError('JIRA at jira.test returned HTTP 503.');
      }
      const key = `PROJ-${next++}`;
      if (fields.parentKey) {
        const existing = state.subtasks.get(String(fields.parentKey)) ?? [];
        existing.push({ key, summary: String(fields.summary), status: 'To Do' });
        state.subtasks.set(String(fields.parentKey), existing);
      }
      return { key, id: String(next) };
    },
    async updateIssue(key, fields) {
      state.updateCalls.push({ key, fields: { ...fields } });
    },
    async getIssue(key) {
      return {
        ok: true,
        issue: {
          key,
          id: '1',
          summary: 'x',
          status: 'To Do',
          issueType: 'Story',
          subtasks: state.subtasks.get(key) ?? [],
        },
      };
    },
    async listProjects() {
      return [];
    },
  };
  return state;
}

const SAMPLE_SPEC: SpecOnDisk = {
  id: 'REQ-FOO-001',
  title: 'Login MUST be rate-limited',
  body: 'The login endpoint MUST reject more than 5 attempts per minute.',
  file: 'foo.md',
  acceptance: [
    { id: 'REQ-FOO-001.A1', text: 'A 6th attempt returns 429.' },
    { id: 'REQ-FOO-001.A2', text: 'A success resets the counter.' },
  ],
};

describe('autoPublishSpecsOnSync (REQ-JIRATEAM-002)', () => {
  it('A5: no repo binding — zero JIRA calls, no client construction', async () => {
    // Bound repo required for auto-publish; do NOT write specship.config.json.
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@b.com',
      apiToken: 't',
      project: 'USER',
    });
    writeSpec(SAMPLE_SPEC);

    const fake = makeFake();
    let factoryCalls = 0;
    const deps: AutoPublishDeps = {
      specQueries: makeQueries([SAMPLE_SPEC]),
      projectRoot: repoRoot,
      makeClient: () => {
        factoryCalls++;
        return fake.client;
      },
    };

    const report = await autoPublishSpecsOnSync(deps);
    expect(report).toEqual({ skipped: 'unbound', results: [] });
    expect(factoryCalls).toBe(0);
    expect(fake.createCalls.length).toBe(0);
    expect(fake.updateCalls.length).toBe(0);
  });

  it('A1: fresh spec — creates Story + Sub-tasks and writes back jira_issue; re-sync is a no-op write', async () => {
    writeRepoBinding('PROJ');
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@b.com',
      apiToken: 't',
    });
    const specPath = writeSpec(SAMPLE_SPEC);
    const fake = makeFake();
    const deps: AutoPublishDeps = {
      specQueries: makeQueries([SAMPLE_SPEC]),
      projectRoot: repoRoot,
      makeClient: () => fake.client,
    };

    const report1 = await autoPublishSpecsOnSync(deps);
    expect(report1.skipped).toBeUndefined();
    expect(report1.results).toHaveLength(1);
    expect(report1.results[0].status).toBe('published');
    expect(report1.results[0].jiraKey).toMatch(/^PROJ-/);
    expect(report1.results[0].subtasksCreated).toBe(2);

    // Story + 2 Sub-tasks = 3 createIssue calls.
    expect(fake.createCalls).toHaveLength(3);
    expect(readSpecJiraKey(specPath)).toBe(report1.results[0].jiraKey);
    expect(readFrontmatterValue(fs.readFileSync(specPath, 'utf8'), 'jira_fingerprint'))
      .toBeTruthy();

    // Re-sync with no spec change → ZERO JIRA writes (fingerprint short-circuit).
    fake.createCalls.length = 0;
    fake.updateCalls.length = 0;
    const report2 = await autoPublishSpecsOnSync(deps);
    expect(report2.results[0].status).toBe('unchanged');
    expect(report2.results[0].subtasksCreated).toBe(0);
    expect(fake.createCalls).toHaveLength(0);
    expect(fake.updateCalls).toHaveLength(0);
  });

  it('A2: edited spec + new acceptance criterion — only the new Sub-task is created', async () => {
    writeRepoBinding('PROJ');
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@b.com',
      apiToken: 't',
    });
    writeSpec(SAMPLE_SPEC);
    const fake = makeFake();
    const deps: AutoPublishDeps = {
      specQueries: makeQueries([SAMPLE_SPEC]),
      projectRoot: repoRoot,
      makeClient: () => fake.client,
    };
    await autoPublishSpecsOnSync(deps);

    // Simulate a new acceptance criterion + edited body.
    const edited: SpecOnDisk = {
      ...SAMPLE_SPEC,
      body: 'Updated body prose.',
      acceptance: [
        ...SAMPLE_SPEC.acceptance,
        { id: 'REQ-FOO-001.A3', text: 'The limit is per IP.' },
      ],
    };
    // Rewrite the spec file to keep the frontmatter (with jira_issue) but
    // update the body/acceptance in memory (queries).
    fake.createCalls.length = 0;

    const deps2: AutoPublishDeps = {
      ...deps,
      specQueries: makeQueries([edited]),
    };
    const report = await autoPublishSpecsOnSync(deps2);
    expect(report.results[0].status).toBe('published');
    expect(report.results[0].subtasksCreated).toBe(1);
    // Only ONE Sub-task create — never a duplicate Story.
    expect(fake.createCalls).toHaveLength(1);
    expect(fake.createCalls[0].parentKey).toMatch(/^PROJ-/);
  });

  it('A3: jira_publish: false in frontmatter — opted out, zero JIRA calls for that spec', async () => {
    writeRepoBinding('PROJ');
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@b.com',
      apiToken: 't',
    });
    const optedOut: SpecOnDisk = {
      ...SAMPLE_SPEC,
      id: 'REQ-OPT-001',
      file: 'opt.md',
      frontmatter: { jira_publish: 'false' },
    };
    writeSpec(SAMPLE_SPEC);
    writeSpec(optedOut);

    const fake = makeFake();
    const deps: AutoPublishDeps = {
      specQueries: makeQueries([SAMPLE_SPEC, optedOut]),
      projectRoot: repoRoot,
      makeClient: () => fake.client,
    };
    const report = await autoPublishSpecsOnSync(deps);
    const opt = report.results.find((r) => r.specId === 'REQ-OPT-001');
    expect(opt?.status).toBe('opted_out');
    // No create calls carry the opted-out spec id / title.
    for (const call of fake.createCalls) {
      const summary = String(call.summary ?? '');
      expect(summary.includes('REQ-OPT-001')).toBe(false);
    }
    // Only the non-opted-out spec published (Story + 2 Sub-tasks = 3 creates).
    expect(fake.createCalls).toHaveLength(3);
  });

  it('A4: per-spec publish failure — reported as failed, siblings still publish', async () => {
    writeRepoBinding('PROJ');
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'a@b.com',
      apiToken: 't',
    });
    const other: SpecOnDisk = {
      ...SAMPLE_SPEC,
      id: 'REQ-BAR-001',
      title: 'Something breakable',
      file: 'bar.md',
      acceptance: [{ id: 'REQ-BAR-001.A1', text: 'It fails.' }],
    };
    writeSpec(SAMPLE_SPEC);
    writeSpec(other);
    // Fake fails on any spec whose Story summary contains "breakable".
    const fake = makeFake({ failOnSpecId: 'breakable' });
    const deps: AutoPublishDeps = {
      specQueries: makeQueries([SAMPLE_SPEC, other]),
      projectRoot: repoRoot,
      makeClient: () => fake.client,
    };
    const report = await autoPublishSpecsOnSync(deps);
    const failed = report.results.find((r) => r.specId === 'REQ-BAR-001');
    const ok = report.results.find((r) => r.specId === 'REQ-FOO-001');
    expect(failed?.status).toBe('failed');
    expect(failed?.note).toContain('503');
    expect(ok?.status).toBe('published');
  });

  it('A4-like: bound repo without user credentials — one per-sync note, never crashes', async () => {
    writeRepoBinding('PROJ');
    // No user config written.
    writeSpec(SAMPLE_SPEC);
    let factoryCalls = 0;
    const fake = makeFake();
    const deps: AutoPublishDeps = {
      specQueries: makeQueries([SAMPLE_SPEC]),
      projectRoot: repoRoot,
      makeClient: () => {
        factoryCalls++;
        return fake.client;
      },
    };
    const report = await autoPublishSpecsOnSync(deps);
    expect(report.skipped).toBe('no-credentials');
    expect(report.note).toBeTruthy();
    expect(report.results).toEqual([]);
    expect(factoryCalls).toBe(0);
    expect(fake.createCalls).toHaveLength(0);
  });
});
