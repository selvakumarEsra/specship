import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * REQ-MULTIDEV-005 — a repo MAY require JIRA publishing to happen only in CI
 * on its main branch. Every JIRA path runs against structural fakes; no real
 * host or credential is touched. `child_process` is wrapped so A7 can prove
 * the CI publish never runs `git commit` / `git push`.
 */

const childCalls: Array<{ fn: string; cmd: string; args: string[] }> = [];
vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('child_process')>();
  const wrap =
    <F extends (...a: any[]) => any>(fn: string, f: F) =>
    (...a: any[]) => {
      const cmd = String(a[0] ?? '');
      const args = Array.isArray(a[1]) ? a[1].map(String) : [];
      childCalls.push({ fn, cmd, args });
      return f(...a);
    };
  return {
    ...orig,
    execFileSync: wrap('execFileSync', orig.execFileSync),
    execSync: wrap('execSync', orig.execSync),
    spawn: wrap('spawn', orig.spawn),
    spawnSync: wrap('spawnSync', orig.spawnSync),
    exec: wrap('exec', orig.exec),
    execFile: wrap('execFile', orig.execFile),
  };
});

import { execFileSync } from 'child_process';
import {
  autoPublishSpecsOnSync,
  publishPendingSpecs,
  summarizeAutoPublishReport,
  type AutoPublishDeps,
  type AutoPublishSpecQueries,
} from '../../src/jira/auto-publish';
import { publishSpecToJira, type PublishJiraClient } from '../../src/jira/publish';
import {
  resolveCiPublishGate,
  specIssueLabel,
  detectRepoIdentity,
} from '../../src/jira/ci-publish';
import { readRepoJiraBinding } from '../../src/jira/repo-config';
import { resolveWorkAnchor, type AnchorJiraClient } from '../../src/jira/board-first';
import { handleSpecshipJiraPublish } from '../../src/mcp/jira-tools';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';

let userHome: string;
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
  'CI',
  'GITHUB_REF_NAME',
  'CI_COMMIT_REF_NAME',
  'BRANCH_NAME',
];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-ci-user-'));
  const cfg = path.join(userHome, 'jira.json');
  fs.writeFileSync(
    cfg,
    JSON.stringify({ baseUrl: 'https://jira.test', pat: 'pat-x', deployment: 'datacenter' }),
  );
  process.env.SPECSHIP_JIRA_CONFIG = cfg;
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-ci-repo-'));
  childCalls.length = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeBinding(jira: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify({ jira: { projectKey: 'PROJ', ...jira } }, null, 2),
  );
}

const SPEC = {
  id: 'REQ-AUTH-001',
  title: 'Login MUST be rate-limited',
  body: 'The login endpoint MUST reject more than 5 attempts per minute.',
  file: 'auth.md',
  acceptance: [{ id: 'REQ-AUTH-001.A1', text: 'A 6th attempt returns 429.' }],
};
const SPEC_2 = {
  id: 'REQ-PAY-001',
  title: 'Payments MUST be idempotent',
  body: 'A retried charge MUST NOT double-charge.',
  file: 'pay.md',
  acceptance: [{ id: 'REQ-PAY-001.A1', text: 'A retry returns the first result.' }],
};
type Spec = typeof SPEC;

function writeSpec(spec: Spec, frontmatter: Record<string, string> = {}): string {
  const dir = path.join(repoRoot, 'specs');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, spec.file);
  const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(
    abs,
    ['---', `id: ${spec.id}`, ...fm, '---', '', `# ${spec.title}`, '', spec.body, ''].join('\n'),
  );
  return abs;
}

function queries(specs: Spec[]): AutoPublishSpecQueries & {
  getSpecById(id: string): { id: string; kind: string; title: string; body: string; sourcePath: string } | null;
} {
  const row = (s: Spec) => ({
    id: s.id,
    kind: 'requirement',
    title: s.title,
    body: s.body,
    sourcePath: path.join('specs', s.file),
  });
  return {
    getAllSpecs: () => specs.map(row),
    getSpecById: (id) => {
      const s = specs.find((x) => x.id === id);
      return s ? row(s) : null;
    },
    getSpecsByParent: (id) =>
      (specs.find((s) => s.id === id)?.acceptance ?? []).map((a) => ({
        id: a.id,
        kind: 'acceptance',
        title: a.text,
        body: '',
      })),
  };
}

