/**
 * REQ-JIRATEAM-004 — MCP wiring of specship_jira_coverage.
 *
 * A3/A4: the tool is read-only over JIRA unless `post: true` is passed; when
 * posting, it upserts a single watermarked comment (never a transition).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleSpecshipJiraCoverage } from '../../src/mcp/jira-tools';
import type { JiraIssueListResult } from '../../src/jira/types';

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-cov-mcp-'));
  fs.mkdirSync(path.join(tmp, 'specs'));
});
afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function configured(): void {
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'a@b.c';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'token';
  process.env.SPECSHIP_JIRA_PROJECT = 'PROJ';
}

function text(r: { content: Array<{ text: string }> }): string {
  return r.content.map((c) => c.text).join('\n');
}

describe('handleSpecshipJiraCoverage (REQ-JIRATEAM-004)', () => {
  it('not-configured returns a clear pointer', async () => {
    const r = await handleSpecshipJiraCoverage(
      {},
      { specQueries: {}, projectRoot: tmp },
    );
    expect(text(r)).toMatch(/not configured/i);
  });

  it('happy path: renders coverage markdown and makes zero writes', async () => {
    configured();
    const writes: string[] = [];
    const make = () => ({
      async listSprintIssues(): Promise<JiraIssueListResult> {
        return {
          ok: true,
          issues: [
            { key: 'PROJ-1', id: '1', summary: 'A', status: 'To Do', issueType: 'Story' },
          ],
        };
      },
      async listCommentsDetailed() {
        writes.push('list-comments');
        return [];
      },
      async addComment() {
        writes.push('add');
        return { id: 'c1' };
      },
      async updateComment() {
        writes.push('update');
      },
    });
    const specQueries = {
      getAllSpecs: () => [],
      getLinksBySpec: () => [],
      getSpecsByParent: () => [],
    };
    const r = await handleSpecshipJiraCoverage(
      {},
      { specQueries, projectRoot: tmp, makeJiraClient: make },
    );
    const out = text(r);
    expect(r.isError).toBeFalsy();
    expect(out).toMatch(/Sprint coverage/);
    expect(out).toContain('PROJ-1');
    expect(out).toContain('unspecced');
    // A4: no write call fired.
    expect(writes).toHaveLength(0);
  });

  it('post=true without issue_key returns a directed message and makes no writes', async () => {
    configured();
    let posted = false;
    const make = () => ({
      async listSprintIssues(): Promise<JiraIssueListResult> {
        return { ok: true, issues: [] };
      },
      async listCommentsDetailed() {
        posted = true;
        return [];
      },
      async addComment() {
        posted = true;
        return { id: 'c1' };
      },
      async updateComment() {
        posted = true;
      },
    });
    const r = await handleSpecshipJiraCoverage(
      { post: true },
      { specQueries: {}, projectRoot: tmp, makeJiraClient: make },
    );
    expect(text(r)).toMatch(/issue_key/);
    expect(posted).toBe(false);
  });

  it('post=true with issue_key upserts a single watermarked comment', async () => {
    configured();
    const state = { comments: [] as Array<{ id: string; body: string }> };
    const make = () => ({
      async listSprintIssues(): Promise<JiraIssueListResult> {
        return { ok: true, issues: [] };
      },
      async listCommentsDetailed() {
        return [...state.comments];
      },
      async addComment(_key: string, body: string) {
        const id = `c${state.comments.length + 1}`;
        state.comments.push({ id, body });
        return { id };
      },
      async updateComment(_key: string, id: string, body: string) {
        const i = state.comments.findIndex((c) => c.id === id);
        state.comments[i] = { id, body };
      },
    });
    const specQueries = {
      getAllSpecs: () => [],
      getLinksBySpec: () => [],
      getSpecsByParent: () => [],
    };
    const deps = { specQueries, projectRoot: tmp, makeJiraClient: make };
    await handleSpecshipJiraCoverage({ post: true, issue_key: 'PROJ-EPIC' }, deps);
    await handleSpecshipJiraCoverage({ post: true, issue_key: 'PROJ-EPIC' }, deps);
    // Re-post edited in place; still exactly one watermarked comment.
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0].body).toContain('specship:coverage');
  });
});
