import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  jiraConfigPath,
  loadJiraConfig,
  resolveJiraCredentials,
  saveJiraConfig,
  inferDeployment,
} from '../../src/jira/config';
import { JiraConfigError } from '../../src/jira/types';

/**
 * REQ-JIRA-001.A2 — config load/resolve. Env override beats file;
 * malformed/missing throws; deployment inference; 0600 on disk; the
 * config is user-level only and never read from the project tree.
 */

let tmp: string;
let cfgPath: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_DEPLOYMENT',
  'SPECSHIP_JIRA_TRANSITION_IN_PROGRESS',
  'SPECSHIP_JIRA_TRANSITION_IN_REVIEW',
];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-cfg-'));
  cfgPath = path.join(tmp, 'jira.json');
  process.env.SPECSHIP_JIRA_CONFIG = cfgPath;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeCfg(obj: unknown): void {
  fs.writeFileSync(cfgPath, JSON.stringify(obj));
}

describe('jiraConfigPath', () => {
  it('honors SPECSHIP_JIRA_CONFIG override', () => {
    expect(jiraConfigPath()).toBe(cfgPath);
  });

  it('defaults to ~/.specship/jira.json (user-level, never project)', () => {
    delete process.env.SPECSHIP_JIRA_CONFIG;
    const p = jiraConfigPath();
    expect(p).toBe(path.join(os.homedir(), '.specship', 'jira.json'));
    // Never a project-scoped path.
    expect(p.startsWith(process.cwd())).toBe(false);
  });
});

describe('inferDeployment', () => {
  it('infers datacenter for a PAT-only config', () => {
    expect(inferDeployment({ pat: 'p' })).toBe('datacenter');
  });
  it('infers cloud for email + token', () => {
    expect(inferDeployment({ email: 'e', apiToken: 't' })).toBe('cloud');
  });
  it('lets an explicit deployment win', () => {
    expect(
      inferDeployment({ deployment: 'cloud', pat: 'p' }),
    ).toBe('cloud');
  });
  it('throws when nothing is provided', () => {
    expect(() => inferDeployment({})).toThrow(JiraConfigError);
  });
});

describe('loadJiraConfig', () => {
  it('returns null when the file is absent', () => {
    expect(loadJiraConfig()).toBeNull();
  });
  it('throws JiraConfigError on malformed JSON', () => {
    fs.writeFileSync(cfgPath, '{ not json');
    expect(() => loadJiraConfig()).toThrow(JiraConfigError);
  });
  it('throws JiraConfigError when the JSON is not an object', () => {
    fs.writeFileSync(cfgPath, '"a string"');
    expect(() => loadJiraConfig()).toThrow(JiraConfigError);
  });
});

describe('resolveJiraCredentials', () => {
  it('reads from the config file', () => {
    writeCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    });
    const creds = resolveJiraCredentials();
    expect(creds.baseUrl).toBe('https://acme.atlassian.net');
    expect(creds.deployment).toBe('cloud');
    expect(creds.email).toBe('jane@acme.com');
    expect(creds.apiToken).toBe('tok');
  });

  // REQ-JIRA-007 — lifecycle transition names are configurable, with sensible
  // defaults so an unconfigured project still pushes status.
  it('defaults transitions to In Progress / In Review when unconfigured', () => {
    writeCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    });
    const creds = resolveJiraCredentials();
    expect(creds.transitions).toEqual({
      inProgress: 'In Progress',
      inReview: 'In Review',
      done: 'Done',
    });
  });

  it('reads transition names from the config file', () => {
    writeCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
      transitions: { inProgress: 'Start work', inReview: 'Review' },
    });
    const creds = resolveJiraCredentials();
    expect(creds.transitions).toEqual({
      inProgress: 'Start work',
      inReview: 'Review',
      done: 'Done',
    });
  });

  it('env overrides the file transition names, per field', () => {
    writeCfg({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
      transitions: { inProgress: 'Start work', inReview: 'Review' },
    });
    process.env.SPECSHIP_JIRA_TRANSITION_IN_PROGRESS = 'Doing';
    const creds = resolveJiraCredentials();
    expect(creds.transitions?.inProgress).toBe('Doing');
    // Unset env field falls back to the file value.
    expect(creds.transitions?.inReview).toBe('Review');
  });

  it('env override beats the file (per field)', () => {
    writeCfg({
      baseUrl: 'https://file.atlassian.net',
      email: 'file@acme.com',
      apiToken: 'file-tok',
    });
    process.env.SPECSHIP_JIRA_BASE_URL = 'https://env.atlassian.net';
    process.env.SPECSHIP_JIRA_EMAIL = 'env@acme.com';
    process.env.SPECSHIP_JIRA_API_TOKEN = 'env-tok';
    const creds = resolveJiraCredentials();
    expect(creds.baseUrl).toBe('https://env.atlassian.net');
    expect(creds.email).toBe('env@acme.com');
    expect(creds.apiToken).toBe('env-tok');
  });

  it('resolves a Data Center PAT config to datacenter', () => {
    writeCfg({ baseUrl: 'https://jira.acme.internal', pat: 'pat-1' });
    const creds = resolveJiraCredentials();
    expect(creds.deployment).toBe('datacenter');
    expect(creds.pat).toBe('pat-1');
  });

  it('throws when no base URL is configured', () => {
    writeCfg({ email: 'jane@acme.com', apiToken: 'tok' });
    // remove baseUrl to force the error path
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ email: 'jane@acme.com', apiToken: 'tok' }),
    );
    expect(() => resolveJiraCredentials()).toThrow(JiraConfigError);
  });

  it('throws when cloud creds are incomplete', () => {
    writeCfg({
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
    });
    expect(() => resolveJiraCredentials()).toThrow(JiraConfigError);
  });

  it('propagates a malformed-file error', () => {
    fs.writeFileSync(cfgPath, 'not json at all');
    expect(() => resolveJiraCredentials()).toThrow(JiraConfigError);
  });

  // REQ-JIRA-009.A1 — even when a secret IS on disk, a resolution failure must
  // not echo it back. A base-URL-less config still carries the apiToken, so a
  // naive "here's your config" message could leak it.
  it('never echoes the apiToken when the base URL is missing', () => {
    writeCfg({ email: 'jane@acme.com', apiToken: 'tok-super-secret' });
    try {
      resolveJiraCredentials();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraConfigError);
      expect((err as Error).message).not.toContain('tok-super-secret');
    }
  });

  it('never echoes the token on a deployment/credential mismatch', () => {
    // Explicit datacenter but only an email+token pair on disk → the PAT check
    // throws while the apiToken sits in the resolved config; it must stay out
    // of the message.
    writeCfg({
      baseUrl: 'https://jira.acme.internal',
      deployment: 'datacenter',
      email: 'jane@acme.com',
      apiToken: 'tok-super-secret',
    });
    try {
      resolveJiraCredentials();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraConfigError);
      expect((err as Error).message).not.toContain('tok-super-secret');
    }
  });
});

describe('saveJiraConfig', () => {
  it('writes the file with 0600 permissions', () => {
    saveJiraConfig({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    });
    expect(fs.existsSync(cfgPath)).toBe(true);
    const mode = fs.statSync(cfgPath).mode & 0o777;
    // POSIX only — Windows doesn't honor chmod bits.
    if (process.platform !== 'win32') {
      expect(mode).toBe(0o600);
    }
    const roundTrip = loadJiraConfig();
    expect(roundTrip?.baseUrl).toBe('https://acme.atlassian.net');
  });
});
