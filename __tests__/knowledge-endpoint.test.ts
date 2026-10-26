/**
 * Tests for GET /api/knowledge (REQ-KNOW-007).
 *
 * Real temp project → SpecShip.init → domain facts (incl. external ones) and a
 * fake `node_modules` → indexAll → Fastify `.inject()`. Mirrors
 * `domain-endpoint.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src/index';
import { registerKnowledgeRoutes } from '../server/src/routes/knowledge';

const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  return false;
})();

async function buildTestApp(cg: SpecShip | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('activeCg', async function (_req: FastifyRequest): Promise<SpecShip | null> {
    return cg;
  });
  await registerKnowledgeRoutes(app);
  await app.ready();
  return app;
}

function write(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function externalFact(id: string, dependency: string, version: string): string {
  return `---\nid: ${id}\ntitle: ${dependency} fact\ntype: external\ndependency: ${dependency}\nversion: ${version}\nsource: src/x.ts:y\ndepends_on: REQ-X-001\n---\n\n# ${dependency} fact\n\nBody.\n`;
}

describe('knowledge route source (DOM-SPECSHIP-004)', () => {
  it('contains no runtime import from @specship/specship', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'server', 'src', 'routes', 'knowledge.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/from\s+['"]@specship\/specship['"]/);
  });
});

describe.skipIf(!fts5Available)('GET /api/knowledge', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-endpoint-'));
    cg = await SpecShip.init(dir);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function knowledgeEndpointListsFactsWithFreshness(): Promise<void> {
    write(dir, 'specs/domain/term.md', `---\nid: DOM-T-001\ntitle: Ledger\ntype: term\ndepends_on: REQ-A-001, REQ-B-002\n---\n\n# Ledger\n\nBody.\n`);
    write(dir, 'specs/domain/fresh.md', externalFact('DOM-T-002', 'fresh-dep', '1.2.0'));
    write(dir, 'specs/domain/stale.md', externalFact('DOM-T-003', 'stale-dep', '0.28.0'));
    write(dir, 'specs/domain/missing.md', externalFact('DOM-T-004', 'missing-dep', '2.0.0'));
    write(dir, 'node_modules/fresh-dep/package.json', JSON.stringify({ name: 'fresh-dep', version: '1.2.0' }));
    write(dir, 'node_modules/stale-dep/package.json', JSON.stringify({ name: 'stale-dep', version: '0.29.0' }));

    await cg.indexAll();
    app = await buildTestApp(cg);

    const res = await app.inject({ method: 'GET', url: '/api/knowledge' });
    expect(res.statusCode).toBe(200);
    const { facts } = JSON.parse(res.payload) as {
      facts: Array<{
        id: string;
        title: string;
        type: string;
        linkedRequirementIds: string[];
        dependency?: string;
        version?: string;
        stale?: string;
      }>;
    };
    const byId = new Map(facts.map((f) => [f.id, f]));
    expect([...byId.keys()].sort()).toEqual(['DOM-T-001', 'DOM-T-002', 'DOM-T-003', 'DOM-T-004']);

    const term = byId.get('DOM-T-001')!;
    expect(term).toMatchObject({ title: 'Ledger', type: 'term' });
    expect(term.linkedRequirementIds).toEqual(['REQ-A-001', 'REQ-B-002']);
    expect(term.stale).toBeUndefined();
    expect(term.dependency).toBeUndefined();

    expect(byId.get('DOM-T-002')).toMatchObject({
      type: 'external', dependency: 'fresh-dep', version: '1.2.0', stale: 'fresh',
      linkedRequirementIds: ['REQ-X-001'],
    });
    expect(byId.get('DOM-T-003')).toMatchObject({ dependency: 'stale-dep', version: '0.28.0', stale: 'stale' });
    expect(byId.get('DOM-T-004')).toMatchObject({ dependency: 'missing-dep', version: '2.0.0', stale: 'unverifiable' });

    // Read-only: no write verbs are routed.
    const post = await app.inject({ method: 'POST', url: '/api/knowledge' });
    expect(post.statusCode).toBe(404);
  }

  it('REQ-KNOW-007.A1: lists every domain fact with type, linked requirements and external freshness', knowledgeEndpointListsFactsWithFreshness);

  it('returns 409 no_project when no project is selectable', async () => {
    app = await buildTestApp(null);
    const res = await app.inject({ method: 'GET', url: '/api/knowledge' });
    expect(res.statusCode).toBe(409);
  });
});
