/**
 * Maintainability harness tests (REQ-MAINT-001).
 *
 * Seeds a real SQLite graph via QueryBuilder and asserts each of the four
 * signals fires, that a heuristic-reached symbol is NOT flagged dead, that the
 * report is deterministic, and that a healthy graph reports clean.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { computeMaintainability } from '../src/graph/maintainability';
import type { Node, Edge } from '../src/types';

let dir: string;
let conn: DatabaseConnection;
let q: QueryBuilder;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-maint-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  q = new QueryBuilder(conn.getDb());
});
afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function fn(id: string, filePath: string, opts: { exported?: boolean; startLine?: number; endLine?: number; kind?: Node['kind'] } = {}): void {
  q.insertNode({
    id,
    kind: opts.kind ?? 'function',
    name: id.split(':').pop()!,
    qualifiedName: `${filePath}::${id}`,
    filePath,
    language: 'typescript',
    startLine: opts.startLine ?? 1,
    endLine: opts.endLine ?? 3,
    startColumn: 0,
    endColumn: 1,
    isExported: opts.exported ?? false,
    updatedAt: 1,
  } as Node);
}
function edge(source: string, target: string, kind: Edge['kind'], provenance?: string): void {
  q.insertEdge({ source, target, kind, provenance } as Edge);
}

describe('maintainability — coupling (REQ-MAINT-001.A1)', () => {
  it('flags a high fan-in symbol', () => {
    fn('hub', 'hub.ts');
    for (let i = 0; i < 21; i++) { fn(`c${i}`, `c${i}.ts`, { exported: true }); edge(`c${i}`, 'hub', 'calls'); }
    const r = computeMaintainability(q);
    const hub = r.coupling.find((c) => c.nodeId === 'hub');
    expect(hub).toBeTruthy();
    expect(hub!.fanIn).toBeGreaterThanOrEqual(20);
  });
});

describe('maintainability — size (REQ-MAINT-001.A2)', () => {
  it('flags an oversized symbol and a god-file', () => {
    fn('big', 'big.ts', { startLine: 1, endLine: 260, exported: true });
    for (let i = 0; i < 40; i++) fn(`g${i}`, 'god.ts', { exported: true });
    const r = computeMaintainability(q);
    expect(r.oversized.find((o) => o.nodeId === 'big')).toBeTruthy();
    expect(r.godFiles.find((f) => f.filePath === 'god.ts')).toBeTruthy();
    expect(r.godFiles.find((f) => f.filePath === 'god.ts')!.symbolCount).toBe(40);
  });
});

describe('maintainability — cycles (REQ-MAINT-001.A3)', () => {
  it('flags a file-import cycle', () => {
    fn('nx', 'x.ts', { exported: true });
    fn('ny', 'y.ts', { exported: true });
    edge('nx', 'ny', 'imports');
    edge('ny', 'nx', 'imports');
    const r = computeMaintainability(q);
    expect(r.cycles.length).toBe(1);
    expect(r.cycles[0]!.files).toEqual(['x.ts', 'y.ts']);
  });
});

describe('maintainability — dead code (REQ-MAINT-001.A4)', () => {
  it('flags an unused unexported symbol but NOT one reached via a heuristic edge', () => {
    fn('orphan', 'orphan.ts'); // not exported, no incoming → dead
    fn('reached', 'reached.ts'); // reached only via a heuristic call edge → NOT dead
    fn('caller', 'caller.ts', { exported: true });
    edge('caller', 'reached', 'calls', 'heuristic');
    const r = computeMaintainability(q);
    expect(r.deadCode.find((d) => d.nodeId === 'orphan')).toBeTruthy();
    expect(r.deadCode.find((d) => d.nodeId === 'reached')).toBeUndefined();
  });

  it('does not flag exported symbols or test-file symbols', () => {
    fn('pub', 'api.ts', { exported: true });
    fn('tfix', 'foo.test.ts'); // unexported but in a test file
    const r = computeMaintainability(q);
    expect(r.deadCode.find((d) => d.nodeId === 'pub')).toBeUndefined();
    expect(r.deadCode.find((d) => d.nodeId === 'tfix')).toBeUndefined();
  });
});

describe('maintainability — determinism + clean (REQ-MAINT-001.A5 / REQ-MAINT-002.A4)', () => {
  it('is byte-identical across runs on an unchanged index', () => {
    fn('hub', 'hub.ts');
    for (let i = 0; i < 21; i++) { fn(`c${i}`, `c${i}.ts`, { exported: true }); edge(`c${i}`, 'hub', 'calls'); }
    expect(JSON.stringify(computeMaintainability(q))).toBe(JSON.stringify(computeMaintainability(q)));
  });

  it('reports an explicit clean result for a healthy graph', () => {
    fn('a', 'a.ts', { exported: true });
    fn('b', 'b.ts', { exported: true });
    edge('b', 'a', 'calls');
    const r = computeMaintainability(q);
    expect(r.clean).toBe(true);
    expect(r.coupling).toEqual([]);
    expect(r.oversized).toEqual([]);
    expect(r.godFiles).toEqual([]);
    expect(r.cycles).toEqual([]);
    expect(r.deadCode).toEqual([]);
  });
});
