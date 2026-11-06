/**
 * REQ-LINKACC-006 — a verification records the test run it rests on.
 *
 * End to end against a real temp project: a spec, a code file and a test file
 * are indexed, a vitest JSON report is ingested the way `specship verify
 * --report` does, and each verify surface (the `specship_link_verify` tool and
 * the dashboard's POST /api/spec/link-verify) is driven for real.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src';
import type { SpecLink } from '../src/types';
import { handleSpecshipLinkVerify, handleSpecshipSpec, formatLink } from '../src/mcp/spec-tools';
import { registerSpecRoutes } from '../server/src/routes/spec';
import { coveringRun } from '../src/verify/report-ingest';

const fts5Available = (() => {
  for (const probe of [
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
      const db = probe();
      try {
        db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
        return true;
      } catch {
        /* no fts5 on this backend */
      } finally {
        db.close();
      }
    } catch {
      /* backend unavailable */
    }
  }
  return false;
})();

const CODE = `export function total(items: number[]): number {
  let sum = 0;
  for (const i of items) sum += i;
  return sum;
}
`;

const TEST_FILE = `import { it } from 'vitest';
import { total } from '../src/total';

function checksTotal(): void {
  if (total([1, 2]) !== 3) throw new Error('bad');
}

it('checksTotal', checksTotal);
`;

const SPEC = `---
id: RB-DOC
title: Run-backed fixture
---

<!-- id: RB-DOC -->
# Run-backed fixture

<!-- id: REQ-RB-001 -->
## Total MUST add numbers

The total function MUST add every number it is given.

implementations:
  - src/total.ts:total

verifies:
  - __tests__/total.test.ts:checksTotal

<!-- id: REQ-RB-002 -->
## Total MUST start at zero

The total function MUST start counting at zero.

implementations:
  - src/total.ts:total

verifies:
  - __tests__/total.test.ts:checksTotal

<!-- id: REQ-RB-003 -->
## Total MUST be reviewed

The total function MUST be reviewed by a person.

implementations:
  - src/total.ts:total

verifies:
  - __tests__/other.test.ts:reviewedByHand
`;

function report(root: string, status: 'passed' | 'failed'): string {
  return JSON.stringify({
    testResults: [
      {
        name: path.join(root, '__tests__/total.test.ts'),
        status,
        assertionResults: [
          {
            ancestorTitles: [],
            title: 'checksTotal',
            fullName: 'checksTotal',
            status,
            failureMessages: status === 'failed' ? ['Error: bad'] : [],
          },
        ],
      },
    ],
  });
}

