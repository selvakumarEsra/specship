import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MAX_CODE_LINES, registerGraphRoutes } from '../server/src/routes/graph';
import type { SpecShipInstance } from '../server/src/project-registry';

/**
 * REQ-DASHSIMPLE-005 (specs/dashboard-simplify.md) — the server side of the
 * Graph split view: `/api/graph/node?includeCode=1` attaches the symbol's own
 * verbatim source (capped, never a whole file), and `/api/graph/split-search`
 * returns spec matches and code-symbol matches as two groups.
 */

const NODES: Record<string, { id: string; name: string; kind: string; filePath: string; startLine: number; endLine: number }> = {
  'fn-create': { id: 'fn-create', name: 'createOrder', kind: 'function', filePath: 'src/orders.ts', startLine: 3, endLine: 5 },
  'cls-big': { id: 'cls-big', name: 'Big', kind: 'class', filePath: 'src/big.ts', startLine: 1, endLine: 1000 },
  'file-orders': { id: 'file-orders', name: 'orders.ts', kind: 'file', filePath: 'src/orders.ts', startLine: 1, endLine: 50 },
  'spec-node': { id: 'spec-node', name: 'REQ-ORDERS-001', kind: 'spec', filePath: 'specs/orders.md', startLine: 1, endLine: 1 },
};
const CODE: Record<string, string> = {
  'fn-create': 'export function createOrder() {\n  return 1;\n}',
  'cls-big': Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n'),
  'file-orders': 'whole file',
};
const SPECS: Record<string, { id: string; title: string; kind: string }> = {
  'REQ-ORDERS-001': { id: 'REQ-ORDERS-001', title: 'Orders MUST total', kind: 'requirement' },
  'REQ-ORDERS-002': { id: 'REQ-ORDERS-002', title: 'Orders MUST ship', kind: 'requirement' },
};

let codeCalls: string[] = [];

function fakeCg(): SpecShipInstance {
  return {
    getNode: (id: string) => NODES[id] ?? null,
    getCode: async (id: string) => { codeCalls.push(id); return CODE[id] ?? null; },
    getCallers: () => [],
    getCallees: () => [],
    searchNodes: (q: string) => Object.values(NODES)
      .filter((n) => n.name.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes('orders'))
      .map((node) => ({ node, score: 1 })),
    getSpecQueries: () => ({
      getLinksByNode: () => [],
      getSpecById: (id: string) => SPECS[id] ?? null,
      searchSpecs: (q: string) => Object.values(SPECS)
        .filter((s) => s.id.includes(q.toUpperCase()) || q.toLowerCase().includes('orders'))
        .map((spec) => ({ spec, score: 1, snippet: 'MUST …' })),
    }),
  } as unknown as SpecShipInstance;
}

let app: FastifyInstance;

beforeEach(async () => {
  codeCalls = [];
  app = Fastify({ logger: false });
  const cg = fakeCg();
  app.decorate('activeCg', async () => cg);
  await registerGraphRoutes(app);
  await app.ready();
});

afterEach(async () => { await app.close(); });

async function getJson(url: string): Promise<Record<string, any>> {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /api/graph/node includeCode (REQ-DASHSIMPLE-005)', () => {
  it('returns the symbol source as `code` only when includeCode=1', async () => {
    const withCode = await getJson('/api/graph/node?id=fn-create&includeCode=1');
    expect(withCode.matches[0].code).toBe(CODE['fn-create']);
    expect(withCode.matches[0].codeTruncated).toBe(false);

    const plain = await getJson('/api/graph/node?id=fn-create');
    expect(plain.matches[0]).not.toHaveProperty('code');
  });

  it('caps a long body and never dumps a file node', async () => {
    const big = await getJson('/api/graph/node?id=cls-big&includeCode=1');
    expect(big.matches[0].code.split('\n').length).toBe(MAX_CODE_LINES);
    expect(big.matches[0].codeTruncated).toBe(true);

    const file = await getJson('/api/graph/node?id=file-orders&includeCode=1');
    expect(file.matches[0].code).toBeNull();
    expect(codeCalls).not.toContain('file-orders');
  });
});

describe('GET /api/graph/split-search (REQ-DASHSIMPLE-005)', () => {
  it('returns spec and symbol groups, exact requirement id first, no spec nodes among symbols', async () => {
    const r = await getJson('/api/graph/split-search?q=REQ-ORDERS-002');
    expect(r.specs[0].id).toBe('REQ-ORDERS-002');

    const both = await getJson('/api/graph/split-search?q=orders');
    expect(both.specs.map((s: { id: string }) => s.id)).toEqual(['REQ-ORDERS-001', 'REQ-ORDERS-002']);
    expect(both.symbols.length).toBeGreaterThan(0);
    expect(both.symbols.some((n: { kind: string }) => n.kind === 'spec')).toBe(false);

    const sym = await getJson('/api/graph/split-search?q=createOrder');
    expect(sym.symbols.map((n: { id: string }) => n.id)).toContain('fn-create');
  });

  it('returns empty groups for an empty query', async () => {
    expect(await getJson('/api/graph/split-search?q=')).toEqual({ specs: [], symbols: [] });
  });
});
