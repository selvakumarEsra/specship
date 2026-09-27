/**
 * Property-based tests for GraphTraverser (REQ-TVIZ-001.A3).
 *
 * Every random graph here is seeded into a real SQLite database through the
 * production QueryBuilder — no mocks, no fake adjacency layer — so the
 * properties cover the SQL the traverser actually issues. Cycles are generated
 * on purpose: a real code graph has them (mutual recursion, circular imports),
 * and an impact query that doesn't terminate on one is a hang, not a wrong
 * answer.
 *
 * Run counts and seeds are fixed (REQ-TVIZ-001.A4); graphs are kept small so
 * the whole suite stays well inside a normal `npm test` budget.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fc from 'fast-check';
import { DatabaseConnection } from '../../src/db';
import { QueryBuilder } from '../../src/db/queries';
import { GraphTraverser } from '../../src/graph/traversal';
import type { Edge, Node } from '../../src/types';

const RUNS = { numRuns: 100, seed: 20260924 } as const;

let dir: string;
let conn: DatabaseConnection;
let queries: QueryBuilder;
let traverser: GraphTraverser;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-traversal-prop-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  queries = new QueryBuilder(conn.getDb());
  traverser = new GraphTraverser(queries);
});

afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** A generated directed graph: `n` nodes named `n0..n{n-1}` plus edge pairs. */
interface GraphSpec {
  size: number;
  edges: Array<[number, number]>;
  /** Kind per node — mixes containers in so the impact walker's container
   *  branch (which recurses at the SAME depth) is exercised too. */
  kinds: Array<'function' | 'class'>;
  edgeKinds: Array<'calls' | 'references' | 'contains'>;
}

/**
 * Two graph shapes, because they stress different things. Dense random pairs
 * produce cycles and self-loops in abundance but collapse to a diameter of one
 * or two, which would leave `maxDepth` barely exercised; a chain with a
 * sprinkle of extra edges produces the long paths (and the long cycles) a
 * depth budget actually has to cut.
 */
const graphSpec: fc.Arbitrary<GraphSpec> = fc
  .integer({ min: 1, max: 9 })
  .chain((size) => {
    const chainEdges: Array<[number, number]> = [];
    for (let i = 0; i + 1 < size; i++) chainEdges.push([i, i + 1]);
    const randomPair = fc.tuple(
      fc.integer({ min: 0, max: size - 1 }),
      fc.integer({ min: 0, max: size - 1 }),
    );
    return fc.record({
      size: fc.constant(size),
      edges: fc.oneof(
        // Dense: self-loops, 2-cycles, and longer cycles all occur.
        fc.array(randomPair, { maxLength: size * 3 }),
        // Chain (+ optional extra edges, which close long cycles).
        fc
          .array(randomPair, { maxLength: 2 })
          .map((extra) => [...chainEdges, ...extra] as Array<[number, number]>),
      ),
      kinds: fc.array(fc.constantFrom('function' as const, 'class' as const), {
        minLength: size,
        maxLength: size,
      }),
      edgeKinds: fc.array(
        fc.constantFrom('calls' as const, 'references' as const, 'contains' as const),
        { minLength: size * 3 + 2, maxLength: size * 3 + 2 },
      ),
    });
  });

const id = (i: number) => `n${i}`;

/**
 * Write the generated graph into the real database.
 *
 * `beforeEach` runs once per `it`, not once per fast-check run, so each run
 * must wipe the previous graph itself — otherwise every property would be
 * asserted against the accumulated union of all earlier runs. The QueryBuilder
 * is rebuilt alongside the wipe because it memoizes node lookups.
 */