describe.skipIf(!fts5Available)('a verification records the test run it rests on (REQ-LINKACC-006)', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;

  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body, 'utf-8');
  };
  const link = (specId: string, kind: 'implements' | 'tests' = 'implements'): SpecLink => {
    const found = cg.getSpecQueries().getLinksBySpec(specId).find((l) => l.kind === kind);
    if (!found) throw new Error(`no ${kind} link on ${specId}`);
    return found;
  };
  const verification = (l: SpecLink): Record<string, unknown> =>
    (l.metadata?.verification ?? {}) as Record<string, unknown>;
  const ingest = (status: 'passed' | 'failed'): void => {
    write('report.json', report(dir, status));
    cg.verifyFromReport('report.json', { runId: 'run-1', commit: 'abc123', headCommit: 'abc123' });
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-linkacc006-'));
    write('src/total.ts', CODE);
    write('__tests__/total.test.ts', TEST_FILE);
    write('__tests__/other.test.ts', `import { it } from 'vitest';\nfunction reviewedByHand(): void {}\nit('reviewedByHand', reviewedByHand);\n`);
    write('specs/run-backed.md', SPEC);
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    app = Fastify({ logger: false });
    app.decorate('activeCg', async (_req: FastifyRequest) => cg);
    await registerSpecRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function reqLinkacc006A1(): Promise<void> {
    ingest('passed');
    const res = await handleSpecshipLinkVerify(cg, { link_id: link('REQ-RB-001').id, result: 'pass' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('run run-1 @ abc123');

    const after = link('REQ-RB-001');
    expect(after.state).toBe('verified');
    const v = verification(after);
    expect(v.basis).toBe('run');
    expect(v.reason).toBeUndefined();
    const run = v.run as Record<string, unknown>;
    expect(run.id).toBe('run-1');
    expect(run.commit).toBe('abc123');
    expect(typeof run.ranAt).toBe('string');
    expect(run.results).toEqual([{ test: '__tests__/total.test.ts:checksTotal', status: 'passed' }]);
  }

  async function reqLinkacc006A2(): Promise<void> {
    // REQ-RB-003's test is never in a report: verified by hand.
    const res = await handleSpecshipLinkVerify(cg, {
      link_id: link('REQ-RB-003').id,
      result: 'pass',
      reason: 'walked through it with the owner',
    });
    expect(res.isError).toBeFalsy();
    const after = link('REQ-RB-003');
    expect(after.state).toBe('verified');
    expect(verification(after).basis).toBe('hand');
    expect(verification(after).run).toBeUndefined();
    expect(formatLink(after)).toContain('verified by hand');
    expect(formatLink(after)).toContain('walked through it with the owner');
  }

  async function reqLinkacc006A3(): Promise<void> {
    ingest('failed');
    const res = await handleSpecshipLinkVerify(cg, { link_id: link('REQ-RB-001').id, result: 'pass', reason: 'looks fine' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('__tests__/total.test.ts:checksTotal');
    expect(res.content[0].text).toContain('run-1');
    expect(link('REQ-RB-001').state).toBe('implemented');
    expect(verification(link('REQ-RB-001')).verifiedAt).toBeUndefined();

    // The dashboard route refuses the same verify.
    const reply = await app.inject({
      method: 'POST',
      url: '/api/spec/link-verify',
      payload: { link_id: link('REQ-RB-002').id, result: 'pass' },
    });
    expect(reply.statusCode).toBe(409);
    expect(reply.json().code).toBe('run_failed');
    expect(reply.json().error).toContain('__tests__/total.test.ts:checksTotal');
    expect(link('REQ-RB-002').state).toBe('implemented');
  }

  async function reqLinkacc006A4(): Promise<void> {
    ingest('passed');
    await handleSpecshipLinkVerify(cg, { link_id: link('REQ-RB-001').id, result: 'pass' });
    const res = await handleSpecshipSpec(cg, { spec_id: 'REQ-RB-001' });
    const out = res.content[0].text;
    expect(out).toMatch(/↳ verified \S+ · run run-1 · commit abc123 · 1 passed/);
  }

  // Two evidence links, each holding its own latest result: X failed in run-1
  // and run-2 re-ran only Y. X's failure must still count.
  async function reqLinkacc006A3OlderFailureCounts(): Promise<void> {
    const ev = (test: string, status: 'passed' | 'failed', id: string, ranAt: string): SpecLink => ({
      ...link('REQ-RB-001', 'tests'),
      metadata: { verification: { result: status === 'passed' ? 'pass' : 'fail', run: { id, ranAt, commit: 'c' }, results: [{ test, status }] } },
    });
    const cr = coveringRun([ev('X', 'failed', 'run-1', '2026-11-06T01:00:00Z'), ev('Y', 'passed', 'run-2', '2026-11-06T02:00:00Z')])!;
    expect(cr.id).toBe('run-2');
    expect(cr.failed).toEqual(['X']);
    expect(cr.complete).toBe(true);
  }

  async function reqLinkacc006PartialCoverageIsHand(): Promise<void> {
    ingest('passed'); // covers checksTotal only
    const now = Date.now();
    const spec = cg.getSpecQueries().getSpecById('REQ-RB-001')!;
    cg.getSpecQueries().upsertSpecLink({
      specId: 'REQ-RB-001', targetFilePath: '__tests__/other.test.ts', targetQualifiedName: 'reviewedByHand',
      targetNodeKind: 'function', kind: 'tests', state: 'implemented', driftAxis: null,
      specHashAtLink: spec.contentHash, provenance: 'spec-declaration', confidence: 1, createdAt: now, updatedAt: now,
    });
    const res = await handleSpecshipLinkVerify(cg, { link_id: link('REQ-RB-001').id, result: 'pass', reason: 'partly covered' });
    expect(JSON.stringify(res)).not.toMatch(/Cannot verify/);
    expect(verification(link('REQ-RB-001')).basis).toBe('hand');
    expect(verification(link('REQ-RB-001')).run).toBeUndefined();
  }

  async function reqLinkacc006DashboardGateCountsCriteria(): Promise<void> {
    const sq = cg.getSpecQueries();
    const now = Date.now();
    for (const [id, kind, parentId] of [['REQ-RB-009', 'requirement', 'RB-DOC'], ['REQ-RB-009.A1', 'acceptance', 'REQ-RB-009']] as const) {
      sq.insertSpec({ id, kind, title: id, body: 'b', format: 'markdown', sourcePath: 'specs/run-backed.md', parentId, contentHash: 'h9', createdAt: now, updatedAt: now });
    }
    const base = { targetNodeKind: 'function' as const, state: 'implemented' as const, driftAxis: null, specHashAtLink: 'h9', confidence: 1, createdAt: now, updatedAt: now };
    sq.upsertSpecLink({ ...base, specId: 'REQ-RB-009', targetFilePath: 'src/total.ts', targetQualifiedName: 'total', kind: 'implements', provenance: 'spec-declaration' });
    sq.upsertSpecLink({ ...base, specId: 'REQ-RB-009.A1', targetFilePath: '__tests__/total.test.ts', targetQualifiedName: 'checksTotal', kind: 'tests', provenance: 'spec-declaration' });
    const impl = link('REQ-RB-009');
    expect(cg.verificationEvidence(impl).length).toBe(1);
    const reply = await app.inject({ method: 'POST', url: '/api/spec/link-verify', payload: { link_id: impl.id, result: 'pass', reason: 'criterion evidence' } });
    expect(reply.statusCode).toBe(200);
    expect(link('REQ-RB-009').state).toBe('verified');
  }

  // The dashboard route records the same basis and run as the MCP tool.
  async function reqLinkacc006DashboardRouteSameRecord(): Promise<void> {
    ingest('passed');
    await handleSpecshipLinkVerify(cg, { link_id: link('REQ-RB-001').id, result: 'pass' });
    const reply = await app.inject({
      method: 'POST',
      url: '/api/spec/link-verify',
      payload: { link_id: link('REQ-RB-002').id, result: 'pass' },
    });
    expect(reply.statusCode).toBe(200);
    const strip = (v: Record<string, unknown>) => {
      const { verifiedAt: _t, ...rest } = v;
      return rest;
    };
    const fromTool = verification(link('REQ-RB-001'));
    const fromRoute = verification(link('REQ-RB-002'));
    expect(fromRoute.basis).toBe('run');
    expect(strip(fromRoute)).toEqual(strip(fromTool));
  }

  it('REQ-LINKACC-006.A1 a covering run is stored with its commit and time, no reason needed', reqLinkacc006A1);
  it('REQ-LINKACC-006.A2 a verify no run covers is shown as verified by hand with its reason', reqLinkacc006A2);
  it('REQ-LINKACC-006.A3 a failed test in the covering run refuses a pass verify, naming the test', reqLinkacc006A3);
  it('REQ-LINKACC-006.A4 specship_spec names the commit of the run behind a verified link', reqLinkacc006A4);
  it('REQ-LINKACC-006 the dashboard route records the same verification as the tool', reqLinkacc006DashboardRouteSameRecord);
  it('REQ-LINKACC-006.A3 a test that failed in an older run and was not re-run still refuses a pass', reqLinkacc006A3OlderFailureCounts);
  it('REQ-LINKACC-006.A1 a run covering only some of the evidence is not run-backed', reqLinkacc006PartialCoverageIsHand);
  it('REQ-LINKACC-006 the dashboard accepts criterion-level evidence, as the tool does', reqLinkacc006DashboardGateCountsCriteria);
});