/** A fake JIRA project that remembers created issues and their labels. */
function fakeJira() {
  let next = 100;
  const issues = new Map<
    string,
    { summary: string; description: string; labels: string[]; parentKey?: string }
  >();
  const order: string[] = [];
  const creates: Array<Record<string, unknown>> = [];
  const updates: string[] = [];
  const labelSearches: string[] = [];
  const client: PublishJiraClient = {
    async createIssue(fields) {
      creates.push({ ...fields });
      const key = `PROJ-${next++}`;
      issues.set(key, {
        summary: fields.summary,
        description: fields.description ?? '',
        labels: fields.labels ?? [],
        ...(fields.parentKey ? { parentKey: fields.parentKey } : {}),
      });
      order.push(key);
      return { key, id: key };
    },
    async updateIssue(key, fields) {
      updates.push(key);
      const i = issues.get(key);
      if (i) Object.assign(i, fields);
    },
    async getIssue(key) {
      const i = issues.get(key);
      const subtasks = order
        .filter((k) => issues.get(k)?.parentKey === key)
        .map((k) => ({ key: k, summary: issues.get(k)!.summary, status: 'To Do' }));
      return {
        ok: true,
        issue: {
          key,
          summary: i?.summary ?? '',
          description: i?.description ?? '',
          status: 'To Do',
          issueType: 'Story',
          subtasks,
        },
      } as any;
    },
    async listProjects() {
      return [{ key: 'PROJ', name: 'Project' }];
    },
    async searchIssuesByLabel(_project, label) {
      labelSearches.push(label);
      return order
        .filter((k) => issues.get(k)!.labels.includes(label))
        .map((k) => ({ key: k, summary: issues.get(k)!.summary }));
    },
  };
  const writes = () => creates.length + updates.length;
  return { client, issues, creates, updates, labelSearches, writes };
}

function deps(
  specs: Spec[],
  jira: ReturnType<typeof fakeJira>,
  ci: { env: NodeJS.ProcessEnv; currentBranch?: string | null },
  repoIdentity: string | undefined = 'acme-app',
): AutoPublishDeps {
  return {
    specQueries: queries(specs),
    projectRoot: repoRoot,
    makeClient: () => jira.client,
    ciContext: ci,
    ...(repoIdentity ? { repoIdentity } : {}),
  };
}

function text(r: { content: Array<{ text: string }> }): string {
  return r.content.map((c) => c.text).join('\n');
}

// ---------------------------------------------------------------------------

async function reqMultidev005A1(): Promise<void> {
  writeBinding({ publishFrom: 'ci', autoPublish: true });
  const before = writeSpec(SPEC);
  const content = fs.readFileSync(before, 'utf8');
  const jira = fakeJira();
  const ci = { env: {} as NodeJS.ProcessEnv };

  const sync = await autoPublishSpecsOnSync(deps([SPEC], jira, ci));
  expect(sync.skipped).toBe('pending-ci');
  expect(sync.results.map((r) => r.status)).toEqual(['pending_ci']);
  expect(summarizeAutoPublishReport(sync)).toContain('pending CI publication');

  const explicit = await publishPendingSpecs(deps([SPEC], jira, ci));
  expect(explicit.skipped).toBe('pending-ci');
  expect(explicit.results[0]!.status).toBe('pending_ci');
  expect(summarizeAutoPublishReport(explicit)).toContain('pending CI publication');

  const mcp = await handleSpecshipJiraPublish(
    { spec_id: SPEC.id },
    { specQueries: queries([SPEC]), projectRoot: repoRoot, makeJiraClient: () => jira.client, ciContext: ci },
  );
  expect(mcp.isError).toBeUndefined();
  expect(text(mcp)).toContain('pending CI publication');

  expect(jira.writes()).toBe(0);
  expect(fs.readFileSync(before, 'utf8')).toBe(content);
}

async function reqMultidev005A2(): Promise<void> {
  writeBinding({ publishFrom: 'ci', epicKey: 'PROJ-1' });
  writeSpec(SPEC);
  writeSpec(SPEC_2);
  const jira = fakeJira();
  const report = await publishPendingSpecs(
    deps([SPEC, SPEC_2], jira, { env: { CI: 'true' }, currentBranch: 'main' }),
  );
  expect(report.skipped).toBeUndefined();
  expect(report.results.map((r) => r.status)).toEqual(['published', 'published']);
  const stories = jira.creates.filter((c) => c.issueType === 'Story');
  expect(stories).toHaveLength(2);
  expect(stories[0]!.labels).toEqual(['specship-acme-app-REQ-AUTH-001']);
  expect(stories[0]!.parentKey).toBe('PROJ-1');
}

