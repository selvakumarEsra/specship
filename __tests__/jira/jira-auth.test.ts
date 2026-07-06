import { describe, it, expect } from 'vitest';
import { buildAuthHeader } from '../../src/jira/auth';
import { JiraConfigError, type JiraCredentials } from '../../src/jira/types';

/**
 * REQ-JIRA-001.A1 — auth header shape per deployment.
 */
describe('buildAuthHeader', () => {
  it('builds HTTP Basic for JIRA Cloud', () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
      apiToken: 'tok-123',
    };
    const header = buildAuthHeader(creds);
    const expected =
      'Basic ' + Buffer.from('jane@acme.com:tok-123').toString('base64');
    expect(header).toBe(expected);
  });

  it('builds Bearer for JIRA Data Center', () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://jira.acme.internal',
      deployment: 'datacenter',
      pat: 'pat-abc',
    };
    expect(buildAuthHeader(creds)).toBe('Bearer pat-abc');
  });

  it('throws (without leaking the secret) when cloud creds are incomplete', () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'jane@acme.com',
    };
    expect(() => buildAuthHeader(creds)).toThrow(JiraConfigError);
  });

  it('throws when data center PAT is missing', () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://jira.acme.internal',
      deployment: 'datacenter',
    };
    expect(() => buildAuthHeader(creds)).toThrow(JiraConfigError);
  });
});
