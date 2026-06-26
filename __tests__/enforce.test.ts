/**
 * Enforcement-mode tests (REQ-ENFORCE-001/002/003).
 *
 * Pure-function tests over hand-built dependency snapshots — no DB needed.
 * Covers opt-in (no gate → advisory → passes), per-check gating + incremental
 * adoption, and the behaviour chain (broken / unverified / verified / excluded).
 */
import { describe, it, expect } from 'vitest';
import { evaluateEnforcement } from '../src/enforce/enforce';
import type { EnforceDeps, EnforceConfig, RequirementVerification } from '../src/enforce/enforce';
import type { SpecLink } from '../src/types';
import type { FitnessReport } from '../src/fitness/fitness';
import type { MaintainabilityReport } from '../src/graph/maintainability';

const cleanFitness: FitnessReport = { ruleCount: 0, violations: [], configErrors: [], clean: true };
const dirtyFitness: FitnessReport = {
  ruleCount: 1, configErrors: [],
  violations: [{ rule: 'r', ruleType: 'forbidden', source: 'a', target: 'b', location: 'a.ts:1', edgeKind: 'calls', detail: 'x' }],
  clean: false,
};
const cleanMaint: MaintainabilityReport = {
  thresholds: { highDegree: 20, largeSymbolLines: 200, godFileSymbols: 40 },
  coupling: [], oversized: [], godFiles: [], cycles: [], deadCode: [], clean: true,
};
const link = (specId: string, state: SpecLink['state'], kind: SpecLink['kind'] = 'tests'): SpecLink =>
  ({ specId, state, kind, targetQualifiedName: `${specId}.test`, targetFilePath: 't.ts' } as SpecLink);

function deps(over: Partial<EnforceDeps> = {}): EnforceDeps {
  return {
    drift: over.drift ?? [],
    fitness: over.fitness ?? cleanFitness,
    maintainability: over.maintainability ?? cleanMaint,
    requirements: over.requirements ?? [],
  };
}
const find = (r: ReturnType<typeof evaluateEnforcement>, c: string) => r.checks.find((x) => x.check === c)!;

describe('enforce — opt-in (REQ-ENFORCE-002.A2)', () => {
  it('with no gate config, findings stay advisory and the run passes', () => {
    const r = evaluateEnforcement(deps({ drift: [link('REQ-X', 'drifted')], fitness: dirtyFitness }), {});
    expect(r.passed).toBe(true);
    expect(r.gatedFailures).toEqual([]);
    expect(find(r, 'drift').gating).toBe(false);
    expect(find(r, 'drift').passed).toBe(false); // finding present, just not gating
  });
});

describe('enforce — per-check gating + incremental (REQ-ENFORCE-001 / 002.A1/A3)', () => {
  it('a gating check with findings fails the run', () => {
    const r = evaluateEnforcement(deps({ drift: [link('REQ-X', 'drifted')] }), { gate: { drift: true } });
    expect(r.passed).toBe(false);
    expect(r.gatedFailures).toContain('drift');
  });

  it('enabling one check does not implicitly gate the others', () => {
    const r = evaluateEnforcement(
      deps({ drift: [link('REQ-X', 'drifted')], fitness: dirtyFitness }),
      { gate: { fitness: true } }, // only fitness gates
    );
    expect(r.passed).toBe(false);
    expect(r.gatedFailures).toEqual(['fitness']); // drift failed but is advisory
    expect(find(r, 'drift').gating).toBe(false);
  });

  it('a gating check with no findings passes', () => {
    const r = evaluateEnforcement(deps({}), { gate: { drift: true, fitness: true, maintainability: true } });
    expect(r.passed).toBe(true);
  });
});

describe('enforce — behaviour chain (REQ-ENFORCE-003)', () => {
  const reqs = (...rs: RequirementVerification[]): EnforceDeps => deps({ requirements: rs });

  it('fails when a requirement has a broken tests link (A2)', () => {
    const r = evaluateEnforcement(reqs({ id: 'REQ-A', title: 'A', testsLinks: [link('REQ-A', 'broken')] }), { gate: { behaviour: true } });
    expect(r.passed).toBe(false);
    expect(find(r, 'behaviour').findings[0]).toMatch(/broken/);
  });

  it('fails when a requirement has no verified tests link (A3)', () => {
    const r = evaluateEnforcement(reqs({ id: 'REQ-A', title: 'A', testsLinks: [] }), { gate: { behaviour: true } });
    expect(r.passed).toBe(false);
    expect(find(r, 'behaviour').findings[0]).toMatch(/unverified/);
  });

  it('passes when a requirement has a verified tests link', () => {
    const r = evaluateEnforcement(reqs({ id: 'REQ-A', title: 'A', testsLinks: [link('REQ-A', 'verified')] }), { gate: { behaviour: true } });
    expect(r.passed).toBe(true);
    expect(find(r, 'behaviour').passed).toBe(true);
  });

  it('skips a requirement explicitly excluded from behaviour gating (A4)', () => {
    const r = evaluateEnforcement(
      reqs({ id: 'REQ-A', title: 'A', testsLinks: [] }),
      { gate: { behaviour: true }, behaviour: { exclude: ['REQ-A'] } },
    );
    expect(r.passed).toBe(true);
    expect(find(r, 'behaviour').findings).toEqual([]);
  });
});
