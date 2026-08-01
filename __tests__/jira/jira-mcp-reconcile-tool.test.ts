import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  handleSpecshipJiraReconcile,
  type JiraReconcileDeps,
  type JiraReconcileClient,
} from '../../src/mcp/jira-tools';
import {
  buildIssueFields,
  issueContentFingerprint,
  subtaskSummary,
  type PublishJiraClient,
} from '../../src/jira/publish';
import type { JiraIssue, JiraIssueResult } from '../../src/jira/types';

/**
 * REQ-JIRATEAM-005 — the MCP tool. Preview is read-only; apply is
 * preview-gated via a fingerprint the caller MUST have just seen in preview.
 */

const JIRA_ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_DEPLOYMENT',
  'SPECSHIP_JIRA_PROJECT',
];

let saved: Record<string, string | undefined>;
let tmp: string;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.SPECSHIP_JIRA_CONFIG = '/does/not/exist.json';
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'x@x';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok';
  process.env.SPECSHIP_JIRA_PROJECT = 'PROJ';
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-reconcile-'));
  fs.mkdirSync(path.join(tmp, 'specs'), { recursive: true });
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

function writeSpec(opts: {
  filename: string;
  requirementId: string;
  jiraKey: string;
  fingerprint: string | null;
  title: string;
  body: string;
  acceptance?: Array<{ id: string; text: string }>;
}): string {
  const front = ['---', `jira_issue: ${opts.jiraKey}`];
  if (opts.fingerprint) front.push(`jira_fingerprint: ${opts.fingerprint}`);
  front.push('---', '');
  const acc = (opts.acceptance ?? [])
    .map((a) => `<!-- id: ${a.id} -->\n- ${a.text}`)
    .join('\n');
  const src =
    front.join('\n') +
    `<!-- id: ${opts.requirementId} -->\n` +
    `## ${opts.title}\n\n${opts.body}\n\n` +
    (acc ? `## Acceptance\n${acc}\n` : '');
  const abs = path.join(tmp, 'specs', opts.filename);
  fs.writeFileSync(abs, src);
  return abs;
}

function fakeSpecQueries(specs: Array<{
  id: string;
  kind: 'requirement' | 'acceptance';
  title: string;
  body: string;
  sourcePath: string;
  parentId?: string;
}>): unknown {
  return {
    getSpecById(id: string) {
      return specs.find((s) => s.id === id) ?? null;
    },
    getSpecsByParent(id: string) {
      return specs.filter((s) => s.parentId === id);
    },
  };
}

function fakeReconcileClient(byKey: Record<string, JiraIssue>): () => JiraReconcileClient {
  return () => ({
    async getIssue(key: string): Promise<JiraIssueResult> {
      const found = byKey[key];
      if (!found) throw new Error(`no ${key}`);
      return { ok: true, issue: found };
    },
  });
}

/** A minimal publish client that records updates and hands back a fresh subtask list. */
function fakePublishClient(initialSubtasks: Array<{ key: string; summary: string; status: string }>): {
  factory: () => PublishJiraClient;
  updates: Array<{ key: string; summary?: string; description?: string }>;
} {
  const updates: Array<{ key: string; summary?: string; description?: string }> = [];
  return {
    updates,
    factory: () => ({
      async createIssue(fields) {
        return { key: `${fields.projectKey}-new`, id: '999' };
      },
      async updateIssue(key, fields) {
        updates.push({ key, ...fields });
      },
      async getIssue(key: string): Promise<JiraIssueResult> {
        return {
          ok: true,
          issue: {
            key,
            id: key,
            summary: 'x',
            status: 'To Do',
            issueType: 'Story',
            subtasks: initialSubtasks,
          },
        };
      },
      async listProjects() {
        return [{ key: 'PROJ', name: 'Project' }];
      },
    }),
  };
}

