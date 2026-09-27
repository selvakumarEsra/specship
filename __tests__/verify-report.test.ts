/**
 * Test-report ingestion (REQ-VSTATE-004).
 *
 * `verified` becomes a fact about a test run instead of a model's reading of a
 * log: a vitest JSON report is parsed, its cases are matched to `tests` links by
 * file + title, and the links move — with the run recorded as evidence.
 *
 * Skipped without FTS5 in the system SQLite (SpecShip.init runs the full schema).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';
import { parseVitestJsonReport, TestReportParseError } from '../src/verify/report-ingest';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-verify-report-'));
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

const TEST_FILE = '__tests__/widget.test.ts';
const TITLE = 'does the thing (REQ-RPT-001.A1)';

/** A vitest `--reporter=json` payload with one case in one file. */
function report(status: 'passed' | 'failed' | 'skipped', extra: unknown[] = []): string {
  return JSON.stringify({
    numTotalTests: 1 + extra.length,
    success: status === 'passed',
    testResults: [
      {
        name: `/abs/project/${TEST_FILE}`,
        status: status === 'passed' ? 'passed' : 'failed',
        assertionResults: [
          {
            ancestorTitles: ['widget'],
            title: TITLE,
            fullName: `widget > ${TITLE}`,
            status,
            failureMessages: status === 'failed' ? ['AssertionError: expected 1 to be 2'] : [],
          },
          ...extra,
        ],
      },
    ],
  });
}

describe.skipIf(!fts5Available)('test report ingestion (REQ-VSTATE-004)', () => {
  let dir: string;
  let cg: SpecShip;
  let sq: SpecQueries;
  let linkId: number;

  const writeReport = (body: string): string => {
    const rel = 'report.json';
    // The report records absolute paths; rewrite the fixture's placeholder root
    // to the temp project so relativization has something real to resolve.
    fs.writeFileSync(path.join(dir, rel), body.split('/abs/project').join(dir), 'utf-8');
    return rel;
  };

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    const now = Date.now();
    sq.insertSpec({
      id: 'REQ-RPT-001.A1', kind: 'acceptance', title: 'does the thing', body: 'b',
      format: 'markdown', sourcePath: 'specs/rpt.md', contentHash: 'h',
      createdAt: now, updatedAt: now,
    });
    linkId = sq.upsertSpecLink({
      specId: 'REQ-RPT-001.A1',
      targetFilePath: TEST_FILE,
      targetQualifiedName: TEST_FILE,
      targetNodeKind: 'file',
      kind: 'tests',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      provenance: 'code-comment',
      confidence: 0.9,
      metadata: { testTitles: [TITLE], evidenceSource: 'test-title' },
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(async () => {
    cg?.close();
    clean(dir);
  });

  it('a passing test promotes its link to verified and records the run (REQ-VSTATE-004.A1)', () => {
    const result = cg.verifyFromReport(writeReport(report('passed')), { runId: 'run-42' });

    expect(result.promoted.map((p) => p.specId)).toEqual(['REQ-RPT-001.A1']);
    const link = sq.getLinkById(linkId)!;
    expect(link.state).toBe('verified');

    const v = link.metadata?.verification as Record<string, unknown>;
    expect(v.result).toBe('pass');
    expect(typeof v.verifiedAt).toBe('string');
    expect(v.evidence).toEqual([`${TEST_FILE}:widget > ${TITLE}`]);
    expect((v.run as Record<string, unknown>).id).toBe('run-42');
  });

  it('a failing test demotes its link to broken with the failure recorded (REQ-VSTATE-004.A2)', () => {
    const result = cg.verifyFromReport(writeReport(report('failed')));

    expect(result.demoted.map((d) => d.specId)).toEqual(['REQ-RPT-001.A1']);
    const link = sq.getLinkById(linkId)!;
    expect(link.state).toBe('broken');
    const v = link.metadata?.verification as Record<string, unknown>;
    expect(v.result).toBe('fail');
    expect(String(v.reason)).toContain('AssertionError');
  });

  it('reported tests that match no link are counted as unmatched (REQ-VSTATE-004.A3)', () => {
    const stray = {
      ancestorTitles: ['other'],
      title: 'unrelated behaviour',
      fullName: 'other > unrelated behaviour',
      status: 'passed',
      failureMessages: [],
    };
    const result = cg.verifyFromReport(writeReport(report('passed', [stray])));

    expect(result.unmatched).toBe(1);
    expect(result.unmatchedSample).toEqual([`${TEST_FILE}:other > unrelated behaviour`]);
    // The matched one still promoted — unmatched is a report, not a failure.
    expect(result.promoted).toHaveLength(1);
  });

  it('a malformed report throws and changes no link state (REQ-VSTATE-004.A4)', () => {
    const before = sq.getLinkById(linkId)!.state;
    for (const body of ['', 'not json at all', '{"nope": 1}', '[1,2,3]']) {
      expect(() => cg.verifyFromReport(writeReport(body))).toThrow(TestReportParseError);
      expect(sq.getLinkById(linkId)!.state).toBe(before);
    }
  });

  it('a missing report file is a parse error, not an empty run (REQ-VSTATE-004.A4)', () => {
    expect(() => cg.verifyFromReport('no-such-report.json')).toThrow(TestReportParseError);
    expect(sq.getLinkById(linkId)!.state).toBe('implemented');
  });

  it('a skipped test leaves its link exactly where it was (REQ-VSTATE-004.A1)', () => {
    const result = cg.verifyFromReport(writeReport(report('skipped')));
    expect(result.promoted).toHaveLength(0);
    expect(result.demoted).toHaveLength(0);
    expect(result.unchanged).toBe(1);
    expect(sq.getLinkById(linkId)!.state).toBe('implemented');
  });

  it('the parser reads vitest JSON file names and ancestor titles (REQ-VSTATE-004.A1)', () => {
    const cases = parseVitestJsonReport(report('passed').split('/abs/project').join(dir), dir);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.file).toBe(TEST_FILE);
    expect(cases[0]!.fullName).toBe(`widget > ${TITLE}`);
    expect(cases[0]!.status).toBe('passed');
  });
});
