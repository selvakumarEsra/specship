import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveJiraCredentials } from '../../src/jira/config';
import {
  loadRepoJiraBinding,
  findRepoRoot,
  assertNoCredentialsInRepoConfig,
} from '../../src/jira/repo-config';
import { JiraClient } from '../../src/jira/client';
import { JiraConfigError, type JiraCredentials } from '../../src/jira/types';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';
import { enableGateChecks } from '../../src/enforce/enforce';

/**
 * REQ-JIRATEAM-001 — repo-committed JIRA project binding.
 *
 * The binding shares `specship.config.json` with the enforcement gate
 * config. Credentials NEVER live here; they stay user-level. Precedence:
 * repo binding wins for project identity even over env; credentials always
 * user-level/env.
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
function writeRepoCfg(obj: unknown): void {
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify(obj, null, 2),
  );
}

describe('loadRepoJiraBinding', () => {
  it('returns null when no repo config exists', () => {
    expect(loadRepoJiraBinding(repoRoot)).toEqual({ binding: null, path: null });
  });

  it('returns null when the repo config has no jira block', () => {
    writeRepoCfg({ enforce: { gate: { drift: true } } });
    const { binding } = loadRepoJiraBinding(repoRoot);
    expect(binding).toBeNull();
  });

  it('reads a valid binding', () => {
    writeRepoCfg({
      jira: {
        projectKey: 'ACME',
        storyIssueType: 'Story',
        subtaskIssueType: 'Sub-task',
        board: 42,
        sprint: 'Sprint 7',
      },
    });
    const { binding, path: p } = loadRepoJiraBinding(repoRoot);
    expect(binding).toEqual({
      projectKey: 'ACME',
      storyIssueType: 'Story',
      subtaskIssueType: 'Sub-task',
      board: 42,
      sprint: 'Sprint 7',
    });
    expect(p).toBe(path.join(repoRoot, ENFORCE_CONFIG_FILE));
  });

  it('walks up from a nested subdirectory to find the repo config', () => {
    writeRepoCfg({ jira: { projectKey: 'ACME' } });
    const nested = path.join(repoRoot, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    const { binding } = loadRepoJiraBinding(nested);
    expect(binding?.projectKey).toBe('ACME');
  });

  it('throws when the jira block has no projectKey', () => {
    writeRepoCfg({ jira: { storyIssueType: 'Story' } });
    expect(() => loadRepoJiraBinding(repoRoot)).toThrow(JiraConfigError);
  });
});

describe('findRepoRoot', () => {
  it('finds a directory that contains specship.config.json', () => {
    writeRepoCfg({ jira: { projectKey: 'ACME' } });
    expect(findRepoRoot(repoRoot)).toBe(repoRoot);
  });

  it('falls back to a .git directory when no config file exists', () => {
    fs.mkdirSync(path.join(repoRoot, '.git'));
    expect(findRepoRoot(repoRoot)).toBe(repoRoot);
  });
});

describe('assertNoCredentialsInRepoConfig', () => {
  const fields = [
    'email',
    'apiToken',
    'token',
    'password',
    'username',
    'host',
    'baseUrl',
    'pat',
  ];
  for (const field of fields) {
    it(`rejects a jira.${field} field`, () => {
      const p = '/tmp/specship.config.json';
      expect(() =>
        assertNoCredentialsInRepoConfig(
          { jira: { projectKey: 'ACME', [field]: 'x' } },
          p,
        ),
      ).toThrow(JiraConfigError);
      try {
        assertNoCredentialsInRepoConfig(
          { jira: { projectKey: 'ACME', [field]: 'super-secret-value' } },
          p,
        );
      } catch (err) {
        // Names the file, names the field, points at user config.
        expect((err as Error).message).toContain(p);
        expect((err as Error).message).toContain(`jira.${field}`);
        expect((err as Error).message).toContain('~/.specship/jira.json');
        // Never echoes the value.
        expect((err as Error).message).not.toContain('super-secret-value');
      }
    });
  }
  it('accepts a config with no jira block', () => {
    expect(() =>
      assertNoCredentialsInRepoConfig({ enforce: {} }, '/x'),
    ).not.toThrow();
  });
});

describe('resolveJiraCredentials — repo binding', () => {
  it('A1: two clones with identical repo config yield the same project', () => {
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    });
    const clone1 = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-a-'));
    const clone2 = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-b-'));
    try {
      const binding = { jira: { projectKey: 'ACME' } };
      fs.writeFileSync(
        path.join(clone1, ENFORCE_CONFIG_FILE),
        JSON.stringify(binding),
      );
      fs.writeFileSync(
        path.join(clone2, ENFORCE_CONFIG_FILE),
        JSON.stringify(binding),
      );
      const a = resolveJiraCredentials(clone1);
      const b = resolveJiraCredentials(clone2);
      expect(a.project).toBe('ACME');
      expect(b.project).toBe('ACME');
      expect(a.bindingSource).toBe('repo');
      expect(b.bindingSource).toBe('repo');
    } finally {
      fs.rmSync(clone1, { recursive: true, force: true });
      fs.rmSync(clone2, { recursive: true, force: true });
    }
  });

  it('A2: repo config with an apiToken under jira is rejected and user config is untouched', () => {
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'user-tok',
    });
    writeRepoCfg({
      jira: { projectKey: 'ACME', apiToken: 'leaked-into-repo' },
    });
    try {
      resolveJiraCredentials(repoRoot);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain(path.join(repoRoot, ENFORCE_CONFIG_FILE));
      expect(msg).toContain('jira.apiToken');
      // The offending value is never echoed.
      expect(msg).not.toContain('leaked-into-repo');
    }
    // User config file is unchanged after the failed resolve.
    const stillThere = JSON.parse(fs.readFileSync(userCfgPath, 'utf-8'));
    expect(stillThere.apiToken).toBe('user-tok');
  });

  it('A3: no repo file → user-level project is returned (solo-lane parity)', () => {
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
      project: 'SOLO',
    });
    const creds = resolveJiraCredentials(repoRoot);
    expect(creds.project).toBe('SOLO');
    expect(creds.bindingSource).toBe('user');
    expect(creds.bindingPath).toBeUndefined();
  });

  it('precedence: repo binding overrides user-level project', () => {
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
      project: 'SOLO',
    });
    writeRepoCfg({ jira: { projectKey: 'TEAM' } });
    const creds = resolveJiraCredentials(repoRoot);
    expect(creds.project).toBe('TEAM');
    expect(creds.bindingSource).toBe('repo');
  });

  it('precedence: repo binding overrides SPECSHIP_JIRA_PROJECT env for project identity', () => {
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    });
    writeRepoCfg({ jira: { projectKey: 'TEAM' } });
    process.env.SPECSHIP_JIRA_PROJECT = 'ENV_PROJECT';
    const creds = resolveJiraCredentials(repoRoot);
    // Repo binding wins even over env for project identity (REQ-JIRATEAM-001).
    expect(creds.project).toBe('TEAM');
  });

  it('precedence: credentials still resolve from user config + env, never repo', () => {
    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'user-tok',
    });
    writeRepoCfg({ jira: { projectKey: 'TEAM' } });
    process.env.SPECSHIP_JIRA_EMAIL = 'env@acme.com';
    const creds = resolveJiraCredentials(repoRoot);
    expect(creds.apiToken).toBe('user-tok');
    expect(creds.email).toBe('env@acme.com');
    expect(creds.project).toBe('TEAM');
  });

  it('coexists with the enforce block written by enableGateChecks', () => {
    writeRepoCfg({ jira: { projectKey: 'TEAM' } });
    // Simulate the enforce writer merging into the same file.
    enableGateChecks(repoRoot, ['drift']);
    const written = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ENFORCE_CONFIG_FILE), 'utf-8'),
    );
    // Both blocks are preserved side by side.
    expect(written.jira).toEqual({ projectKey: 'TEAM' });
    expect(written.enforce?.gate?.drift).toBe(true);

    writeUserCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    });
    const creds = resolveJiraCredentials(repoRoot);
    expect(creds.project).toBe('TEAM');
  });
});

describe('JiraClient.verifyProjectAccess — A4', () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function resp(status: number, body: unknown): Partial<Response> {
    return {
      ok: status >= 200 && status < 300,
      status,
      type: 'default',
      json: async () => body,
      headers: new Headers(),
    };
  }

  it('wraps a 403 with projectKey, host, and binding path when bound via repo', async () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: 'tok',
      project: 'TEAM',
      bindingSource: 'repo',
      bindingPath: '/repo/specship.config.json',
    };
    fetchMock.mockResolvedValueOnce(resp(403, { errorMessages: ['forbidden'] }));
    const client = new JiraClient(creds);
    try {
      await client.verifyProjectAccess('TEAM');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain('TEAM');
      expect(msg).toContain('acme.atlassian.net');
      expect(msg).toContain('/repo/specship.config.json');
    }
  });

  it('wraps a 404 similarly (project does not exist on that host)', async () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: 'tok',
      project: 'GHOST',
      bindingSource: 'repo',
      bindingPath: '/repo/specship.config.json',
    };
    fetchMock.mockResolvedValueOnce(resp(404, {}));
    const client = new JiraClient(creds);
    await expect(client.verifyProjectAccess('GHOST')).rejects.toThrow(
      /GHOST/,
    );
  });

  it('does NOT wrap when the project came from the user-level config', async () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: 'tok',
      project: 'SOLO',
      bindingSource: 'user',
    };
    fetchMock.mockResolvedValueOnce(resp(403, {}));
    const client = new JiraClient(creds);
    try {
      await client.verifyProjectAccess('SOLO');
      throw new Error('should have thrown');
    } catch (err) {
      // Original auth error, not the repo-binding wrap.
      expect((err as Error).message).not.toContain('bound via');
    }
  });

  it('succeeds silently on 200', async () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: 'tok',
      project: 'TEAM',
      bindingSource: 'repo',
      bindingPath: '/repo/specship.config.json',
    };
    fetchMock.mockResolvedValueOnce(resp(200, { key: 'TEAM' }));
    const client = new JiraClient(creds);
    await expect(client.verifyProjectAccess('TEAM')).resolves.toBeUndefined();
  });
});
