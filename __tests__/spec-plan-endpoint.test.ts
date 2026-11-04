/**
 * REQ-DASHSIMPLE-003 — GET /api/spec/plan and its `buildPlan` grouping.
 *
 * Real temp project + real SQLite: spec rows are inserted with the metadata
 * the indexer stores from frontmatter (`epicKey`, `jira_issue_<REQ>`), and the
 * route is driven through Fastify's `.inject()`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src/index';
import { buildPlan, readJiraBaseUrl, registerSpecRoutes, type PlanResponse } from '../server/src/routes/spec';

const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; } catch { db.close(); }
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; } catch { db.close(); }
  } catch { /* fall through */ }
  return false;
})();

function seed(cg: SpecShip): void {
  const sq = cg.getSpecQueries();
  const now = Date.now();
  const base = { format: 'markdown' as const, createdAt: now, updatedAt: now };
  const add = (s: { id: string; kind: string; title: string; sourcePath: string; startLine: number; parentId?: string; body?: string; metadata?: Record<string, unknown> }) =>
    sq.insertSpec({ ...base, body: s.body ?? '', contentHash: 'h-' + s.id, endLine: s.startLine + 2, ...s } as never);

  // Two documents share SSHIP-600 (b-file sorts after a-file); a third has no epicKey.
  add({ id: 'A-DOC', kind: 'document', title: 'Alpha', sourcePath: 'specs/a.md', startLine: 1,
    metadata: { epicKey: 'SSHIP-600', 'jira_issue_REQ-A-001': 'SSHIP-601' } });
  add({ id: 'REQ-A-002', kind: 'requirement', title: 'A two', sourcePath: 'specs/a.md', startLine: 20, parentId: 'A-DOC' });
  add({ id: 'REQ-A-001', kind: 'requirement', title: 'A one', sourcePath: 'specs/a.md', startLine: 10, parentId: 'A-DOC', body: 'Alpha body.' });
  add({ id: 'REQ-A-001.A1', kind: 'acceptance', title: 'A one criterion', sourcePath: 'specs/a.md', startLine: 12, parentId: 'REQ-A-001' });
  add({ id: 'B-DOC', kind: 'document', title: 'Beta', sourcePath: 'specs/b.md', startLine: 1, metadata: { epicKey: 'SSHIP-600' } });
  add({ id: 'REQ-B-001', kind: 'requirement', title: 'B one', sourcePath: 'specs/b.md', startLine: 10, parentId: 'B-DOC' });
  add({ id: 'C-DOC', kind: 'document', title: 'Gamma without epic', sourcePath: 'specs/c.md', startLine: 1 });
  add({ id: 'REQ-C-001', kind: 'requirement', title: 'C one', sourcePath: 'specs/c.md', startLine: 10, parentId: 'C-DOC' });
}

describe.skipIf(!fts5Available)('GET /api/spec/plan (REQ-DASHSIMPLE-003)', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;
  const savedEnv = { base: process.env.SPECSHIP_JIRA_BASE_URL, cfg: process.env.SPECSHIP_JIRA_CONFIG };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-plan-'));
    delete process.env.SPECSHIP_JIRA_BASE_URL;
    process.env.SPECSHIP_JIRA_CONFIG = path.join(dir, 'no-jira.json');
    cg = await SpecShip.init(dir);
    seed(cg);
    app = Fastify({ logger: false });
    app.decorate('activeCg', async (_req: FastifyRequest) => cg);
    await registerSpecRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedEnv.base === undefined) delete process.env.SPECSHIP_JIRA_BASE_URL; else process.env.SPECSHIP_JIRA_BASE_URL = savedEnv.base;
    if (savedEnv.cfg === undefined) delete process.env.SPECSHIP_JIRA_CONFIG; else process.env.SPECSHIP_JIRA_CONFIG = savedEnv.cfg;
  });

  it('merges documents sharing an epicKey in file order and keeps epic-less documents as their own group', () => {
    const plan = buildPlan(cg as never, null);
    expect(plan.epics.map((e) => [e.key, e.title])).toEqual([['SSHIP-600', 'Alpha'], [null, 'Gamma without epic']]);
    const epic = plan.epics[0]!;
    expect(epic.docs.map((d) => d.id)).toEqual(['A-DOC', 'B-DOC']);
    expect(epic.docs.flatMap((d) => d.stories.map((s) => s.specId))).toEqual(['REQ-A-001', 'REQ-A-002', 'REQ-B-001']);
    const a1 = epic.docs[0]!.stories[0]!;
    expect(a1.jiraKey).toBe('SSHIP-601');
    expect(a1.body).toBe('Alpha body.');
    expect(a1.tasks).toEqual([{ specId: 'REQ-A-001.A1', title: 'A one criterion', verdict: 'untested' }]);
    expect(a1.coverage?.specId).toBe('REQ-A-001');
    expect(epic.docs[0]!.stories[1]!.jiraKey).toBeNull();
  });

  it('returns the plan over HTTP with jiraBaseUrl null when nothing is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/spec/plan' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as PlanResponse;
    expect(body.jiraBaseUrl).toBeNull();
    expect(body.epics).toHaveLength(2);
    expect(Array.isArray(body.driftLinks)).toBe(true);
  });

  it('exposes only the JIRA base URL — never a credential key or value', async () => {
    const cfg = path.join(dir, 'jira.json');
    fs.writeFileSync(cfg, JSON.stringify({
      baseUrl: 'https://acme.atlassian.net/', email: 'dev@acme.test', apiToken: 'tok-SECRET-123',
      pat: 'pat-SECRET-456', password: 'pw-SECRET-789', deployment: 'cloud',
    }));
    process.env.SPECSHIP_JIRA_CONFIG = cfg;
    expect(readJiraBaseUrl()).toBe('https://acme.atlassian.net');

    const res = await app.inject({ method: 'GET', url: '/api/spec/plan' });
    const raw = res.payload;
    expect(JSON.parse(raw).jiraBaseUrl).toBe('https://acme.atlassian.net');
    for (const key of ['apiToken', 'token', 'email', 'password', 'pat']) {
      expect(raw).not.toMatch(new RegExp(`"${key}"\\s*:`, 'i'));
    }
    for (const value of ['tok-SECRET-123', 'pat-SECRET-456', 'pw-SECRET-789', 'dev@acme.test']) {
      expect(raw).not.toContain(value);
    }
  });

  it('prefers SPECSHIP_JIRA_BASE_URL and rejects a non-http value', () => {
    process.env.SPECSHIP_JIRA_BASE_URL = 'https://env.example.com';
    expect(readJiraBaseUrl()).toBe('https://env.example.com');
    process.env.SPECSHIP_JIRA_BASE_URL = 'javascript:alert(1)';
    expect(readJiraBaseUrl()).toBeNull();
  });
});
