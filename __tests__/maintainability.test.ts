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
import { computeMaintainability, resolveThresholds, resolveExclude, DEFAULT_THRESHOLDS, DEFAULT_EXCLUDE, CONFIG_FILE_NAME, HIGH_PRECISION_CLASSES, LOW_CONFIDENCE_CLASSES, highPrecisionClean } from '../src/graph/maintainability';
import type { MaintainabilityReport } from '../src/graph/maintainability';
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

describe('maintainability — thresholds config (REQ-MAINT-002)', () => {
  it('uses built-in defaults when no config is present (A1)', () => {
    expect(resolveThresholds(dir)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('a checked-in config overrides each threshold (A2)', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({ maintainability: { thresholds: { highDegree: 5, godFileSymbols: 3 } } }));
    const t = resolveThresholds(dir);
    expect(t.highDegree).toBe(5);
    expect(t.godFileSymbols).toBe(3);
    expect(t.largeSymbolLines).toBe(DEFAULT_THRESHOLDS.largeSymbolLines); // untouched → default
  });

  it('an explicit override beats the config which beats defaults', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({ maintainability: { thresholds: { highDegree: 5 } } }));
    expect(resolveThresholds(dir, { highDegree: 1 }).highDegree).toBe(1);
  });

  it('falls back to defaults on an unparseable config (no throw)', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), '{ not valid json');
    expect(resolveThresholds(dir)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('every flagged finding carries a reason (A3)', () => {
    fn('hub', 'hub.ts');
    for (let i = 0; i < 21; i++) { fn(`c${i}`, `c${i}.ts`, { exported: true }); edge(`c${i}`, 'hub', 'calls'); }
    fn('big', 'big.ts', { startLine: 1, endLine: 260, exported: true });
    fn('orphan', 'orphan.ts');
    const r = computeMaintainability(q);
    expect(r.coupling.every((c) => !!c.reason)).toBe(true);
    expect(r.oversized.every((o) => !!o.reason)).toBe(true);
    expect(r.deadCode.every((d) => !!d.reason)).toBe(true);
    expect(r.coupling.find((c) => c.nodeId === 'hub')!.reason).toMatch(/threshold ≥ 20/);
  });
});

describe('maintainability — exclude scope (index-noise filter)', () => {
  it('drops generated/vendored files by default (.d.ts, bundled chunks)', () => {
    fn('decl', 'src/types.d.ts'); // unexported → would be dead code, but .d.ts excluded
    fn('chunk', 'server/public/web/chunk-ABC.js'); // would be a coupling hub
    for (let i = 0; i < 21; i++) { fn(`c${i}`, `c${i}.ts`, { exported: true }); edge(`c${i}`, 'chunk', 'calls'); }
    const r = computeMaintainability(q); // default exclude
    expect(r.deadCode.find((d) => d.nodeId === 'decl')).toBeUndefined();
    expect(r.coupling.find((c) => c.nodeId === 'chunk')).toBeUndefined();
    // callers' edges to the excluded chunk are not counted, so they aren't coupling either
    expect(r.coupling.length).toBe(0);
  });

  it('includes the same files when exclude is disabled', () => {
    fn('chunk', 'server/public/web/chunk-ABC.js');
    for (let i = 0; i < 21; i++) { fn(`c${i}`, `c${i}.ts`, { exported: true }); edge(`c${i}`, 'chunk', 'calls'); }
    const r = computeMaintainability(q, DEFAULT_THRESHOLDS, []); // exclude off
    expect(r.coupling.find((c) => c.nodeId === 'chunk')).toBeTruthy();
  });

  it('resolveExclude returns defaults plus config additions', () => {
    expect(resolveExclude(dir)).toEqual(DEFAULT_EXCLUDE);
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({ maintainability: { exclude: ['**/legacy/**'] } }));
    const ex = resolveExclude(dir);
    expect(ex).toContain('**/legacy/**');
    expect(ex).toContain('**/*.d.ts'); // defaults retained
  });
});

describe('report tiering (HEALTH-GATEWAY-DOC)', () => {
  const emptyReport = (): MaintainabilityReport => ({
    thresholds: DEFAULT_THRESHOLDS,
    coupling: [], oversized: [], godFiles: [], cycles: [], deadCode: [],
    clean: true,
  });

  const couplingFinding = () => ({
    nodeId: 'n', name: 'set', qualifiedName: 'src/x.ts::set', filePath: 'src/x.ts',
    kind: 'method' as const, fanIn: 400, fanOut: 0, reason: 'fan-in 400',
  });
  const deadFinding = () => ({
    nodeId: 'd', name: 'unused', qualifiedName: 'src/x.ts::unused', filePath: 'src/x.ts',
    kind: 'function' as const, startLine: 1, reason: 'no incoming use-edges',
  });
  const godFinding = () => ({ filePath: 'src/big.ts', symbolCount: 80, reason: '80 symbols' });

  // REQ-HEALTH-001/002: the two tiers partition the full finding-class set.
  it('the high-precision and low-confidence tiers together cover every finding class', () => {
    const all = [...HIGH_PRECISION_CLASSES, ...LOW_CONFIDENCE_CLASSES].sort();
    expect(all).toEqual(['coupling', 'cycles', 'deadCode', 'godFiles', 'oversized']);
    // No class appears in both tiers.
    const overlap = HIGH_PRECISION_CLASSES.filter((c) => (LOW_CONFIDENCE_CLASSES as readonly string[]).includes(c));
    expect(overlap).toEqual([]);
  });

  it('dead-code and coupling are the lower-confidence (opt-in) classes (REQ-HEALTH-002)', () => {
    expect([...LOW_CONFIDENCE_CLASSES].sort()).toEqual(['coupling', 'deadCode']);
  });

  // REQ-HEALTH-001.A3: a repo with ONLY low-confidence findings is high-precision-clean.
  it('highPrecisionClean is true when only dead-code / coupling findings exist', () => {
    const r = emptyReport();
    r.coupling = [couplingFinding()];
    r.deadCode = [deadFinding()];
    r.clean = false; // overall report is not clean…
    expect(highPrecisionClean(r)).toBe(true); // …but the gateway view is.
  });

  it('highPrecisionClean is false when a god file / oversized / cycle exists', () => {
    const r = emptyReport();
    r.godFiles = [godFinding()];
    expect(highPrecisionClean(r)).toBe(false);
  });

  it('a fully empty report is high-precision-clean', () => {
    expect(highPrecisionClean(emptyReport())).toBe(true);
  });
});