async function reqMultidev005A3(): Promise<void> {
  writeBinding({ publishFrom: 'ci' });
  writeSpec(SPEC);
  const jira = fakeJira();
  const ci = { env: { CI: 'true' } as NodeJS.ProcessEnv, currentBranch: 'feat/x' };
  const report = await publishPendingSpecs(deps([SPEC], jira, ci));
  expect(report.skipped).toBe('pending-ci');
  const line = summarizeAutoPublishReport(report);
  expect(line).toContain('"main"');
  expect(line).toContain('feat/x');

  const mcp = await handleSpecshipJiraPublish(
    { spec_id: SPEC.id },
    { specQueries: queries([SPEC]), projectRoot: repoRoot, makeJiraClient: () => jira.client, ciContext: ci },
  );
  expect(text(mcp)).toContain('"main"');
  expect(jira.writes()).toBe(0);

  // A configured publish branch is the one named.
  writeBinding({ publishFrom: 'ci', publishBranch: 'release' });
  const r2 = await publishPendingSpecs(deps([SPEC], jira, ci));
  expect(summarizeAutoPublishReport(r2)).toContain('"release"');
  expect(jira.writes()).toBe(0);
}

async function reqMultidev005A4(): Promise<void> {
  const noClient = (): AnchorJiraClient => {
    throw new Error('no JIRA call expected');
  };
  // Spec frontmatter epic, no issue key → anchored without an issue.
  writeBinding({ publishFrom: 'ci' });
  const fromSpec = await resolveWorkAnchor({
    cwd: repoRoot,
    specEpicKey: 'PROJ-7',
    makeClient: noClient,
  });
  expect(fromSpec.status).toBe('anchored');
  if (fromSpec.status === 'anchored') {
    expect(fromSpec.anchor.issueKey).toBeUndefined();
    expect(fromSpec.anchor.epicKey).toBe('PROJ-7');
    expect(fromSpec.anchor.source).toBe('epic-pending-ci');
  }
  // Binding default epic also anchors.
  writeBinding({ publishFrom: 'ci', epicKey: 'PROJ-9' });
  const fromBinding = await resolveWorkAnchor({ cwd: repoRoot, makeClient: noClient });
  expect(fromBinding.status === 'anchored' && fromBinding.anchor.epicKey).toBe('PROJ-9');
  // No epic anywhere → still refused.
  writeBinding({ publishFrom: 'ci' });
  const refused = await resolveWorkAnchor({ cwd: repoRoot, makeClient: noClient });
  expect(refused.status).toBe('refused');
  // Setting absent → an epic alone is NOT an anchor (unchanged behaviour).
  writeBinding({ epicKey: 'PROJ-9' });
  const legacy = await resolveWorkAnchor({
    cwd: repoRoot,
    specEpicKey: 'PROJ-7',
    makeClient: () => ({
      async listMyIssues() {
        return { ok: true as const, issues: [] };
      },
      async getIssue() {
        throw new Error('unused');
      },
    }),
  });
  expect(legacy.status).toBe('refused');
}

async function reqMultidev005A5(): Promise<void> {
  writeBinding({ publishFrom: 'ci' });
  writeSpec(SPEC);
  const jira = fakeJira();
  const ci = { env: { CI: 'true' } as NodeJS.ProcessEnv, currentBranch: 'main' };

  const first = await publishPendingSpecs(deps([SPEC], jira, ci));
  expect(first.results[0]!.status).toBe('published');
  const storyKey = first.results[0]!.jiraKey!;
  // The spec file never learns the key (CI never writes to git).
  const second = await publishPendingSpecs(deps([SPEC], jira, ci));
  expect(second.results[0]!.jiraKey).toBe(storyKey);
  expect(jira.creates.filter((c) => c.issueType === 'Story')).toHaveLength(1);
  expect(jira.updates).toEqual([storyKey]);
  // Sub-tasks were not duplicated either.
  expect(jira.creates.filter((c) => c.issueType === 'Sub-task')).toHaveLength(1);
}

async function reqMultidev005A5OtherRepoLabelNotMatched(): Promise<void> {
  writeBinding({ publishFrom: 'ci' });
  writeSpec(SPEC);
  const jira = fakeJira();
  // Another repo bound to the same project already published REQ-AUTH-001.
  const other = await jira.client.createIssue({
    projectKey: 'PROJ',
    issueType: 'Story',
    summary: SPEC.title,
    description: 'from another repo',
    labels: [specIssueLabel('other-service', SPEC.id)],
  });
  const ci = { env: { CI: 'true' } as NodeJS.ProcessEnv, currentBranch: 'main' };
  const report = await publishPendingSpecs(deps([SPEC], jira, ci, 'acme-app'));
  expect(report.results[0]!.status).toBe('published');
  expect(report.results[0]!.jiraKey).not.toBe(other.key);
  expect(jira.updates).not.toContain(other.key);
  expect(jira.labelSearches).toEqual(['specship-acme-app-REQ-AUTH-001']);
  expect(specIssueLabel('my repo', 'REQ-AUTH-001')).toBe('specship-my-repo-REQ-AUTH-001');
}

