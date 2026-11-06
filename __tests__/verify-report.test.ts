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
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';
import { ingestTestReport, parseVitestJsonReport, TestReportParseError } from '../src/verify/report-ingest';

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

// ---------------------------------------------------------------------------
// REQ-LINKACC-003 — a rename-only drift clears on a passing current-commit run
// ---------------------------------------------------------------------------

const RC_TEST_FILE = '__tests__/rc.test.ts';
const RC_ROOT_TITLE = 'root behaviour holds (REQ-RC-001)';
const RC_A1_TITLE = 'criterion one holds (REQ-RC-001.A1)';
const RC_BASELINE = '(installClaude: boolean): void';
const RC_RENAMED = '(hasStatusLine: boolean): void';

/** A vitest JSON report with the requirement's two cases. */
function rcReport(rootStatus: 'passed' | 'failed', a1Status: 'passed' | 'failed'): string {
  const c = (title: string, status: string) => ({
    ancestorTitles: ['rc'],
    title,
    fullName: `rc > ${title}`,
    status,
    failureMessages: status === 'failed' ? ['AssertionError: nope'] : [],
  });
  return JSON.stringify({
    testResults: [
      {
        name: `/abs/project/${RC_TEST_FILE}`,
        assertionResults: [c(RC_ROOT_TITLE, rootStatus), c(RC_A1_TITLE, a1Status)],
      },
    ],
  });
}