function deps(specQueries: unknown, makeJiraClient: () => JiraReconcileClient, publish?: () => PublishJiraClient): JiraReconcileDeps {
  return { specQueries, projectRoot: tmp, makeJiraClient, makePublishClient: publish };
}

describe('handleSpecshipJiraReconcile — REQ-JIRATEAM-005', () => {
  it('A3: preview reports divergences without touching the spec file, twice in a row', async () => {
    const requirementId = 'REQ-PROJ-1';
    const originalTitle = 'Rate-limit login attempts';
    const originalBody = 'Reject >5 failures/min.';
    const acceptance = [{ id: `${requirementId}.A1`, text: 'Return 429 on 6th within 60s.' }];
    const fields = buildIssueFields({
      specId: requirementId,
      title: originalTitle,
      body: originalBody,
      specRelPath: 'specs/proj-1.md',
      acceptance,
    });
    const storedFp = issueContentFingerprint(fields.summary, fields.description);
    const abs = writeSpec({
      filename: 'proj-1.md',
      requirementId,
      jiraKey: 'PROJ-1',
      fingerprint: storedFp,
      title: originalTitle,
      body: originalBody,
      acceptance,
    });
    const bytesBefore = fs.readFileSync(abs, 'utf8');

    // Live issue: summary was edited in JIRA.
    const live: JiraIssue = {
      key: 'PROJ-1',
      id: '1',
      summary: 'Rate-limit login attempts strictly (edited in JIRA)',
      description: 'Rewritten',
      status: 'To Do',
      issueType: 'Story',
      subtasks: [
        { key: 'PROJ-2', summary: subtaskSummary(acceptance[0].text), status: 'To Do' },
      ],
    };
    const sq = fakeSpecQueries([
      { id: requirementId, kind: 'requirement', title: originalTitle, body: originalBody, sourcePath: 'specs/proj-1.md' },
      { id: acceptance[0].id, kind: 'acceptance', title: acceptance[0].text, body: '', sourcePath: 'specs/proj-1.md', parentId: requirementId },
    ]);

    const first = await handleSpecshipJiraReconcile({}, deps(sq, fakeReconcileClient({ 'PROJ-1': live })));
    const firstText = text(first);
    expect(firstText).toContain('PROJ-1');
    expect(firstText).toContain('edited in JIRA');
    expect(firstText).toContain('expected_live_fingerprint');
    // Preview must NOT modify the file.
    expect(fs.readFileSync(abs, 'utf8')).toBe(bytesBefore);

    // Second preview still reports the same divergence.
    const second = await handleSpecshipJiraReconcile({}, deps(sq, fakeReconcileClient({ 'PROJ-1': live })));
    expect(text(second)).toContain('edited in JIRA');
    expect(fs.readFileSync(abs, 'utf8')).toBe(bytesBefore);
  });

  it('apply refuses without a matching expected_live_fingerprint (preview-first gate)', async () => {
    const requirementId = 'REQ-PROJ-1';
    writeSpec({
      filename: 'proj-1.md',
      requirementId,
      jiraKey: 'PROJ-1',
      fingerprint: 'abc123',
      title: 'T',
      body: 'B',
    });
    const live: JiraIssue = {
      key: 'PROJ-1',
      id: '1',
      summary: 'edited',
      description: 'edited',
      status: 'To Do',
      issueType: 'Story',
    };
    const sq = fakeSpecQueries([
      { id: requirementId, kind: 'requirement', title: 'T', body: 'B', sourcePath: 'specs/proj-1.md' },
    ]);

    // Wrong fingerprint → refused.
    const bad = await handleSpecshipJiraReconcile(
      { mode: 'apply', issue_key: 'PROJ-1', accept_content: true, expected_live_fingerprint: 'wrong' },
      deps(sq, fakeReconcileClient({ 'PROJ-1': live })),
    );
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('no matching preview');

    // Missing fingerprint entirely → refused.
    const missing = await handleSpecshipJiraReconcile(
      { mode: 'apply', issue_key: 'PROJ-1', accept_content: true },
      deps(sq, fakeReconcileClient({ 'PROJ-1': live })),
    );
    expect(missing.isError).toBe(true);
  });

  it('A4: apply writes the spec, re-publishes, and next preview is clean', async () => {
    const requirementId = 'REQ-PROJ-1';
    const originalTitle = 'Rate-limit login attempts';
    const originalBody = 'Reject >5 failures/min.';
    const fields = buildIssueFields({
      specId: requirementId,
      title: originalTitle,
      body: originalBody,
      specRelPath: 'specs/proj-1.md',
      acceptance: [],
    });
    const storedFp = issueContentFingerprint(fields.summary, fields.description);
    const abs = writeSpec({
      filename: 'proj-1.md',
      requirementId,
      jiraKey: 'PROJ-1',
      fingerprint: storedFp,
      title: originalTitle,
      body: originalBody,
    });

    const editedSummary = 'Rate-limit login attempts strictly';
    const editedDescription = 'Hard-ban after 5 failures/min.';
    // A shared live-issue reference the fake read + fake update both see.
    const liveIssue: JiraIssue = {
      key: 'PROJ-1',
      id: '1',
      summary: editedSummary,
      description: editedDescription,
      status: 'To Do',
      issueType: 'Story',
      subtasks: [],
    };
    const liveFp = issueContentFingerprint(editedSummary, editedDescription);

    const sq = fakeSpecQueries([
      { id: requirementId, kind: 'requirement', title: originalTitle, body: originalBody, sourcePath: 'specs/proj-1.md' },
    ]);

    // A publish client that mirrors updates onto the shared live issue, so the
    // next `getIssue` reflects what publish just wrote (JIRA-side reality).
    const updates: Array<{ summary?: string; description?: string }> = [];
    const publishClient: PublishJiraClient = {
      async createIssue(f) { return { key: `${f.projectKey}-new`, id: '999' }; },
      async updateIssue(_key, f) {
        updates.push(f);
        if (f.summary !== undefined) liveIssue.summary = f.summary;
        if (f.description !== undefined) liveIssue.description = f.description;
      },
      async getIssue(key) {
        return { ok: true, issue: { ...liveIssue, key } };
      },
      async listProjects() { return [{ key: 'PROJ', name: 'Project' }]; },
    };
    const readClient: () => JiraReconcileClient = () => ({
      async getIssue(key) { return { ok: true, issue: { ...liveIssue, key } }; },
    });

    const applyResult = await handleSpecshipJiraReconcile(
      {
        mode: 'apply',
        issue_key: 'PROJ-1',
        accept_content: true,
        expected_live_fingerprint: liveFp,
      },
      deps(sq, readClient, () => publishClient),
    );
    expect(applyResult.isError).toBeFalsy();
    expect(text(applyResult)).toContain('Applied PROJ-1');

    // Spec file now carries the edited title/body.
    const amended = fs.readFileSync(abs, 'utf8');
    expect(amended).toContain(`## ${editedSummary}`);
    expect(amended).toContain(editedDescription);
    // Publish was called with the edited fields → fingerprint refreshed in
    // frontmatter to what publish would compute from the amended spec.
    expect(updates.length).toBeGreaterThan(0);
    expect(amended).toMatch(/jira_fingerprint: [0-9a-f]+/);
    expect(amended).not.toContain(`jira_fingerprint: ${storedFp}`);

    // Next preview: the index (getSpecById) has caught up (post-sync), and
    // the live issue now mirrors what publish just wrote → no divergence.
    const sqFresh = fakeSpecQueries([
      { id: requirementId, kind: 'requirement', title: editedSummary, body: editedDescription, sourcePath: 'specs/proj-1.md' },
    ]);
    const previewAfter = await handleSpecshipJiraReconcile(
      {},
      deps(sqFresh, readClient),
    );
    expect(text(previewAfter)).toContain('No divergences');
  });
});
