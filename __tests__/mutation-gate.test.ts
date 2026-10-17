/**
 * Mutation-score gate (REQ-QGATE-002): opt-in check that a spec's linked
 * tests actually kill mutants in its linked implementation. SpecShip consumes
 * a mutation-testing-report-schema JSON (produced by the project's own
 * mutation tool in CI) — deterministic, no tool execution in the gate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseMutationReport, loadMutationDeps, DEFAULT_MUTATION_THRESHOLD } from '../src/enforce/mutation';
import { evaluateEnforcement, EnforceDeps, RequirementVerification } from '../src/enforce/enforce';
import { FitnessReport } from '../src/fitness/fitness';
import { MaintainabilityReport } from '../src/graph/maintainability';
import { SpecLink } from '../src/types';

const cleanFitness = { clean: true, violations: [], configErrors: [], rulesEvaluated: 0 } as unknown as FitnessReport;
const cleanMaint = {
  clean: true, coupling: [], oversized: [], godFiles: [], cycles: [], deadCode: [],
} as unknown as MaintainabilityReport;

function link(specId: string, file: string, kind: 'implements' | 'tests'): SpecLink {
  return {
    id: 1, specId, targetFilePath: file, targetQualifiedName: 'x', targetNodeKind: 'function',
    kind, state: 'implemented', provenance: 'spec-declaration', confidence: 1,
    createdAt: 0, updatedAt: 0,
  } as unknown as SpecLink;
}

function req(id: string, implFile: string): RequirementVerification {
  return {
    id, title: id,
    testsLinks: [link(id, '__tests__/x.test.ts', 'tests')],
    sourcePath: 'specs/x.md',
    linkedFiles: [implFile, '__tests__/x.test.ts'],
  };
}

function baseDeps(requirements: RequirementVerification[] = []): EnforceDeps {
  return { drift: [], fitness: cleanFitness, maintainability: cleanMaint, requirements };
}

const REPORT = {
  schemaVersion: '2',
  files: {
    'src/pay/charge.ts': {
      mutants: [
        { status: 'Killed' }, { status: 'Killed' }, { status: 'Survived' },
        { status: 'Survived' }, { status: 'NoCoverage' }, { status: 'Timeout' },
      ],
    },
    'src/other/ok.ts': { mutants: [{ status: 'Killed' }, { status: 'Killed' }] },
  },
};

function parsesStandardSchemaIntoPerFileStats(): void {
  const stats = parseMutationReport(JSON.stringify(REPORT));
  expect(stats.get('src/pay/charge.ts')).toEqual({ killed: 3, total: 6 }); // Timeout counts as killed
  expect(stats.get('src/other/ok.ts')).toEqual({ killed: 2, total: 2 });
}

function checkAbsentWhenNotConfigured(): void {
  const r = evaluateEnforcement(baseDeps([req('REQ-P-001', 'src/pay/charge.ts')]));
  expect(r.checks.map((c) => c.check)).not.toContain('mutation');
}

function weakEvidenceNamesSpecLinkRateThreshold(): void {
  const stats = parseMutationReport(JSON.stringify(REPORT));
  const r = evaluateEnforcement(
    {
      ...baseDeps([req('REQ-P-001', 'src/pay/charge.ts'), req('REQ-P-002', 'src/other/ok.ts')]),
      mutation: { stats, threshold: 0.8, reportPath: 'reports/mutation/mutation.json' },
    },
    { gate: { mutation: true } },
  );
  const check = r.checks.find((c) => c.check === 'mutation');
  expect(check).toBeDefined();
  expect(check!.passed).toBe(false);
  expect(r.passed).toBe(false);
  // A2: names the spec ID, the implementation file, the kill rate and threshold.
  const f = check!.findings.join('\n');
  expect(f).toContain('REQ-P-001');
  expect(f).toContain('src/pay/charge.ts');
  expect(f).toContain('50%');
  expect(f).toContain('80%');
  // The healthy spec produces no finding.
  expect(f).not.toContain('REQ-P-002');
}

function skippedReportNeverFailsOrPasses(): void {
  const r = evaluateEnforcement(
    {
      ...baseDeps([req('REQ-P-001', 'src/pay/charge.ts')]),
      mutation: { stats: null, reason: 'report not found: reports/mutation/mutation.json', threshold: 0.8, reportPath: 'reports/mutation/mutation.json' },
    },
    { gate: { mutation: true } },
  );
  const check = r.checks.find((c) => c.check === 'mutation');
  expect(check).toBeDefined();
  expect(check!.skipped).toBe(true);
  expect(check!.findings.join('')).toContain('skipped');
  // A3: a skipped gate never fails the run…
  expect(r.passed).toBe(true);
  // …and is not presented as a pass.
  expect(check!.passed).not.toBe(true);
}

function loadsReportFromDiskAndScopesToConfig(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-mut-'));
  try {
    const rel = 'reports/mutation/mutation.json';
    fs.mkdirSync(path.join(dir, 'reports/mutation'), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(REPORT));
    const deps = loadMutationDeps(dir, { report: rel, threshold: 0.9 });
    expect(deps.stats?.get('src/pay/charge.ts')).toEqual({ killed: 3, total: 6 });
    expect(deps.threshold).toBe(0.9);

    const missing = loadMutationDeps(dir, { report: 'nope.json' });
    expect(missing.stats).toBeNull();
    expect(missing.reason).toContain('nope.json');
    expect(missing.threshold).toBe(DEFAULT_MUTATION_THRESHOLD);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('mutation-score gate (REQ-QGATE-002)', () => {
  it('parses the mutation-testing-report-schema into per-file stats', parsesStandardSchemaIntoPerFileStats);
  it('is absent from the report when not configured (A1)', checkAbsentWhenNotConfigured);
  it('flags weak evidence naming spec, link, kill rate and threshold (A2)', weakEvidenceNamesSpecLinkRateThreshold);
  it('reports a missing tool/report as skipped — never failed, never passed (A3)', skippedReportNeverFailsOrPasses);
  it('loads the report from disk with configured threshold', loadsReportFromDiskAndScopesToConfig);
});