describe.skipIf(!fts5Available)('REQ-LINKACC-003 rename-only drift clearing', () => {
  let dir: string;
  let cg: SpecShip;
  let sq: SpecQueries;
  let currentSig: string;

  const writeReport = (body: string): string => {
    fs.writeFileSync(path.join(dir, 'rc-report.json'), body.split('/abs/project').join(dir), 'utf-8');
    return 'rc-report.json';
  };

  /** An `implemented` implements link that then drifted with `kind` (verified links never code-drift). */
  const seedDrifted = (kind: 'rename-only' | 'type-change' | 'shape-change', qname: string): number => {
    const now = Date.now();
    return sq.upsertSpecLink({
      specId: 'REQ-RC-001',
      targetFilePath: `src/${qname}.ts`,
      targetQualifiedName: qname,
      targetNodeKind: 'function',
      kind: 'implements',
      state: 'drifted',
      driftAxis: 'code',
      driftKind: kind,
      specHashAtLink: 'h',
      nodeSigAtLink: RC_BASELINE,
      provenance: 'agent-asserted',
      confidence: 1.0,
      metadata: { preDrift: { state: 'implemented', at: now - 1000 } },
      createdAt: now,
      updatedAt: now,
    });
  };

  const ingest = (body: string, commit: string | undefined, headCommit: string | undefined) =>
    ingestTestReport(sq, dir, writeReport(body), {
      runId: 'rc-run',
      commit,
      headCommit,
      currentSignature: () => ({ signature: currentSig }),
    });

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    currentSig = RC_RENAMED;
    const now = Date.now();
    for (const [id, kind] of [['REQ-RC-001', 'requirement'], ['REQ-RC-001.A1', 'acceptance']] as const) {
      sq.insertSpec({
        id, kind, title: id, body: 'b', format: 'markdown', sourcePath: 'specs/rc.md',
        contentHash: 'h', createdAt: now, updatedAt: now,
      });
    }
    for (const [specId, title] of [['REQ-RC-001', RC_ROOT_TITLE], ['REQ-RC-001.A1', RC_A1_TITLE]] as const) {
      sq.upsertSpecLink({
        specId,
        targetFilePath: RC_TEST_FILE,
        targetQualifiedName: RC_TEST_FILE,
        targetNodeKind: 'file',
        kind: 'tests',
        state: 'implemented',
        driftAxis: null,
        specHashAtLink: 'h',
        provenance: 'code-comment',
        confidence: 0.9,
        metadata: { testTitles: [title], evidenceSource: 'test-title' },
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterEach(() => {
    cg?.close();
    clean(dir);
  });

  function reqLinkacc003A1(): void {
    const id = seedDrifted('rename-only', 'install');
    const result = ingest(rcReport('passed', 'passed'), 'abc123', 'abc123');

    expect(result.cleared.map((c) => c.linkId)).toEqual([id]);
    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('implemented');
    expect(link.driftKind ?? null).toBeNull();
    expect(link.driftAxis ?? null).toBeNull();
    expect(link.nodeSigAtLink).toBe(RC_RENAMED);
    expect(link.metadata?.preDrift).toBeUndefined();
    // The run's commit is recorded on the test links' verification evidence.
    const testsLink = sq.getAllLinks().find((l) => l.kind === 'tests')!;
    const v = testsLink.metadata?.verification as { run: Record<string, unknown> };
    expect(v.run.commit).toBe('abc123');
  }

  function reqLinkacc003A2(): void {
    const id = seedDrifted('rename-only', 'install');
    const result = ingest(rcReport('passed', 'failed'), 'abc123', 'abc123');

    expect(result.cleared).toHaveLength(0);
    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('drifted');
    expect(link.driftKind).toBe('rename-only');
    expect(link.nodeSigAtLink).toBe(RC_BASELINE);
  }

  function reqLinkacc003A3(): void {
    const id = seedDrifted('rename-only', 'install');
    const result = ingest(rcReport('passed', 'passed'), 'old111', 'new222');

    expect(result.cleared).toHaveLength(0);
    expect(sq.getLinkById(id)!.state).toBe('drifted');
    expect(sq.getLinkById(id)!.driftKind).toBe('rename-only');
  }

  function reqLinkacc003A4(): void {
    currentSig = '(installClaude: string): void';
    const typed = seedDrifted('type-change', 'typed');
    const shaped = seedDrifted('shape-change', 'shaped');
    const result = ingest(rcReport('passed', 'passed'), 'abc123', 'abc123');

    expect(result.cleared).toHaveLength(0);
    expect(sq.getLinkById(typed)!.state).toBe('drifted');
    expect(sq.getLinkById(typed)!.driftKind).toBe('type-change');
    expect(sq.getLinkById(shaped)!.state).toBe('drifted');
    expect(sq.getLinkById(shaped)!.driftKind).toBe('shape-change');
  }

  function reqLinkacc003NoCommitClearsNothing(): void {
    const id = seedDrifted('rename-only', 'install');
    // No report commit: never defaulted to HEAD, so nothing clears.
    const result = ingest(rcReport('passed', 'passed'), undefined, 'abc123');
    expect(result.cleared).toHaveLength(0);
    expect(sq.getLinkById(id)!.state).toBe('drifted');
    // Through the public API too: no --commit, no clear, whatever HEAD is.
    const viaApi = cg.verifyFromReport(writeReport(rcReport('passed', 'passed')));
    expect(viaApi.cleared).toHaveLength(0);
    const testsLink = sq.getAllLinks().find((l) => l.kind === 'tests')!;
    const v = testsLink.metadata?.verification as { run: Record<string, unknown> };
    expect(v.run.commit).toBeUndefined();
  }

  function reqLinkacc003KindChangedSinceDrift(): void {
    const id = seedDrifted('rename-only', 'install');
    // Renamed at drift time, then the parameter's type changed too.
    currentSig = '(hasStatusLine: string): void';
    const result = ingest(rcReport('passed', 'passed'), 'abc123', 'abc123');

    expect(result.cleared).toHaveLength(0);
    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('drifted');
    expect(link.nodeSigAtLink).toBe(RC_BASELINE);
  }

  it('REQ-LINKACC-003.A1 a rename-only drift returns to its prior state after a passing current-commit report', reqLinkacc003A1);
  it('REQ-LINKACC-003.A2 one failing test of the requirement leaves the link drifted', reqLinkacc003A2);
  it('REQ-LINKACC-003.A3 a report recorded on an older commit clears nothing', reqLinkacc003A3);
  it('REQ-LINKACC-003.A4 a type-change or shape-change drift is not cleared by a passing report', reqLinkacc003A4);
  it('REQ-LINKACC-003.A3 a report with no known commit clears nothing', reqLinkacc003NoCommitClearsNothing);
  it('REQ-LINKACC-003.A4 a rename that has since become a type change stays drifted', reqLinkacc003KindChangedSinceDrift);
});

// End to end (REQ-LINKACC-003.A1): a real sync drifts an implemented link
// `rename-only` (verified links are sticky and never code-drift,
// DOM-SPECSHIP-001), then a passing report on the current commit clears it.
describe.skipIf(!fts5Available)('REQ-LINKACC-003 end to end', () => {
  let dir: string;
  let cg: SpecShip | undefined;

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body, 'utf-8');
  };
  const SPEC = `---
id: E2E-DOC
title: e2e
---

<!-- id: E2E-DOC -->
# e2e

<!-- id: REQ-E2E-001 -->
## The flag MUST be honoured

implementations:
  - src/flag.ts:readFlag

## Acceptance
<!-- id: REQ-E2E-001.A1 -->
- It reads the flag.
`;
  const TEST = "import { it } from 'vitest';\nit('reads the flag (REQ-E2E-001.A1)', () => {});\nit('honours the flag (REQ-E2E-001)', () => {});\n";
  const report = (status: 'passed' | 'failed') =>
    JSON.stringify({
      testResults: [{
        name: path.join(dir, '__tests__/flag.test.ts'),
        assertionResults: ['reads the flag (REQ-E2E-001.A1)', 'honours the flag (REQ-E2E-001)'].map((title) => ({
          ancestorTitles: [], title, fullName: title, status, failureMessages: status === 'failed' ? ['nope'] : [],
        })),
      }],
    });

  beforeEach(() => {
    dir = tempDir();
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    write('specs/e2e.md', SPEC);
    write('src/flag.ts', 'export function readFlag(installClaude: boolean): boolean {\n  return installClaude;\n}\n');
    write('__tests__/flag.test.ts', TEST);
  });
  afterEach(() => {
    cg?.close();
    cg = undefined;
    clean(dir);
  });

  async function driftByRename(): Promise<{ sq: SpecQueries; linkId: number; head: string }> {
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    const sq = cg.getSpecQueries();
    const link = sq.getLinksBySpec('REQ-E2E-001').find((l) => l.kind === 'implements')!;
    expect(link.state).toBe('implemented');
    write('src/flag.ts', 'export function readFlag(hasStatusLine: boolean): boolean {\n  return hasStatusLine;\n}\n');
    await cg.sync();
    const drifted = sq.getLinkById(link.id)!;
    expect(drifted.state).toBe('drifted');
    expect(drifted.driftKind).toBe('rename-only');
    git('add', '-A');
    git('commit', '-qm', 'rename');
    return { sq, linkId: link.id, head: git('rev-parse', 'HEAD') };
  }

  async function reqLinkacc003A1EndToEnd(): Promise<void> {
    const { sq, linkId, head } = await driftByRename();
    write('report.json', report('passed'));
    const result = cg!.verifyFromReport('report.json', { commit: head });
    expect(result.cleared.map((c) => c.linkId)).toEqual([linkId]);
    const after = sq.getLinkById(linkId)!;
    expect(after.state).toBe('implemented');
    expect(after.driftKind ?? null).toBeNull();
    expect(after.nodeSigAtLink).toContain('hasStatusLine');
    // Re-baselined: the next sync does not drift it again.
    await cg!.sync();
    expect(sq.getLinkById(linkId)!.state).toBe('implemented');
  }

  async function reqLinkacc003EndToEndFailingTestKeepsDrift(): Promise<void> {
    const { sq, linkId, head } = await driftByRename();
    write('report.json', report('failed'));
    const result = cg!.verifyFromReport('report.json', { commit: head });
    expect(result.cleared).toEqual([]);
    expect(sq.getLinkById(linkId)!.state).toBe('drifted');
  }

  it('REQ-LINKACC-003.A1: a real rename drift on an implemented link clears on a passing current-commit report', reqLinkacc003A1EndToEnd);
  it('REQ-LINKACC-003.A2: the same path with a failing test keeps the drift', reqLinkacc003EndToEndFailingTestKeepsDrift);
});
