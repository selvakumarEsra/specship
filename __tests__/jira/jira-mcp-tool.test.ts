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
  jiraToolDefinitions,
  handleSpecshipJiraIssues,
} from '../../src/mcp/jira-tools';
import { getStaticTools } from '../../src/mcp/tools';

/**
 * REQ-JIRA-002 — the specship_jira_issues MCP tool:
 *   - is registered in the static tool surface,
 *   - formats the assigned issues (A1) / an explicit empty state (A3),
 *   - points to "specship jira configure" when unconfigured,
 *   - surfaces auth/network failures without leaking the token (A4, JIRA-009).
 * Uses a stubbed fetch + a temp config; no network, no real credentials.
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
let savedCwd: string;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-mcp-'));
  // Point the config at a definitely-absent file so nothing bleeds in from
  // the real home; individual tests opt into config/env as needed.
  process.env.SPECSHIP_JIRA_CONFIG = path.join(tmpDir, 'absent.json');
  // Handlers resolve the repo binding from process.cwd() — chdir into the
  // temp dir so a `jira` binding in the DEVELOPMENT repo's own
  // specship.config.json can't bleed into these assertions.
  savedCwd = process.cwd();
  process.chdir(tmpDir);
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  process.chdir(savedCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Configure Cloud credentials via env (no file needed). */
function configureCloud(): void {
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'jane@acme.com';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok-secret-123';
  process.env.SPECSHIP_JIRA_DEPLOYMENT = 'cloud';
}

function searchResponse(
  issues: Array<{
    key: string;
    id: string;
    summary: string;
    status: string;
    type: string;
  }>,
): Partial<Response> {
  return {
    ok: true,
    status: 200,
    type: 'default',
    headers: new Headers(),
    json: async () => ({
      issues: issues.map(i => ({
        key: i.key,
        id: i.id,
        fields: {
          summary: i.summary,
          status: { name: i.status },
          issuetype: { name: i.type },
        },
      })),
    }),
  };
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map(c => c.text).join('\n');
}

describe('specship_jira_issues tool registration', () => {
  it('is registered in the static tool surface', () => {
    // JIRA is an opt-in integration (INTEG-TIER-DOC, REQ-INTEG-001): absent
    // from the default surface, present once SPECSHIP_INTEGRATIONS enables it.
    expect(getStaticTools().map(t => t.name)).not.toContain('specship_jira_issues');
    const prev = process.env.SPECSHIP_INTEGRATIONS;
    try {
      process.env.SPECSHIP_INTEGRATIONS = 'jira';
      expect(getStaticTools().map(t => t.name)).toContain('specship_jira_issues');
    } finally {
      if (prev === undefined) delete process.env.SPECSHIP_INTEGRATIONS;
      else process.env.SPECSHIP_INTEGRATIONS = prev;
    }
  });

  it('exposes an optional project string, no required fields', () => {
    const def = jiraToolDefinitions.find(
      t => t.name === 'specship_jira_issues',
    );
    expect(def).toBeDefined();
    expect(def!.inputSchema.properties.project.type).toBe('string');
    expect(def!.inputSchema.required ?? []).not.toContain('project');
  });
});

describe('handleSpecshipJiraIssues', () => {
  it('A1: formats the assigned issues as markdown', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(
      searchResponse([
        {
          key: 'PROJ-1',
          id: '1',
          summary: 'Fix the thing',
          status: 'In Progress',
          type: 'Bug',
        },
      ]),
    );
    const result = await handleSpecshipJiraIssues({});
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain('PROJ-1');
    expect(out).toContain('Fix the thing');
    expect(out).toContain('In Progress');
    expect(out).toContain('Bug');
  });

  it('A6: renders a table (no conversational preamble)', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(
      searchResponse([
        { key: 'PROJ-1', id: '1', summary: 'Fix the thing', status: 'In Progress', type: 'Bug' },
      ]),
    );
    const out = text(await handleSpecshipJiraIssues({}));
    // Professional table, not a prose bullet list.
    expect(out).toContain('| Key | Summary | Status | Type |');
    expect(out).toContain('| --- | --- | --- | --- |');
    expect(out).toContain('| PROJ-1 | Fix the thing | In Progress | Bug |');
    expect(out).not.toMatch(/issues assigned to you \(\d+\)/i); // no chatty preamble
    // No bottom note when there's nothing to flag (no filter, under the cap).
    expect(out).not.toContain('> Note:');
  });

  it('A6: adds a bottom note when a project filter is applied', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(
      searchResponse([
        { key: 'PROJ-1', id: '1', summary: 'Fix the thing', status: 'To Do', type: 'Task' },
      ]),
    );
    const out = text(await handleSpecshipJiraIssues({ project: 'PROJ' }));
    expect(out).toContain('| Key | Summary | Status | Type |');
    expect(out).toMatch(/> Note:.*project PROJ/i);
  });

  it('A6: the empty state carries a terse bottom note', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(searchResponse([]));
    const out = text(await handleSpecshipJiraIssues({}));
    expect(out).toMatch(/no issues assigned/i);
    expect(out).toContain('> Note:');
  });

  it('A2: passes the project filter through to the JQL', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(searchResponse([]));
    await handleSpecshipJiraIssues({ project: 'PROJ' });
    const url = String(fetchMock.mock.calls[0][0]);
    const jql = new URL(url).searchParams.get('jql') ?? '';
    expect(jql).toContain('project = "PROJ"');
  });

  it('A3: shows an explicit empty state, not an error', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(searchResponse([]));
    const result = await handleSpecshipJiraIssues({});
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/no issues assigned/i);
  });

  it('points to "specship jira configure" when unconfigured', async () => {
    // No env creds, config path is absent → not configured.
    const result = await handleSpecshipJiraIssues({});
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain('specship jira configure');
    // Never touched the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('A4: surfaces an auth failure as a tool error without the token', async () => {
    configureCloud();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      type: 'default',
      headers: new Headers(),
      json: async () => ({}),
    } as Partial<Response>);
    const result = await handleSpecshipJiraIssues({});
    expect(result.isError).toBe(true);
    const out = text(result);
    expect(out).not.toContain('tok-secret-123');
    expect(out).not.toContain('Basic ');
  });

  it('A4: surfaces a network failure as a tool error without the token', async () => {
    configureCloud();
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const result = await handleSpecshipJiraIssues({});
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain('tok-secret-123');
  });
});
