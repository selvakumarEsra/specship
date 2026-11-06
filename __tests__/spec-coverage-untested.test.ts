/**
 * REQ-LINKACC-007 — a verified requirement shows which of its criteria have no
 * test. `specship_spec` (detail + list) and the Review screen read the count
 * from the coverage rollup, so they agree.
 *
 * Real SQLite, seeded specs + links. Skipped where SQLite lacks FTS5.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { handleSpecshipSpec, inventoryRows } from '../src/mcp/spec-tools';
import { untestedCriteria, formatVerifiedSuffix } from '../src/graph/spec-coverage';
import { classifyRequirement, untestedCriteriaCount } from '../ui/src/review-groups';
import type { RequirementCoverage as UiRequirementCoverage } from '../ui/src/api';
import type { Spec, SpecLink, SpecLinkKind, SpecLinkState } from '../src/types';

const fts5Available = (() => {
  for (const load of [
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      return new Database(':memory:');
    },
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(':memory:');
    },
  ]) {
    try {
      const db = load();
      try {
        db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
        db.close();
        return true;
      } catch {
        db.close();
      }
    } catch {
      /* try next backend */
    }
  }
  return false;
})();

let dir: string;
let cg: SpecShip;

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

function insertSpec(partial: Partial<Spec> & Pick<Spec, 'id' | 'title'>): void {
  const now = Date.now();
  cg.getSpecQueries().insertSpec({
    kind: 'requirement',
    format: 'markdown',
    body: '',
    sourcePath: 'specs/x.md',
    contentHash: partial.id,
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

function link(specId: string, kind: SpecLinkKind, state: SpecLinkState, name: string): void {
  const now = Date.now();
  const l: Omit<SpecLink, 'id'> = {
    specId,
    targetFilePath: kind === 'tests' ? '__tests__/x.test.ts' : 'src/impl.ts',
    targetQualifiedName: `${specId}.${name}`,
    targetNodeKind: 'function',
    kind,
    state,
    driftAxis: null,
    specHashAtLink: 'h',
    provenance: 'agent-asserted',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
  };
  cg.getSpecQueries().upsertSpecLink(l);
}

/** A requirement with `n` criteria; the first `tested` carry verified tests. */
function seedReq(id: string, opts: { n: number; tested: number; implState?: SpecLinkState }): void {
  insertSpec({ id, kind: 'requirement', title: `Requirement ${id}` });
  link(id, 'implements', opts.implState ?? 'verified', 'impl');
  for (let i = 1; i <= opts.n; i++) {
    insertSpec({ id: `${id}.A${i}`, kind: 'acceptance', title: `Criterion ${i} of ${id}`, parentId: id });
    if (i <= opts.tested) link(`${id}.A${i}`, 'tests', 'verified', `t${i}`);
  }
}

async function detail(id: string): Promise<string> {
  return textOf(await handleSpecshipSpec(cg, { spec_id: id }));
}

async function list(): Promise<string> {
  return textOf(await handleSpecshipSpec(cg, { list: true }));
}

function inventoryLine(out: string, id: string): string | undefined {
  return out.split('\n').find((l) => l.trimStart().startsWith(`- ${id} `));
}

function coverageOf(id: string) {
  const r = cg.getSpecCoverage(id).requirements.find((x) => x.specId === id);
  if (!r) throw new Error(`no coverage for ${id}`);
  return r;
}

// ---- A1 ----
async function reqLinkacc007A1(): Promise<void> {
  seedReq('REQ-V-1', { n: 4, tested: 2 });

  const out = await detail('REQ-V-1');
  expect(out).toContain('**Status:** verified · 2 of 4 criteria untested');
  expect(out).toContain('**Untested criteria:**');
  expect(out).toContain('- REQ-V-1.A3 — Criterion 3 of REQ-V-1');
  expect(out).toContain('- REQ-V-1.A4 — Criterion 4 of REQ-V-1');
  expect(out).not.toContain('- REQ-V-1.A1 — ');

  // `specship spec list` (and the MCP list mode) show the same count.
  expect(inventoryLine(await list(), 'REQ-V-1')).toMatch(/\[verified · 2 of 4 criteria untested\]$/);
  const row = inventoryRows(cg.getSpecQueries(), cg.getSpecCoverage()).find((r) => r.id === 'REQ-V-1');
  expect(row).toMatchObject({ status: 'verified', untestedCriteria: ['REQ-V-1.A3', 'REQ-V-1.A4'], criteriaCount: 4 });
}

// ---- A2 ----
async function reqLinkacc007A2(): Promise<void> {
  seedReq('REQ-V-2', { n: 4, tested: 4 });

  const out = await detail('REQ-V-2');
  expect(out).toContain('**Status:** verified');
  expect(out).not.toMatch(/criteria untested/);
  expect(out).not.toContain('**Untested criteria:**');
  expect(inventoryLine(await list(), 'REQ-V-2')).toMatch(/\[verified\]$/);
  expect(untestedCriteria(coverageOf('REQ-V-2'))).toBeNull();
  expect(formatVerifiedSuffix(null)).toBe('verified');
}

// ---- A3 ----
async function reqLinkacc007A3(): Promise<void> {
  seedReq('REQ-V-3', { n: 4, tested: 1 });
  seedReq('REQ-V-4', { n: 3, tested: 3 });
  seedReq('REQ-V-5', { n: 3, tested: 1, implState: 'implemented' });

  for (const id of ['REQ-V-3', 'REQ-V-4', 'REQ-V-5']) {
    const cov = coverageOf(id);
    // One rollup fed to both surfaces' rules: the same answer.
    const core = untestedCriteria(cov);
    const ui = untestedCriteriaCount(cov as unknown as UiRequirementCoverage);
    expect(ui).toEqual(core ? { untested: core.untested.length, total: core.total } : null);
    const review = classifyRequirement(cov as unknown as UiRequirementCoverage, []);
    expect(review.untestedCount ?? null).toEqual(ui);
  }
  // …and the specship_spec text names the same count Review would show.
  const ui3 = untestedCriteriaCount(coverageOf('REQ-V-3') as unknown as UiRequirementCoverage);
  expect(ui3).toEqual({ untested: 3, total: 4 });
  expect(await detail('REQ-V-3')).toContain(`verified · ${ui3!.untested} of ${ui3!.total} criteria untested`);
}

// ---- A4 ----
async function reqLinkacc007A4(): Promise<void> {
  // Implemented (not verified) code link, two of four criteria untested.
  seedReq('REQ-N-1', { n: 4, tested: 2, implState: 'implemented' });

  const out = await detail('REQ-N-1');
  expect(out).not.toMatch(/criteria untested/);
  expect(out).not.toContain('**Untested criteria:**');
  expect(out).not.toContain('**Status:**');
  expect(inventoryLine(await list(), 'REQ-N-1')).toMatch(/\[implemented\]$/);

  const cov = coverageOf('REQ-N-1');
  expect(untestedCriteria(cov)).toBeNull();
  expect(untestedCriteriaCount(cov as unknown as UiRequirementCoverage)).toBeNull();
  expect(classifyRequirement(cov as unknown as UiRequirementCoverage, []).untestedCount).toBeUndefined();
}

describe.skipIf(!fts5Available)('verified requirement untested-criteria count (REQ-LINKACC-007)', () => {
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-untested-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(() => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('REQ-LINKACC-007.A1: a verified requirement with 2 of 4 criteria tested shows the count and names the untested two', reqLinkacc007A1);
  it('REQ-LINKACC-007.A2: a verified requirement whose criteria are all tested shows plain "verified"', reqLinkacc007A2);
  it('REQ-LINKACC-007.A3: the count comes from the coverage rollup, so Review and specship_spec agree', reqLinkacc007A3);
  it('REQ-LINKACC-007.A4: a requirement that is not verified shows no untested-criteria count', reqLinkacc007A4);
});
