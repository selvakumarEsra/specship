/**
 * Spec coverage rollup (REQ-VSTATE-006).
 *
 * The rule under test is the one the dashboard got wrong: a verdict derives
 * from `tests` links ONLY. Implementation is a claim; a test is evidence. A
 * criterion with code and no test must read `untested`, not "met".
 *
 * Skipped without FTS5 in the system SQLite (SpecShip.init runs the full schema).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';
import type { SpecLinkKind, SpecLinkState } from '../src/types';
import { formatCoverageLine } from '../src/graph/spec-coverage';
import { handleSpecshipSpec } from '../src/mcp/spec-tools';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-coverage-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    // better-sqlite3 not installed — fall through to node:sqlite.
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    // node:sqlite not available either (Node < 22.5).
  }
  return false;
})();

describe.skipIf(!fts5Available)('spec coverage rollup (REQ-VSTATE-006)', () => {
  let dir: string;
  let cg: SpecShip;
  let sq: SpecQueries;

  const addSpec = (id: string, kind: 'document' | 'requirement' | 'acceptance', parentId?: string) => {
    const now = Date.now();
    sq.insertSpec({
      id, kind, title: `Title of ${id}`, body: 'body', format: 'markdown',
      sourcePath: 'specs/cov.md', parentId, contentHash: 'h',
      createdAt: now, updatedAt: now,
    });
  };

  const addLink = (
    specId: string,
    kind: SpecLinkKind,
    state: SpecLinkState,
    opts: { file?: string; metadata?: Record<string, unknown> } = {}
  ) => {
    const now = Date.now();
    const file = opts.file ?? (kind === 'tests' ? '__tests__/cov.test.ts' : 'src/cov.ts');
    sq.upsertSpecLink({
      specId,
      targetFilePath: file,
      targetQualifiedName: `${specId}:${kind}`,
      targetNodeKind: 'function',
      kind,
      state,
      driftAxis: null,
      specHashAtLink: 'h',
      provenance: 'code-comment',
      confidence: 0.9,
      metadata: opts.metadata,
      createdAt: now,
      updatedAt: now,
    });
  };

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    addSpec('COV-DOC', 'document');
    addSpec('REQ-COV-001', 'requirement', 'COV-DOC');
    addSpec('REQ-COV-001.A1', 'acceptance', 'REQ-COV-001');
    addSpec('REQ-COV-001.A2', 'acceptance', 'REQ-COV-001');
    addSpec('REQ-COV-001.A3', 'acceptance', 'REQ-COV-001');
  });

  afterEach(async () => {
    cg?.close();
    clean(dir);
  });

  it('reports implements/tests counts and a verdict per requirement and criterion (REQ-VSTATE-006.A1)', () => {
    addLink('REQ-COV-001.A1', 'implements', 'implemented');
    addLink('REQ-COV-001.A1', 'tests', 'verified');
    addLink('REQ-COV-001.A2', 'tests', 'implemented');
    addLink('REQ-COV-001.A3', 'tests', 'broken');

    const report = cg.getSpecCoverage('REQ-COV-001');
    expect(report.requirements).toHaveLength(1);
    const req = report.requirements[0]!;
    const byId = Object.fromEntries(req.criteria.map((c) => [c.specId, c]));

    expect(byId['REQ-COV-001.A1']!.verdict).toBe('verified');
    expect(byId['REQ-COV-001.A1']!.implementsLinks).toEqual({ count: 1, states: { implemented: 1 } });
    expect(byId['REQ-COV-001.A1']!.testsLinks).toEqual({ count: 1, states: { verified: 1 } });
    expect(byId['REQ-COV-001.A2']!.verdict).toBe('tested');
    expect(byId['REQ-COV-001.A3']!.verdict).toBe('broken');
    // Worst-wins at the requirement level — never report better than the parts.
    expect(req.verdict).toBe('broken');
    expect(req.criteriaCount).toBe(3);
    expect(req.criteriaWithTests).toBe(3);
  });

  it('a criterion with only an implements link reports untested (REQ-VSTATE-006.A3)', () => {
    addLink('REQ-COV-001.A1', 'implements', 'verified');

    const req = cg.getSpecCoverage('REQ-COV-001').requirements[0]!;
    const a1 = req.criteria.find((c) => c.specId === 'REQ-COV-001.A1')!;
    expect(a1.implementsLinks.count).toBe(1);
    expect(a1.testsLinks.count).toBe(0);
    expect(a1.verdict).toBe('untested');
    // …and it is not counted in the "N of M have linked tests" numerator.
    expect(req.criteriaWithTests).toBe(0);
    expect(formatCoverageLine(cg.getSpecCoverage('REQ-COV-001')))
      .toBe('0 of 3 acceptance criteria for REQ-COV-001 have linked tests.');
  });

  it('a tests link aimed outside a test file does not count as coverage (REQ-VSTATE-006.A3)', () => {
    addLink('REQ-COV-001.A1', 'tests', 'verified', {
      file: '__fixtures__/sample.ts',
      metadata: { nonTestTarget: true },
    });

    const a1 = cg.getSpecCoverage('REQ-COV-001').requirements[0]!
      .criteria.find((c) => c.specId === 'REQ-COV-001.A1')!;
    expect(a1.testsLinks.count).toBe(1);
    expect(a1.verdict).toBe('untested');
  });

  it('a spec with no children and no links returns an empty-but-valid rollup (REQ-VSTATE-006.A4)', () => {
    addSpec('REQ-COV-002', 'requirement', 'COV-DOC');
    const report = cg.getSpecCoverage('REQ-COV-002');
    const req = report.requirements[0]!;
    expect(req.verdict).toBe('untested');
    expect(req.criteria).toEqual([]);
    expect(req.criteriaCount).toBe(1); // the requirement is its own criterion
    expect(report.totals).toEqual({
      requirements: 1, criteria: 1, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0,
    });
  });

  it('an unknown spec id returns an empty report rather than throwing (REQ-VSTATE-006.A4)', () => {
    const report = cg.getSpecCoverage('REQ-NOPE-999');
    expect(report.specId).toBe('REQ-NOPE-999');
    expect(report.requirements).toEqual([]);
    expect(report.totals.criteria).toBe(0);
  });

  it('a document id expands to its requirements; no id covers the project (REQ-VSTATE-006.A1)', () => {
    addSpec('REQ-COV-002', 'requirement', 'COV-DOC');
    addLink('REQ-COV-001.A1', 'tests', 'verified');

    const doc = cg.getSpecCoverage('COV-DOC');
    expect(doc.requirements.map((r) => r.specId).sort()).toEqual(['REQ-COV-001', 'REQ-COV-002']);
    expect(doc.totals.criteriaVerified).toBe(1);

    const all = cg.getSpecCoverage();
    expect(all.specId).toBeNull();
    expect(all.requirements.map((r) => r.specId).sort()).toEqual(['REQ-COV-001', 'REQ-COV-002']);
  });

  it('the coverage line is rendered from the report, not counted separately (REQ-VSTATE-006.A2)', () => {
    addLink('REQ-COV-001.A1', 'tests', 'verified');
    addLink('REQ-COV-001.A2', 'tests', 'implemented');

    const report = cg.getSpecCoverage('REQ-COV-001');
    expect(formatCoverageLine(report))
      .toBe('2 of 3 acceptance criteria for REQ-COV-001 have linked tests.');
    expect(report.totals.criteriaWithTests).toBe(2);
  });

  it('the rollup is exposed over MCP via specship_spec coverage mode (REQ-VSTATE-006.A2)', async () => {
    addLink('REQ-COV-001.A1', 'implements', 'implemented');
    addLink('REQ-COV-001.A2', 'tests', 'verified');

    const result = await handleSpecshipSpec(cg, { spec_id: 'REQ-COV-001', coverage: true });
    const out = result.content.map((c) => c.text).join('\n');

    expect(out).toContain('Spec coverage — REQ-COV-001');
    // Same numbers the API returns — one computation, several renderings.
    expect(out).toContain(formatCoverageLine(cg.getSpecCoverage('REQ-COV-001')));
    expect(out).toContain('[untested] REQ-COV-001.A1');
    expect(out).toContain('[verified] REQ-COV-001.A2');

    // Without a spec_id it reports the project, not the funnel.
    const all = await handleSpecshipSpec(cg, { coverage: true });
    expect(all.content.map((c) => c.text).join('\n')).toContain('Spec coverage — project');
  });
});
