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
  handleSpecshipJiraIssue,
} from '../../src/mcp/jira-tools';
import { getStaticTools } from '../../src/mcp/tools';

/**
 * REQ-JIRA-003 — the specship_jira_issue MCP tool:
 *   - is registered in the static tool surface with a required `key`,
 *   - formats the full issue detail (A1: description + subtasks),
 *   - surfaces an unknown/no-access key as a tool error, not a silent empty
 *     spec (A2), tolerating an empty description,
 *   - points to "specship jira configure" when unconfigured,
 *   - returns a clear message for a missing `key` arg (no stack),
 *   - never leaks the token in any output (JIRA-009).
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
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-mcp-issue-'));
  process.env.SPECSHIP_JIRA_CONFIG = path.join(tmpDir, 'absent.json');
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
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

function issueResponse(fields: Record<string, unknown>): Partial<Response> {
  return {
    ok: true,
    status: 200,
    type: 'default',
    headers: new Headers(),
    json: async () => ({ key: 'PROJ-1', id: '1', fields }),
  };
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map(c => c.text).join('\n');
}

describe('specship_jira_issue tool registration', () => {
  it('is registered in the static tool surface', () => {
    const names = getStaticTools().map(t => t.name);
    expect(names).toContain('specship_jira_issue');
  });

  it('requires a key string', () => {
    const def = jiraToolDefinitions.find(t => t.name === 'specship_jira_issue');
    expect(def).toBeDefined();
    expect(def!.inputSchema.properties.key.type).toBe('string');
    expect(def!.inputSchema.required ?? []).toContain('key');
  });
});

describe('handleSpecshipJiraIssue', () => {
  it('A1: formats the full issue detail with description and subtasks', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(
      issueResponse({
        summary: 'Fix the thing',
        description: 'A longer body describing the work.',
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        subtasks: [
          {
            key: 'PROJ-2',
            fields: { summary: 'Sub one', status: { name: 'To Do' } },
          },
        ],
      }),
    );
    const result = await handleSpecshipJiraIssue({ key: 'PROJ-1' });
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain('PROJ-1');
    expect(out).toContain('Fix the thing');
    expect(out).toContain('In Progress');
    expect(out).toContain('Bug');
    expect(out).toContain('A longer body describing the work.');
    expect(out).toContain('PROJ-2');
    expect(out).toContain('Sub one');
    // A3: professional layout — a property table + a subtasks table, not bullets.
    expect(out).toContain('| Field | Value |');
    expect(out).toContain('| Status | In Progress |');
    expect(out).toContain('| Type | Bug |');
    expect(out).toContain('| Key | Summary | Status |');
    expect(out).toContain('| PROJ-2 | Sub one | To Do |');
    expect(out).not.toMatch(/^- \*\*Status/m);
  });

  it('A1: tolerates an empty description', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(
      issueResponse({
        summary: 'No body',
        status: { name: 'To Do' },
        issuetype: { name: 'Story' },
      }),
    );
    const result = await handleSpecshipJiraIssue({ key: 'PROJ-1' });
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain('No body');
    expect(out).not.toContain('[object Object]');
  });

  it('A2: surfaces an unknown key as a tool error, not a silent empty spec', async () => {
    configureCloud();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      type: 'default',
      headers: new Headers(),
      json: async () => ({}),
    } as Partial<Response>);
    const result = await handleSpecshipJiraIssue({ key: 'PROJ-999' });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no such issue|access/i);
  });

  it('returns a clear message for a missing key arg, no stack', async () => {
    configureCloud();
    const result = await handleSpecshipJiraIssue({});
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/issue key is required/i);
    // Never touched the network for a plainly-invalid call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('points to "specship jira configure" when unconfigured', async () => {
    const result = await handleSpecshipJiraIssue({ key: 'PROJ-1' });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('specship jira configure');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('A2 / JIRA-009: surfaces auth failure without leaking the token', async () => {
    configureCloud();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      type: 'default',
      headers: new Headers(),
      json: async () => ({}),
    } as Partial<Response>);
    const result = await handleSpecshipJiraIssue({ key: 'PROJ-1' });
    expect(result.isError).toBe(true);
    const out = text(result);
    expect(out).not.toContain('tok-secret-123');
    expect(out).not.toContain('Basic ');
  });
});
