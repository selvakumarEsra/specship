import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';
import { handleSpecshipJiraIssues } from '../../src/mcp/jira-tools';
import { JiraClient } from '../../src/jira/client';

/**
 * REQ-JIRATEAM-007 A1 — with an epic binding, specship_jira_issues MUST
 * narrow the list to that epic's open stories/tasks (so the same tool used
 * by the pick flow surfaces exactly the anchor-eligible work).
 *
 * We drive the tool via env-credentials + a spy on JiraClient.listMyIssues
 * so the JQL scoping is asserted structurally, no host contacted.
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
let repoRoot: string;
let savedCwd: string;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-epic-scope-'));
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'jane@acme.com';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok-secret-123';
  process.env.SPECSHIP_JIRA_DEPLOYMENT = 'cloud';
  process.env.SPECSHIP_JIRA_CONFIG = path.join(repoRoot, 'absent.json');
  savedCwd = process.cwd();
  process.chdir(repoRoot);
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  fs.rmSync(repoRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeBinding(binding: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify({ jira: binding }, null, 2),
  );
}

describe('handleSpecshipJiraIssues epic scoping (REQ-JIRATEAM-007.A1)', () => {
  it('adds an epic JQL clause when the binding has an epicKey', async () => {
    writeBinding({ projectKey: 'PROJ', epicKey: 'PROJ-1' });
    const spy = vi
      .spyOn(JiraClient.prototype, 'listMyIssues')
      .mockResolvedValue({ ok: true, issues: [] });
    await handleSpecshipJiraIssues({});
    expect(spy).toHaveBeenCalled();
    const opts = spy.mock.calls[0][0] as { epicKey?: string } | undefined;
    expect(opts?.epicKey).toBe('PROJ-1');
  });

  it('does not add an epic clause when there is no epic binding', async () => {
    writeBinding({ projectKey: 'PROJ' });
    const spy = vi
      .spyOn(JiraClient.prototype, 'listMyIssues')
      .mockResolvedValue({ ok: true, issues: [] });
    await handleSpecshipJiraIssues({});
    const opts = spy.mock.calls[0][0] as { epicKey?: string } | undefined;
    expect(opts?.epicKey).toBeUndefined();
  });
});
