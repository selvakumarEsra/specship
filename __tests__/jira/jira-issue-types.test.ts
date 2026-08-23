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
import { bindingIssueTypes } from '../../src/jira/repo-config';
import { formatJiraErrorBody } from '../../src/jira/client';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';

/**
 * REQ-JIRATEAM-009 — the binding's issue-type overrides are honored by every
 * publish path.
 *
 * A team-managed JIRA project commonly has only `Task` + `Sub-task` (no
 * `Story`), so a publish hardcoded to `Story` fails every create with an
 * opaque HTTP 400 — observed live as 356/356 auto-publish failures. The
 * binding fields (`jira.storyIssueType` / `jira.subtaskIssueType`) existed
 * but were parsed and never consumed; these tests pin the wiring.
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
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-types-user-'));
  userCfgPath = path.join(userHome, 'jira.json');
  process.env.SPECSHIP_JIRA_CONFIG = userCfgPath;
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-types-repo-'));
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
    JSON.stringify({ jira }, null, 2),
  );
}

const SPEC = {
  id: 'REQ-TT-001',
  title: 'Types MUST come from the binding',
  body: 'Body.',
  file: 'tt.md',
  acceptance: [{ id: 'REQ-TT-001.A1', text: 'Child uses the bound type.' }],
};

function writeSpecFile(): void {
  const specsDir = path.join(repoRoot, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, SPEC.file),
    ['---', `id: ${SPEC.id}`, '---', '', `# ${SPEC.title}`, '', SPEC.body, ''].join('\n'),
  );
}

function makeQueries(): AutoPublishSpecQueries {
  return {
    getAllSpecs: () => [
      { id: SPEC.id, kind: 'requirement', title: SPEC.title, body: SPEC.body, sourcePath: path.join('specs', SPEC.file) },
    ],
    getSpecsByParent: (id: string) =>
      id === SPEC.id
        ? SPEC.acceptance.map((a) => ({ id: a.id, kind: 'acceptance', title: a.text, body: '' }))
        : [],
  };
}

function makeFake(): { client: PublishJiraClient; createCalls: Array<Record<string, unknown>> } {
  let next = 100;
  const createCalls: Array<Record<string, unknown>> = [];
  const client: PublishJiraClient = {
    async createIssue(fields) {
      createCalls.push({ ...fields });
      return { key: `PROJ-${next++}`, id: String(next) };
    },
    async updateIssue() { /* not exercised */ },
    async getIssue(key) {
      return { ok: true, issue: { key, id: '1', summary: 'x', status: 'To Do', issueType: 'Task', subtasks: [] } };
    },
    async listProjects() { return []; },
  };
  return { client, createCalls };
}

describe('bindingIssueTypes (REQ-JIRATEAM-009)', () => {
  it('A1/A2: maps the binding overrides to PublishOptions fields', () => {
    writeBinding({ projectKey: 'PROJ', storyIssueType: 'Task', subtaskIssueType: 'Subtask' });
    expect(bindingIssueTypes(repoRoot)).toEqual({ issueType: 'Task', subtaskType: 'Subtask' });
  });

  it('absent overrides yield {} so the Story/Sub-task defaults apply', () => {
    writeBinding({ projectKey: 'PROJ' });
    expect(bindingIssueTypes(repoRoot)).toEqual({});
  });

  it('an unbound or unreadable repo yields {} without throwing', () => {
    expect(bindingIssueTypes(repoRoot)).toEqual({});
    fs.writeFileSync(path.join(repoRoot, ENFORCE_CONFIG_FILE), '{not json');
    expect(() => bindingIssueTypes(repoRoot)).not.toThrow();
  });
});

describe('auto-publish honors binding issue types (REQ-JIRATEAM-009.A1/A2)', () => {
  it('creates the main issue and children with the bound types', async () => {
    writeBinding({ projectKey: 'PROJ', storyIssueType: 'Task', subtaskIssueType: 'Subtask' });
    fs.writeFileSync(userCfgPath, JSON.stringify({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.com', apiToken: 't' }));
    writeSpecFile();
    const fake = makeFake();
    const deps: AutoPublishDeps = {
      specQueries: makeQueries(),
      projectRoot: repoRoot,
      makeClient: () => fake.client,
    };

    const report = await autoPublishSpecsOnSync(deps);
    expect(report.results[0]?.status).toBe('published');
    expect(fake.createCalls[0]?.issueType).toBe('Task');
    expect(fake.createCalls[1]?.issueType).toBe('Subtask');
  });

  it('defaults to Story/Sub-task when the binding has no overrides', async () => {
    writeBinding({ projectKey: 'PROJ' });
    fs.writeFileSync(userCfgPath, JSON.stringify({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.com', apiToken: 't' }));
    writeSpecFile();
    const fake = makeFake();
    const deps: AutoPublishDeps = {
      specQueries: makeQueries(),
      projectRoot: repoRoot,
      makeClient: () => fake.client,
    };

    await autoPublishSpecsOnSync(deps);
    expect(fake.createCalls[0]?.issueType).toBe('Story');
    expect(fake.createCalls[1]?.issueType).toBe('Sub-task');
  });
});

describe('every publish path uses the shared helper (REQ-JIRATEAM-009.A3)', () => {
  it('the MCP publish + reconcile call sites spread bindingIssueTypes', () => {
    // Source-scan (same idiom as REQ-SCOPE-001): each publishSpecToJira call
    // in the MCP layer must resolve types through the ONE shared helper, so
    // no path quietly regresses to hardcoded Story.
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'mcp', 'jira-tools.ts'), 'utf-8');
    const calls = src.split('publishSpecToJira(').length - 1;
    const threaded = src.split('...bindingIssueTypes(').length - 1;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(threaded).toBe(calls);
    const auto = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'jira', 'auto-publish.ts'), 'utf-8');
    expect(auto).toContain('...bindingIssueTypes(');
  });
});

describe('rejected publishes are diagnosable (REQ-JIRATEAM-009.A4)', () => {
  it('compresses errorMessages + field errors into one line', () => {
    expect(
      formatJiraErrorBody({
        errorMessages: ['The sprint is closed.'],
        errors: { issuetype: 'The issue type selected is invalid.' },
      }),
    ).toBe('The sprint is closed. | issuetype: The issue type selected is invalid.');
  });

  it('is empty (never throws) on non-object or empty bodies', () => {
    expect(formatJiraErrorBody(null)).toBe('');
    expect(formatJiraErrorBody('nope')).toBe('');
    expect(formatJiraErrorBody({})).toBe('');
  });

  it('bounds pathological bodies', () => {
    const long = formatJiraErrorBody({ errorMessages: ['x'.repeat(1000)] });
    expect(long.length).toBeLessThanOrEqual(300);
  });
});
