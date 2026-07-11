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
  handleSpecshipJiraPick,
} from '../../src/mcp/jira-tools';
import { getStaticTools } from '../../src/mcp/tools';
import { MarkdownSpecExtractor } from '../../src/extraction/specs/markdown-spec-extractor';

/**
 * REQ-JIRA-004 — the specship_jira_pick MCP tool:
 *   - is registered in the static tool surface with a required `key`,
 *   - fetches the issue and writes a well-formed spec under specs/ (A1),
 *   - re-picking the same key updates in place, no duplicate (A3),
 *   - the written spec indexes with zero error-severity results (A2),
 *   - surfaces an unknown/no-access key as a tool error, no spec written (A2),
 *   - points to "specship jira configure" when unconfigured,
 *   - never leaks the token in any output (JIRA-009).
 * Uses a stubbed fetch + a temp config + a temp project; no network.
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
let projectDir: string;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-pick-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-pick-proj-'));
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
  fs.rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

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

function specFiles(): string[] {
  const dir = path.join(projectDir, 'specs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort();
}

const FIELDS = {
  summary: 'Add a logout button',
  description: 'Users MUST be able to log out from the header menu.',
  status: { name: 'To Do' },
  issuetype: { name: 'Story' },
  subtasks: [
    { key: 'PROJ-2', fields: { summary: 'Wire the endpoint', status: { name: 'To Do' } } },
  ],
};

describe('specship_jira_pick tool registration', () => {
  it('is registered in the static tool surface', () => {
    // JIRA is an opt-in integration (INTEG-TIER-DOC, REQ-INTEG-001): absent
    // from the default surface, present once SPECSHIP_INTEGRATIONS enables it.
    expect(getStaticTools().map(t => t.name)).not.toContain('specship_jira_pick');
    const prev = process.env.SPECSHIP_INTEGRATIONS;
    try {
      process.env.SPECSHIP_INTEGRATIONS = 'jira';
      expect(getStaticTools().map(t => t.name)).toContain('specship_jira_pick');
    } finally {
      if (prev === undefined) delete process.env.SPECSHIP_INTEGRATIONS;
      else process.env.SPECSHIP_INTEGRATIONS = prev;
    }
  });

  it('requires a key string', () => {
    const def = jiraToolDefinitions.find(t => t.name === 'specship_jira_pick');
    expect(def).toBeDefined();
    expect(def!.inputSchema.properties.key.type).toBe('string');
    expect(def!.inputSchema.required ?? []).toContain('key');
  });
});

describe('handleSpecshipJiraPick', () => {
  it('A1/A2: writes a well-formed spec under specs/ that indexes cleanly', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(issueResponse(FIELDS));
    const result = await handleSpecshipJiraPick({
      key: 'PROJ-1',
      projectPath: projectDir,
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('PROJ-1');
    expect(specFiles()).toHaveLength(1);

    const file = path.join(projectDir, 'specs', specFiles()[0]!);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('jira_issue: PROJ-1');
    const extraction = new MarkdownSpecExtractor(file, content).extract();
    expect(extraction.errors.filter(e => e.severity === 'error')).toEqual([]);
    expect(extraction.specs.some(s => s.id === 'REQ-PROJ-1')).toBe(true);
  });

  it('A3: re-picking the same key updates in place, no duplicate', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(issueResponse(FIELDS));
    await handleSpecshipJiraPick({ key: 'PROJ-1', projectPath: projectDir });
    const second = await handleSpecshipJiraPick({
      key: 'PROJ-1',
      projectPath: projectDir,
    });
    expect(second.isError).toBeFalsy();
    expect(text(second)).toMatch(/updated/i);
    expect(specFiles()).toHaveLength(1);
  });

  it('A2: an unknown key surfaces as a tool error and writes no spec', async () => {
    configureCloud();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      type: 'default',
      headers: new Headers(),
      json: async () => ({}),
    } as Partial<Response>);
    const result = await handleSpecshipJiraPick({
      key: 'PROJ-999',
      projectPath: projectDir,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no such issue|access/i);
    expect(specFiles()).toHaveLength(0);
  });

  it('returns a clear message for a missing key arg, no stack, no network', async () => {
    configureCloud();
    const result = await handleSpecshipJiraPick({ projectPath: projectDir });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/issue key is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(specFiles()).toHaveLength(0);
  });

  it('points to "specship jira configure" when unconfigured', async () => {
    const result = await handleSpecshipJiraPick({
      key: 'PROJ-1',
      projectPath: projectDir,
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('specship jira configure');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('JIRA-009: surfaces auth failure without leaking the token', async () => {
    configureCloud();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      type: 'default',
      headers: new Headers(),
      json: async () => ({}),
    } as Partial<Response>);
    const result = await handleSpecshipJiraPick({
      key: 'PROJ-1',
      projectPath: projectDir,
    });
    expect(result.isError).toBe(true);
    const out = text(result);
    expect(out).not.toContain('tok-secret-123');
    expect(out).not.toContain('Basic ');
  });
});
