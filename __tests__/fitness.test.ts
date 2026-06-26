/**
 * Architecture-fitness tests (REQ-FITNESS-001/002).
 *
 * Seeds a real graph and asserts each rule type flags the right edges, that a
 * no-match selector is a config error (not a false-green), that a conforming
 * graph reports clean, and that the report is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { evaluateFitness } from '../src/fitness/fitness';
import type { FitnessRule } from '../src/fitness/fitness';
import type { Node, Edge } from '../src/types';

let dir: string;
let conn: DatabaseConnection;
let q: QueryBuilder;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-fitness-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  q = new QueryBuilder(conn.getDb());
});
afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

let seq = 0;
function node(id: string, filePath: string): void {
  q.insertNode({
    id, kind: 'function', name: id, qualifiedName: `${filePath}::${id}`, filePath,
    language: 'typescript', startLine: 1, endLine: 3, startColumn: 0, endColumn: 1, updatedAt: 1,
  } as Node);
}
function dep(source: string, target: string): void {
  q.insertEdge({ source, target, kind: 'calls' } as Edge);
}

describe('fitness — forbidden dependency (REQ-FITNESS-001.A1)', () => {
  it('flags a forbidden edge and ignores an allowed one', () => {
    node('u', 'src/ui/a.ts'); node('d', 'src/db/b.ts'); node('c', 'src/core/c.ts');
    dep('u', 'd'); // ui → db: forbidden
    dep('u', 'c'); // ui → core: fine
    const rules: FitnessRule[] = [{ type: 'forbidden', name: 'ui-no-db', from: 'src/ui/**', to: 'src/db/**' }];
    const r = evaluateFitness(q, rules);
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.rule).toBe('ui-no-db');
    expect(r.violations[0]!.location).toBe('src/ui/a.ts:1');
    expect(r.clean).toBe(false);
  });
});

describe('fitness — layering allow-list (REQ-FITNESS-001.A2)', () => {
  it('allows ui→core but flags core→ui', () => {
    node('u', 'src/ui/a.ts'); node('c', 'src/core/b.ts');
    dep('u', 'c'); // allowed
    dep('c', 'u'); // violation: core may not depend on ui
    const rules: FitnessRule[] = [{
      type: 'layers', name: 'layering',
      layers: { ui: 'src/ui/**', core: 'src/core/**' },
      allow: { ui: ['core'], core: [] },
    }];
    const r = evaluateFitness(q, rules);
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.source).toContain('::c');
    expect(r.violations[0]!.target).toContain('::u');
  });
});

describe('fitness — module isolation (REQ-FITNESS-001.A3)', () => {
  it('leaf: flags an inbound cross-boundary edge', () => {
    node('ext', 'src/app/x.ts'); node('int', 'src/internal/y.ts');
    dep('ext', 'int'); // outside → internal: violates leaf
    const rules: FitnessRule[] = [{ type: 'isolation', name: 'internal-leaf', module: 'src/internal/**', mode: 'leaf' }];
    expect(evaluateFitness(q, rules).violations.length).toBe(1);
  });
  it('sink: flags an outbound cross-boundary edge', () => {
    node('s', 'src/sink/y.ts'); node('ext', 'src/app/x.ts');
    dep('s', 'ext'); // sink → outside: violates sink
    const rules: FitnessRule[] = [{ type: 'isolation', name: 'sink', module: 'src/sink/**', mode: 'sink' }];
    expect(evaluateFitness(q, rules).violations.length).toBe(1);
  });
});

describe('fitness — config errors + clean + determinism (REQ-FITNESS-002)', () => {
  it('a no-match selector is a config error, not a silent pass (A3)', () => {
    node('u', 'src/ui/a.ts');
    const rules: FitnessRule[] = [{ type: 'forbidden', name: 'typo', from: 'src/ui/**', to: 'src/nowhere/**' }];
    const r = evaluateFitness(q, rules);
    expect(r.violations.length).toBe(0);
    expect(r.configErrors.length).toBe(1);
    expect(r.configErrors[0]!.message).toMatch(/src\/nowhere/);
    expect(r.clean).toBe(false); // config error must NOT be a clean pass
  });

  it('reports an explicit clean result when every rule passes (A4)', () => {
    // ui depends on db; rule forbids the reverse (db → ui), which never happens.
    node('u', 'src/ui/a.ts'); node('d', 'src/db/b.ts');
    dep('u', 'd');
    const rules: FitnessRule[] = [{ type: 'forbidden', name: 'db-no-ui', from: 'src/db/**', to: 'src/ui/**' }];
    const r = evaluateFitness(q, rules);
    expect(r.clean).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.configErrors).toEqual([]);
  });

  it('is deterministic across runs', () => {
    node('u', 'src/ui/a.ts'); node('d', 'src/db/b.ts'); dep('u', 'd');
    const rules: FitnessRule[] = [{ type: 'forbidden', name: 'ui-no-db', from: 'src/ui/**', to: 'src/db/**' }];
    expect(JSON.stringify(evaluateFitness(q, rules))).toBe(JSON.stringify(evaluateFitness(q, rules)));
  });
});
