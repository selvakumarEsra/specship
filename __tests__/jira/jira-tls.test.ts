/**
 * JIRA Data Center corporate-TLS support (REQ-JIRATLS-001/002/003).
 *
 * Runs a real local HTTPS server with a committed self-signed certificate
 * (fixtures/tls-cert.pem — test-only, CN=localhost, no real trust value) and
 * exercises the client's TLS opt-ins end-to-end. No real JIRA host is ever
 * contacted and no real credential is used.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { JiraClient } from '../../src/jira/client';
import { resolveJiraCredentials } from '../../src/jira/config';
import { JiraConfigError, JiraAuthError, JiraCredentials } from '../../src/jira/types';

const FIXTURES = path.join(__dirname, 'fixtures');
const CERT = path.join(FIXTURES, 'tls-cert.pem');
const KEY = path.join(FIXTURES, 'tls-key.pem');

let server: https.Server;
let baseUrl: string;
const seenPaths: string[] = [];

function creds(extra: Partial<JiraCredentials> = {}, base = baseUrl): JiraCredentials {
  return { baseUrl: base, deployment: 'datacenter', pat: 'test-pat-value', ...extra };
}

beforeAll(async () => {
  server = https.createServer(
    { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) },
    (req, res) => {
      seenPaths.push(req.url ?? '');
      const url = req.url ?? '';
      if (url.endsWith('/redirect')) {
        res.writeHead(302, { Location: 'https://evil.example.com/' });
        res.end();
        return;
      }
      if (url.endsWith('/unauthorized')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (url.endsWith('/rest/api/2/myself')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'dc.user', displayName: 'DC User' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    },
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `https://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('REQ-JIRATLS-001 — TLS opt-ins', () => {
  it('A1: default settings reject the self-signed certificate', async () => {
    const client = new JiraClient(creds());
    await expect(client.testConnection()).rejects.toThrow(JiraConfigError);
  });

  it('A1: insecureTls connects', async () => {
    const client = new JiraClient(creds({ insecureTls: true }));
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(res.displayName).toBe('DC User');
  });

  it('A1: caCertPath pointing at the server cert connects', async () => {
    const client = new JiraClient(creds({ caCertPath: CERT }));
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(res.accountId).toBe('dc.user');
  });

  it('A3: the TLS transport still refuses redirects', async () => {
    const client = new JiraClient(creds({ insecureTls: true }));
    await expect(
      (client as any).request('/redirect'),
    ).rejects.toThrow(/unexpected redirect/);
  });

  it('A3: the TLS transport maps 401 to JiraAuthError with no PAT in the message', async () => {
    const client = new JiraClient(creds({ insecureTls: true }));
    try {
      await (client as any).request('/unauthorized');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JiraAuthError);
      expect((err as Error).message).not.toContain('test-pat-value');
    }
  });

  it('A4: an unreadable caCertPath fails fast naming only the path', () => {
    const missing = path.join(FIXTURES, 'no-such-ca.pem');
    expect(() => new JiraClient(creds({ caCertPath: missing }))).toThrow(
      new RegExp(`CA certificate at ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });
});

describe('REQ-JIRATLS-002 — actionable connection failures', () => {
  it('A1: a certificate rejection names the opt-ins and the context-path hint, without the PAT', async () => {
    const client = new JiraClient(creds());
    try {
      await client.testConnection();
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('SPECSHIP_JIRA_CA_CERT');
      expect(msg).toContain('context path');
      expect(msg).not.toContain('test-pat-value');
      // The undici cause code is surfaced instead of the bare "fetch failed".
      expect(msg).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|CERT/i);
    }
  });
});

describe('REQ-JIRATLS-003 — context-path base URLs', () => {
  it('A1: a base URL with a context path requests <contextPath>/rest/api/2/myself', async () => {
    seenPaths.length = 0;
    const client = new JiraClient(
      creds({ insecureTls: true }, `${baseUrl}/ctx`),
    );
    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(seenPaths).toContain('/ctx/rest/api/2/myself');
  });
});

describe('config resolution (REQ-JIRATLS-001.A2)', () => {
  const ENV_KEYS = [
    'SPECSHIP_JIRA_CONFIG',
    'SPECSHIP_JIRA_BASE_URL',
    'SPECSHIP_JIRA_PAT',
    'SPECSHIP_JIRA_CA_CERT',
    'SPECSHIP_JIRA_INSECURE_TLS',
  ];
  const saved: Record<string, string | undefined> = {};
  let tmp: string;

  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeConfig(cfg: object): void {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-jira-tls-'));
    const file = path.join(tmp, 'jira.json');
    fs.writeFileSync(file, JSON.stringify(cfg));
    process.env.SPECSHIP_JIRA_CONFIG = file;
  }

  it('file-level caCertPath and insecureTls resolve into credentials', () => {
    writeConfig({
      baseUrl: 'https://jira.example.com/ctx',
      pat: 'p',
      caCertPath: '/corp/ca.pem',
      insecureTls: true,
    });
    delete process.env.SPECSHIP_JIRA_BASE_URL;
    delete process.env.SPECSHIP_JIRA_PAT;
    delete process.env.SPECSHIP_JIRA_CA_CERT;
    delete process.env.SPECSHIP_JIRA_INSECURE_TLS;
    const c = resolveJiraCredentials();
    expect(c.caCertPath).toBe('/corp/ca.pem');
    expect(c.insecureTls).toBe(true);
  });

  it('env overrides the file per-field, mirroring other SPECSHIP_JIRA_* vars', () => {
    writeConfig({ baseUrl: 'https://jira.example.com', pat: 'p', insecureTls: true });
    process.env.SPECSHIP_JIRA_CA_CERT = '/env/ca.pem';
    process.env.SPECSHIP_JIRA_INSECURE_TLS = '0';
    const c = resolveJiraCredentials();
    expect(c.caCertPath).toBe('/env/ca.pem');
    expect(c.insecureTls).toBe(false);
  });

  it('SPECSHIP_JIRA_INSECURE_TLS accepts 1 and true', () => {
    writeConfig({ baseUrl: 'https://jira.example.com', pat: 'p' });
    process.env.SPECSHIP_JIRA_INSECURE_TLS = 'true';
    expect(resolveJiraCredentials().insecureTls).toBe(true);
    process.env.SPECSHIP_JIRA_INSECURE_TLS = '1';
    expect(resolveJiraCredentials().insecureTls).toBe(true);
  });
});