async function reqMultidev005A6(): Promise<void> {
  // Gate: absent / unrecognised setting → direct, whatever CI says.
  expect(resolveCiPublishGate(null)).toEqual({ mode: 'direct' });
  expect(resolveCiPublishGate({}, { env: { CI: 'true' }, currentBranch: 'x' })).toEqual({
    mode: 'direct',
  });
  writeBinding({ publishFrom: 'github', autoPublish: true });
  const { binding } = readRepoJiraBinding(repoRoot);
  expect(binding?.publishFrom).toBeUndefined();
  expect(binding?.publishBranch).toBeUndefined();

  // Publish: no label search, create payload byte-identical to before.
  writeSpec(SPEC);
  const jira = fakeJira();
  const report = await autoPublishSpecsOnSync(
    deps([SPEC], jira, { env: {} as NodeJS.ProcessEnv }),
  );
  expect(report.results[0]!.status).toBe('published');
  expect(jira.labelSearches).toEqual([]);
  expect(jira.creates[0]).toEqual({
    projectKey: 'PROJ',
    issueType: 'Story',
    summary: SPEC.title,
    description: expect.any(String),
  });
  // Frontmatter write-back still happens outside CI-publish mode.
  expect(fs.readFileSync(path.join(repoRoot, 'specs', SPEC.file), 'utf8')).toContain(
    'jira_issue: PROJ-100',
  );

  // The primitive without `dedupe` never searches.
  const j2 = fakeJira();
  await publishSpecToJira(
    j2.client,
    { specId: SPEC.id, title: SPEC.title, body: SPEC.body, specRelPath: 'specs/auth.md', acceptance: [] },
    { projectKey: 'PROJ' },
    null,
  );
  expect(j2.labelSearches).toEqual([]);
  expect(j2.creates[0]!.labels).toBeUndefined();
}

async function reqMultidev005A7(): Promise<void> {
  // A real git checkout with a committed spec — the CI publish must leave it clean.
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('remote', 'add', 'origin', 'git@github.com:acme/acme-app.git');
  writeBinding({ publishFrom: 'ci' });
  const specPath = writeSpec(SPEC);
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.specship/\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const before = fs.readFileSync(specPath, 'utf8');
  const head = git('rev-parse', 'HEAD').trim();
  childCalls.length = 0;

  const jira = fakeJira();
  // No branch / identity seams: the real git reads run (read-only).
  const report = await publishPendingSpecs({
    specQueries: queries([SPEC]),
    projectRoot: repoRoot,
    makeClient: () => jira.client,
    ciContext: { env: { CI: 'true' } },
  });
  const mcp = await handleSpecshipJiraPublish(
    { spec_id: SPEC.id },
    { specQueries: queries([SPEC]), projectRoot: repoRoot, makeJiraClient: () => jira.client, ciContext: { env: { CI: 'true' } } },
  );
  const calls = [...childCalls];

  expect(report.results[0]!.status).toBe('published');
  expect(text(mcp)).toContain('not modified');
  // The MCP run found the issue the first run created — still one Story.
  expect(jira.creates.filter((c) => c.issueType === 'Story')).toHaveLength(1);
  expect(jira.labelSearches[0]).toBe('specship-acme-app-REQ-AUTH-001');
  expect(detectRepoIdentity(repoRoot)).toBe('acme-app');

  const writesGit = calls.filter(
    (c) => c.args.includes('commit') || c.args.includes('push') || /\bgit\s+(commit|push)\b/.test(c.cmd),
  );
  expect(writesGit).toEqual([]);
  expect(fs.readFileSync(specPath, 'utf8')).toBe(before);
  expect(git('rev-parse', 'HEAD').trim()).toBe(head);
  expect(git('status', '--porcelain').trim()).toBe('');
}

describe('REQ-MULTIDEV-005 — JIRA publishing only from CI on the publish branch', () => {
  it('REQ-MULTIDEV-005.A1: outside CI no path writes to JIRA; specs are pending CI publication', reqMultidev005A1);
  it('REQ-MULTIDEV-005.A2: CI=true on main publishes every pending spec', reqMultidev005A2);
  it('REQ-MULTIDEV-005.A3: CI=true on another branch publishes nothing and names the publish branch', reqMultidev005A3);
  it('REQ-MULTIDEV-005.A4: an epic-only anchor passes under the setting; no epic is still refused', reqMultidev005A4);
  it('REQ-MULTIDEV-005.A5: a second CI publish finds and updates the first run\'s issue', reqMultidev005A5);
  it('REQ-MULTIDEV-005.A5: another repo\'s issue with the same REQ-ID is not matched', reqMultidev005A5OtherRepoLabelNotMatched);
  it('REQ-MULTIDEV-005.A6: with the setting absent, publishing is unchanged', reqMultidev005A6);
  it('REQ-MULTIDEV-005.A7: the CI publish makes no git commit or push and leaves the tree clean', reqMultidev005A7);
});
