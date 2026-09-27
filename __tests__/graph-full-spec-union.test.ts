import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openMemoryDb } from './helpers/memory-db';
import { registerGraphRoutes } from '../server/src/routes/graph';
import type { SpecShipInstance } from '../server/src/project-registry';

/**
 * REQ-TVIZ-010.A1 (specs/testing-dashboard-buildout.md) — GET /api/graph/full
 * returns the top-N most-connected nodes, which is exactly the cut that used
 * to erase traceability from the whole-repo view: a spec node has degree 1–2,
 * so spec↔code edges were always the first thing pruned. Spec nodes that
 * participate in an edge, and the code nodes on the other end, are now unioned
 * in regardless of degree.
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

function addNode(id: string, kind: string, file = 'src/thing.ts'): void {
  db.prepare('INSERT INTO nodes (id, name, kind, file_path, start_line) VALUES (?, ?, ?, ?, 1)')
    .run(id, id, kind, file);
}

function addEdge(source: string, target: string, kind = 'calls'): void {
  db.prepare('INSERT INTO edges (source, target, kind, provenance) VALUES (?, ?, ?, ?)')
    .run(source, target, kind, 'exact');
}

function fakeCg(): SpecShipInstance {
  return {
    db: { getDb: () => db },
    getSpecQueries: () => ({ getAllLinks: () => [], getLinksByNode: () => [] }),
  } as unknown as SpecShipInstance;
}

interface FullResponse {
  nodes: Array<{ id: string; kind: string; degree: number }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  total: number;
  shown: number;
}

async function full(limit?: number): Promise<FullResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/graph/full' + (limit ? `?limit=${limit}` : '') });
  expect(res.statusCode).toBe(200);
  return res.json() as FullResponse;
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

describe('GET /api/graph/full spec union (REQ-TVIZ-010.A1)', () => {
  /**
   * A hub cluster that monopolizes the degree ranking, plus one spec anchored
   * to a low-degree leaf. With limit=2 the degree cut keeps only the hubs.
   */
  function seedHubsAndSpec(): void {
    addNode('hubA', 'function');
    addNode('hubB', 'function');
    for (let i = 0; i < 6; i++) {
      addNode('sat' + i, 'function');
      addEdge('hubA', 'sat' + i);
      addEdge('hubB', 'sat' + i);
    }
    addNode('leaf', 'function', 'src/leaf.ts');
    addNode('spec:REQ-X-001', 'spec', 'specs/x.md');
    addEdge('spec:REQ-X-001', 'leaf', 'implements');
  }

  it('keeps spec nodes and their link edges past the top-N degree cut', async () => {
    seedHubsAndSpec();
    const body = await full(2);

    const ids = body.nodes.map((n) => n.id);
    expect(ids).toContain('hubA');
    // Both ends of the spec edge survive, despite degree 1.
    expect(ids).toContain('spec:REQ-X-001');
    expect(ids).toContain('leaf');
    expect(body.edges).toContainEqual(
      expect.objectContaining({ from: 'spec:REQ-X-001', to: 'leaf', kind: 'implements' }),
    );
    // `shown` counts what actually shipped, including the union.
    expect(body.shown).toBe(body.nodes.length);
    expect(body.total).toBe(10); // 2 hubs + 6 satellites + leaf + spec
  });

  it('keeps a spec edge pointing the other way (code → spec)', async () => {
    addNode('caller', 'function');
    addNode('spec:REQ-Y-001', 'spec', 'specs/y.md');
    addEdge('caller', 'spec:REQ-Y-001', 'implements');
    // A busier cluster so the degree cut would otherwise win.
    addNode('hub', 'function');
    for (let i = 0; i < 4; i++) { addNode('s' + i, 'function'); addEdge('hub', 's' + i); }

    const body = await full(1);
    const ids = body.nodes.map((n) => n.id);
    expect(ids).toContain('spec:REQ-Y-001');
    expect(ids).toContain('caller');
    expect(body.edges).toContainEqual(
      expect.objectContaining({ from: 'caller', to: 'spec:REQ-Y-001' }),
    );
  });

  it('still omits an edgeless spec node — it would draw as an island', async () => {
    seedHubsAndSpec();
    addNode('spec:REQ-Z-001', 'spec', 'specs/z.md');

    const body = await full(2);
    expect(body.nodes.map((n) => n.id)).not.toContain('spec:REQ-Z-001');
  });

  it('never duplicates a node that the degree pass already selected', async () => {
    seedHubsAndSpec();
    const body = await full(400);
    const ids = body.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('spec:REQ-X-001');
  });
});
