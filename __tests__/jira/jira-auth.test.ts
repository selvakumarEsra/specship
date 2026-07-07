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

  // REQ-JIRA-009.A1 — a validation failure must never echo the token/PAT that
  // WAS supplied. Feed creds that carry a secret but still fail (wrong shape
  // for the declared deployment) so a naive message could leak it.
  it('never puts the apiToken in the thrown message when the email is missing', () => {
    const creds: JiraCredentials = {
      baseUrl: 'https://acme.atlassian.net',
      deployment: 'cloud',
      apiToken: 'tok-super-secret',
    };
    try {
      buildAuthHeader(creds);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraConfigError);
      expect((err as Error).message).not.toContain('tok-super-secret');
    }
  });

  it('never puts the PAT in the thrown message on a cloud/datacenter mismatch', () => {
    // A PAT supplied but the deployment declared cloud → cloud path throws on
    // the missing email/token; the stray PAT must not surface in the message.
    const creds: JiraCredentials = {
      baseUrl: 'https://jira.acme.internal',
      deployment: 'cloud',
      pat: 'pat-super-secret',
    };
    try {
      buildAuthHeader(creds);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraConfigError);
      expect((err as Error).message).not.toContain('pat-super-secret');
    }
  });
});
