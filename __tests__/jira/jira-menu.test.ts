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
  handleSpecshipJiraEpics,
} from '../../src/mcp/jira-tools';
import { getStaticTools } from '../../src/mcp/tools';
import {
  loadRepoJiraBinding,
  updateRepoJiraBinding,
  assertNoCredentialsInRepoConfig,
} from '../../src/jira/repo-config';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';
import { JiraConfigError } from '../../src/jira/types';

/**
 * REQ-JIRATEAM-008 — the /specship:jira menu wiring:
 *   - specship_jira_epics is registered in the static tool surface behind the
 *     opt-in integration gate and lists epics from JIRA,
 *   - it falls back to the repo binding's projectKey when `project` is omitted,
 *     and errors cleanly when neither is set (A2 chain: no bound project → no
 *     epic picker at all),
 *   - updateRepoJiraBinding({ epicKey }) round-trips through
 *     loadRepoJiraBinding so the menu's epic pick is visible on the very next
 *     read — no restart (A2),
 *   - assertNoCredentialsInRepoConfig still trips on the configure path so a
 *     credential-shaped field can never land in the repo config.
 * No real network: fetch is stubbed for the two epic calls; every other test
 * only touches the repo-config module + tmp dirs.
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
let repoRoot: string;
let originalCwd: string;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-menu-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-menu-repo-'));
  // The repo needs a .git marker so findRepoRoot resolves it (no
  // specship.config.json until updateRepoJiraBinding writes one).
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(repoRoot);
  process.env.SPECSHIP_JIRA_CONFIG = path.join(tmpDir, 'absent.json');
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function configureCloud(): void {
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'jane@acme.com';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok-secret-123';
  process.env.SPECSHIP_JIRA_DEPLOYMENT = 'cloud';
}

function epicSearchResponse(
  epics: { key: string; summary: string; status: string }[],
): Partial<Response> {
  return {
    ok: true,
    status: 200,
    type: 'default',
    headers: new Headers(),
    json: async () => ({
      issues: epics.map((e, i) => ({
        key: e.key,
        id: String(i + 1),
        fields: { summary: e.summary, status: { name: e.status } },
      })),
    }),
  };
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map(c => c.text).join('\n');
}

describe('specship_jira_epics tool registration', () => {
  it('is registered under the opt-in JIRA integration gate', () => {
    expect(getStaticTools().map(t => t.name)).not.toContain('specship_jira_epics');
    const prev = process.env.SPECSHIP_INTEGRATIONS;
    try {
      process.env.SPECSHIP_INTEGRATIONS = 'jira';
      expect(getStaticTools().map(t => t.name)).toContain('specship_jira_epics');
    } finally {
      if (prev === undefined) delete process.env.SPECSHIP_INTEGRATIONS;
      else process.env.SPECSHIP_INTEGRATIONS = prev;
    }
  });

  it('accepts an optional project string with no required fields', () => {
    const def = jiraToolDefinitions.find(t => t.name === 'specship_jira_epics');
    expect(def).toBeDefined();
    expect(def!.inputSchema.properties.project.type).toBe('string');
    expect(def!.inputSchema.required ?? []).toEqual([]);
  });
});

describe('handleSpecshipJiraEpics', () => {
  it('lists open epics for an explicit project (JQL scopes to Epic + not Done)', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(
      epicSearchResponse([
        { key: 'PROJ-10', summary: 'Billing epic', status: 'In Progress' },
        { key: 'PROJ-11', summary: 'Onboarding epic', status: 'To Do' },
      ]),
    );

    const result = await handleSpecshipJiraEpics({ project: 'PROJ' });

    expect(result.isError).toBeFalsy();
    const body = text(result);
    expect(body).toContain('PROJ-10');
    expect(body).toContain('Billing epic');
    expect(body).toContain('PROJ-11');
    expect(body).toContain('Project PROJ');
    // The JQL must scope to Epic + non-Done, and must quote the project key
    // (the client escapes it to defeat JQL injection).
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('issuetype+%3D+Epic');
    expect(url).toContain('statusCategory+%21%3D+Done');
    expect(url).toContain('project+%3D+%22PROJ%22');
  });

  it('falls back to the repo binding projectKey when `project` is omitted (A2 chain)', async () => {
    configureCloud();
    updateRepoJiraBinding(repoRoot, { projectKey: 'BOUND' });
    fetchMock.mockResolvedValue(
      epicSearchResponse([
        { key: 'BOUND-1', summary: 'Bound project epic', status: 'To Do' },
      ]),
    );

    const result = await handleSpecshipJiraEpics({});

    expect(result.isError).toBeFalsy();
    const body = text(result);
    expect(body).toContain('BOUND-1');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('project+%3D+%22BOUND%22');
  });

  it('errors cleanly when neither `project` nor a repo binding is set', async () => {
    configureCloud();
    // No binding written; cwd is repoRoot with no specship.config.json.
    const result = await handleSpecshipJiraEpics({});
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no jira project/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('points to `specship jira configure` when unconfigured (never a stack)', async () => {
    // No env credentials; SPECSHIP_JIRA_CONFIG points at a missing file.
    const result = await handleSpecshipJiraEpics({ project: 'PROJ' });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('specship jira configure');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empty JIRA result renders a clear one-liner, not an error', async () => {
    configureCloud();
    fetchMock.mockResolvedValue(epicSearchResponse([]));
    const result = await handleSpecshipJiraEpics({ project: 'PROJ' });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/no open epics/i);
  });
});

describe('updateRepoJiraBinding({ epicKey }) — visible without restart (A2)', () => {
  it('round-trips through loadRepoJiraBinding on the very next call', () => {
    updateRepoJiraBinding(repoRoot, { projectKey: 'PROJ' });
    let loaded = loadRepoJiraBinding(repoRoot);
    expect(loaded.binding?.projectKey).toBe('PROJ');
    expect(loaded.binding?.epicKey).toBeUndefined();

    updateRepoJiraBinding(repoRoot, { epicKey: 'PROJ-42' });

    loaded = loadRepoJiraBinding(repoRoot);
    expect(loaded.binding?.projectKey).toBe('PROJ');
    expect(loaded.binding?.epicKey).toBe('PROJ-42');
  });

  it('preserves other repo-config blocks when updating the epic', () => {
    const file = path.join(repoRoot, ENFORCE_CONFIG_FILE);
    fs.writeFileSync(
      file,
      JSON.stringify({ enforce: { pre_commit: true }, jira: { projectKey: 'PROJ' } }, null, 2),
    );
    updateRepoJiraBinding(repoRoot, { epicKey: 'PROJ-42' });
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(raw.enforce).toEqual({ pre_commit: true });
    expect(raw.jira.epicKey).toBe('PROJ-42');
  });
});

describe('assertNoCredentialsInRepoConfig still guards the configure path', () => {
  it('trips on a credential-shaped field (updateRepoJiraBinding also refuses)', () => {
    const file = path.join(repoRoot, ENFORCE_CONFIG_FILE);
    fs.writeFileSync(
      file,
      JSON.stringify({ jira: { projectKey: 'PROJ', apiToken: 'nope' } }, null, 2),
    );
    expect(() =>
      assertNoCredentialsInRepoConfig({ jira: { apiToken: 'nope' } }, file),
    ).toThrow(JiraConfigError);
    // updateRepoJiraBinding reads the file first and MUST refuse before writing.
    expect(() => updateRepoJiraBinding(repoRoot, { epicKey: 'PROJ-42' })).toThrow(
      JiraConfigError,
    );
  });
});