function seed(g: GraphSpec): void {
  conn.getDb().exec('DELETE FROM edges; DELETE FROM nodes;');
  queries = new QueryBuilder(conn.getDb());
  traverser = new GraphTraverser(queries);

  const nodes: Node[] = [];
  for (let i = 0; i < g.size; i++) {
    nodes.push({
      id: id(i),
      kind: g.kinds[i] ?? 'function',
      name: id(i),
      qualifiedName: `src/g.ts::${id(i)}`,
      filePath: 'src/g.ts',
      language: 'typescript',
      startLine: i + 1,
      endLine: i + 2,
      startColumn: 0,
      endColumn: 1,
      updatedAt: 1,
    } as Node);
  }
  queries.insertNodes(nodes);

  const seen = new Set<string>();
  const edges: Edge[] = [];
  g.edges.forEach(([from, to], idx) => {
    const kind = g.edgeKinds[idx] ?? 'calls';
    const key = `${from}->${to}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: id(from), target: id(to), kind } as Edge);
  });
  if (edges.length > 0) queries.insertEdges(edges);
}

/** Outgoing adjacency of the generated graph, as the test's own ground truth. */
function adjacency(g: GraphSpec): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (let i = 0; i < g.size; i++) adj.set(id(i), new Set());
  for (const [from, to] of g.edges) adj.get(id(from))!.add(id(to));
  return adj;
}

/** Ground-truth hop distance from `start` over outgoing edges. */
function distances(g: GraphSpec, start: string): Map<string, number> {
  const adj = adjacency(g);
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** Graph + a start node drawn from it. */
const graphAndStart = graphSpec.chain((g) =>
  fc.tuple(fc.constant(g), fc.integer({ min: 0, max: g.size - 1 }).map(id)),
);

describe('GraphTraverser — BFS/DFS agreement (REQ-TVIZ-001.A3)', () => {
  it('BFS and DFS agree on the reachable set at unbounded depth (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphAndStart, ([g, start]) => {
        seed(g);
        const bfs = traverser.traverseBFS(start);
        const dfs = traverser.traverseDFS(start);
        const bfsIds = [...bfs.nodes.keys()].sort();
        const dfsIds = [...dfs.nodes.keys()].sort();
        expect(dfsIds).toEqual(bfsIds);
        // …and both equal the reachable set computed independently here.
        expect(bfsIds).toEqual([...distances(g, start).keys()].sort());
      }),
      RUNS,
    );
  });

  it('BFS and DFS agree on the reachable set at equal bounded depth (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphAndStart, fc.integer({ min: 1, max: 5 }), ([g, start], maxDepth) => {
        seed(g);
        const bfsIds = new Set(traverser.traverseBFS(start, { maxDepth }).nodes.keys());
        const dfsIds = new Set(traverser.traverseDFS(start, { maxDepth }).nodes.keys());
        const dist = distances(g, start);
        // Both must stay inside the depth budget…
        for (const nodeId of bfsIds) expect(dist.get(nodeId)!).toBeLessThanOrEqual(maxDepth);
        for (const nodeId of dfsIds) expect(dist.get(nodeId)!).toBeLessThanOrEqual(maxDepth);
        // …and BFS, which always reaches a node by its shortest path, is the
        // upper bound: depth-first order can mark a node visited via a longer
        // path and then decline to re-expand it from a shorter one, so DFS is a
        // subset rather than an equal at a finite budget.
        for (const nodeId of dfsIds) expect(bfsIds.has(nodeId)).toBe(true);
        // BFS is exactly the depth-bounded ball around the start node.
        const expected = [...dist.entries()]
          .filter(([, d]) => d <= maxDepth)
          .map(([k]) => k)
          .sort();
        expect([...bfsIds].sort()).toEqual(expected);
      }),
      RUNS,
    );
  });

  it('maxDepth is monotonic and saturates at the reachable set (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphAndStart, ([g, start]) => {
        seed(g);
        let previous = new Set<string>();
        for (const maxDepth of [1, 2, 3, 4, 10]) {
          const got = new Set(traverser.traverseBFS(start, { maxDepth }).nodes.keys());
          // A bigger budget never loses a node.
          for (const nodeId of previous) expect(got.has(nodeId)).toBe(true);
          previous = got;
        }
        // 10 hops covers any 9-node graph's diameter.
        expect([...previous].sort()).toEqual([...distances(g, start).keys()].sort());
      }),
      RUNS,
    );
  });

  it('a missing start node yields an empty subgraph, not a throw (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphSpec, fc.string({ maxLength: 12 }), (g, bogus) => {
        seed(g);
        fc.pre(!/^n[0-8]$/.test(bogus));
        for (const sub of [
          traverser.traverseBFS(bogus),
          traverser.traverseDFS(bogus),
          traverser.getImpactRadius(bogus),
        ]) {
          expect(sub.nodes.size).toBe(0);
          expect(sub.edges).toEqual([]);
        }
      }),
      RUNS,
    );
  });
});

describe('GraphTraverser — impact radius terminates (REQ-TVIZ-001.A3)', () => {
  it('getImpactRadius terminates on cyclic graphs (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphAndStart, fc.integer({ min: 1, max: 6 }), ([g, start], maxDepth) => {
        seed(g);
        const sub = traverser.getImpactRadius(start, maxDepth);
        // Termination is the property; these bound the answer's shape.
        expect(sub.nodes.size).toBeGreaterThanOrEqual(1);
        expect(sub.nodes.size).toBeLessThanOrEqual(g.size);
        expect(sub.nodes.has(start)).toBe(true);
        expect(sub.roots).toEqual([start]);
        // Impact walks dependents (incoming edges) plus container children —
        // every node it reports is a real node of the graph.
        for (const nodeId of sub.nodes.keys()) expect(/^n\d$/.test(nodeId)).toBe(true);
        for (const e of sub.edges) {
          expect(sub.nodes.has(e.source) || sub.nodes.has(e.target)).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('getCallers/getCallees/findUsages terminate on cycles (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphAndStart, fc.integer({ min: 1, max: 4 }), ([g, start], maxDepth) => {
        seed(g);
        const callers = traverser.getCallers(start, maxDepth);
        const callees = traverser.getCallees(start, maxDepth);
        const usages = traverser.findUsages(start);
        for (const list of [callers, callees, usages]) {
          expect(Array.isArray(list)).toBe(true);
          for (const entry of list) {
            expect(entry.node).toBeTruthy();
            expect(entry.edge).toBeTruthy();
          }
        }
      }),
      RUNS,
    );
  });

  it('getCallGraph and getTypeHierarchy terminate on cycles (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(graphAndStart, ([g, start]) => {
        seed(g);
        for (const sub of [traverser.getCallGraph(start, 2), traverser.getTypeHierarchy(start)]) {
          expect(sub.nodes.size).toBeLessThanOrEqual(g.size);
        }
      }),
      RUNS,
    );
  });

  it('findPath returns a real path or null, never a broken chain (REQ-TVIZ-001.A3)', () => {
    fc.assert(
      fc.property(
        graphSpec.chain((g) =>
          fc.tuple(
            fc.constant(g),
            fc.integer({ min: 0, max: g.size - 1 }).map(id),
            fc.integer({ min: 0, max: g.size - 1 }).map(id),
          ),
        ),
        ([g, from, to]) => {
          seed(g);
          const p = traverser.findPath(from, to);
          const reachable = distances(g, from);
          if (p === null) {
            // No path reported — either genuinely unreachable, or the same node
            // (findPath has nothing to walk). Never a false negative otherwise.
            expect(reachable.has(to) && from !== to).toBe(false);
            return;
          }
          expect(p.length).toBeGreaterThan(0);
          expect(p[0]!.node.id).toBe(from);
          expect(p[p.length - 1]!.node.id).toBe(to);
          // Each hop is a real edge of the graph, in order.
          const adj = adjacency(g);
          for (let i = 1; i < p.length; i++) {
            const prev = p[i - 1]!.node.id;
            const cur = p[i]!.node.id;
            expect(adj.get(prev)!.has(cur)).toBe(true);
          }
        },
      ),
      RUNS,
    );
  });
});
