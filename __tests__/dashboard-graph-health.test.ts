import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openMemoryDb } from './helpers/memory-db';
import { registerGraphRoutes } from '../server/src/routes/graph';
import type { SpecShipInstance } from '../server/src/project-registry';

/**
 * REQ-REVINT-008 (specs/review-truth-integrity.md) — GET /api/graph/health's
 * `tests` bucket. It used to bucket edges on `nodes.kind = 'test'`, a kind that
 * does not exist in NODE_KINDS, so the legend row was permanently 0. It now
 * counts resolved test-evidence spec_links (kind 'tests' / 'validates').
 */

type Db = ReturnType<typeof openMemoryDb>;

let db: Db;
let app: FastifyInstance;

function buildSchema(d: Db): void {
  d.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      file_path TEXT NOT NULL, start_line INTEGER, signature TEXT
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, target TEXT NOT NULL,
      kind TEXT NOT NULL, provenance TEXT
    );
    CREATE TABLE spec_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, spec_id TEXT NOT NULL,
      target_file_path TEXT NOT NULL, target_qualified_name TEXT NOT NULL,
      target_node_kind TEXT NOT NULL, resolved_node_id TEXT,
      kind TEXT NOT NULL, state TEXT NOT NULL
    );
  `);
}

function addNode(id: string, kind: string, file: string): void {
  db.prepare('INSERT INTO nodes (id, name, kind, file_path, start_line) VALUES (?, ?, ?, ?, 1)')
    .run(id, id, kind, file);
}

function addEdge(source: string, target: string, kind = 'calls'): void {
  db.prepare('INSERT INTO edges (source, target, kind, provenance) VALUES (?, ?, ?, ?)')
    .run(source, target, kind, 'exact');
}

function addLink(specId: string, kind: string, resolvedNodeId: string | null, state = 'implemented'): void {
  db.prepare(`
    INSERT INTO spec_links
      (spec_id, target_file_path, target_qualified_name, target_node_kind, resolved_node_id, kind, state)
    VALUES (?, 'src/thing.ts', 'thing', 'function', ?, ?, ?)
  `).run(specId, resolvedNodeId, kind, state);
}

/** Minimal SpecShip stand-in: the raw DB handle plus the link queries the route uses. */
function fakeCg(): SpecShipInstance {
  return {
    db: { getDb: () => db },
    getSpecQueries: () => ({
      getAllLinks: () => db.prepare('SELECT state FROM spec_links').all(),
      getLinksByNode: () => [],
    }),
  } as unknown as SpecShipInstance;
}

async function health(): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: 'GET', url: '/api/graph/health' });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

beforeEach(async () => {
  db = openMemoryDb();
  buildSchema(db);
  app = Fastify({ logger: false });
  const cg = fakeCg();
  app.decorate('activeCg', async () => cg);
  await registerGraphRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /api/graph/health edge buckets (REQ-REVINT-008)', () => {
  it('A1: the tests bucket is non-zero for a spec with resolved test evidence', async () => {
    addNode('n:test-target', 'function', 'src/thing.ts');
    addLink('REQ-X-001', 'implements', 'n:test-target');
    addLink('REQ-X-001', 'tests', 'n:test-target');

    const body = await health();
    expect((body.edgeKinds as Record<string, number>).tests).toBe(1);
  });

  it('A1: counts validates links too, and ignores unresolved test links', async () => {
    addNode('n:a', 'function', 'src/a.ts');
    addLink('REQ-X-002', 'tests', 'n:a');
    addLink('REQ-X-003', 'validates', 'n:a');
    addLink('REQ-X-004', 'tests', null); // never resolved to a symbol — not evidence

    const body = await health();
    expect((body.edgeKinds as Record<string, number>).tests).toBe(2);
  });

  it('A1: a graph with no test-evidence links reports 0, and call edges still bucket', async () => {
    addNode('n:caller', 'function', 'src/a.ts');
    addNode('n:callee', 'function', 'src/b.ts');
    addEdge('n:caller', 'n:callee');
    addLink('REQ-X-005', 'implements', 'n:caller');

    const body = await health();
    const buckets = body.edgeKinds as Record<string, number>;
    expect(buckets.tests).toBe(0);
    expect(buckets.calls).toBe(1);
  });

  it('A1: test-evidence counting is independent of the (nonexistent) test NodeKind', async () => {
    // The old query bucketed edges on nodes.kind = 'test'. Nothing writes that
    // kind, so edges between real nodes must never land in `tests`.
    addNode('n:x', 'function', '__tests__/thing.test.ts');
    addNode('n:y', 'function', 'src/thing.ts');
    addEdge('n:x', 'n:y');

    const body = await health();
    const buckets = body.edgeKinds as Record<string, number>;
    expect(buckets.tests).toBe(0);
    expect(buckets.calls).toBe(1);
  });
});
