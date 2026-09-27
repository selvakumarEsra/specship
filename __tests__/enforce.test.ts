/**
 * Enforcement-mode tests (REQ-ENFORCE-001/002/003/004).
 *
 * Pure-function tests over hand-built dependency snapshots — no DB needed.
 * Covers opt-in (no gate → advisory → passes), per-check gating + incremental
 * adoption, the behaviour chain (broken / unverified / verified / excluded),
 * and the graduation ramp (--strict override + --enable-gate config writing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { changedFilesSince, InvalidRefError } from '../src/enforce/changed-files';
import {
  evaluateEnforcement,
  strictEnforceConfig,
  enableGateChecks,
  loadEnforceConfig,
  ENFORCE_CONFIG_FILE,
} from '../src/enforce/enforce';
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

describe('enforce — graduation ramp (REQ-ENFORCE-004)', () => {
  it('strictEnforceConfig gates every check for the run (A2)', () => {
    const r = evaluateEnforcement(
      deps({ drift: [link('REQ-X', 'drifted')], fitness: dirtyFitness }),
      strictEnforceConfig(),
    );
    expect(r.checks.every((c) => c.gating)).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.gatedFailures).toContain('drift');
    expect(r.gatedFailures).toContain('fitness');
  });

  it('enableGateChecks writes gating into specship.config.json and preserves other keys (A1)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-enforce-'));
    try {
      fs.writeFileSync(
        path.join(dir, ENFORCE_CONFIG_FILE),
        JSON.stringify({ other: { keep: true }, enforce: { behaviour: { exclude: ['REQ-Z'] } } }),
      );
      const enabled = enableGateChecks(dir, ['drift', 'behaviour']);
      expect(enabled).toEqual(['drift', 'behaviour']);
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, ENFORCE_CONFIG_FILE), 'utf-8'));
      expect(cfg.enforce.gate).toEqual({ drift: true, behaviour: true });
      expect(cfg.other).toEqual({ keep: true });
      expect(cfg.enforce.behaviour.exclude).toEqual(['REQ-Z']);
      expect(loadEnforceConfig(dir).gate?.drift).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enableGateChecks creates the config when missing and skips already-gating checks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-enforce-'));
    try {
      expect(enableGateChecks(dir, ['drift'])).toEqual(['drift']);
      expect(enableGateChecks(dir, ['drift'])).toEqual([]);
      expect(loadEnforceConfig(dir).gate).toEqual({ drift: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the ramp does not weaken the no-config default (A4)', () => {
    const r = evaluateEnforcement(deps({ drift: [link('REQ-X', 'drifted')] }), {});
    expect(r.passed).toBe(true);
    expect(find(r, 'drift').gating).toBe(false);
  });
});

describe('enforce — maintainability gates on the high-precision verdict (REQ-REVINT-009)', () => {
  const deadCodeOnly: MaintainabilityReport = {
    ...cleanMaint,
    clean: false,
    deadCode: [{ nodeId: 'n1', name: 'unused', qualifiedName: 'a.ts:unused', filePath: 'a.ts', kind: 'function', startLine: 3, reason: 'no use edges' }],
    coupling: [{ nodeId: 'n2', name: 'hub', qualifiedName: 'b.ts:hub', filePath: 'b.ts', kind: 'function', fanIn: 40, fanOut: 2, reason: 'fan-in 40 > 20' }],
  };
  const cyclePresent: MaintainabilityReport = {
    ...cleanMaint,
    clean: false,
    cycles: [{ files: ['a.ts', 'b.ts'], reason: 'import cycle' }],
  };

  it('below-gateway findings alone do not fail the gate (REQ-REVINT-009.A1)', () => {
    const r = evaluateEnforcement(deps({ maintainability: deadCodeOnly }), { gate: { maintainability: true } });
    expect(find(r, 'maintainability').passed).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.gatedFailures).toEqual([]);
  });

  it('a high-precision finding still fails the gate (REQ-REVINT-009.A1)', () => {
    const r = evaluateEnforcement(deps({ maintainability: cyclePresent }), { gate: { maintainability: true } });
    expect(find(r, 'maintainability').passed).toBe(false);
    expect(r.gatedFailures).toContain('maintainability');
  });

  it('below-gateway findings remain advisory findings (REQ-REVINT-009.A2)', () => {
    const r = evaluateEnforcement(deps({ maintainability: deadCodeOnly }), { gate: { maintainability: true } });
    const c = find(r, 'maintainability');
    expect(c.findings).toContain('1 dead-code candidate(s)');
    expect(c.findings).toContain('1 coupling hotspot(s)');
  });
});

/**
 * Change-scoped evaluation (REQ-AUTHG-006): `specship check --since <ref>`
 * narrows the link-scoped checks to what a change actually reaches, so the
 * gate is usable as a pre-commit check on a repo with 60+ requirement docs.
 */
describe('enforce — change-scoped gating (REQ-AUTHG-006)', () => {
  const at = (specId: string, file: string, state: SpecLink['state'] = 'drifted'): SpecLink =>
    ({ specId, state, kind: 'implements', targetQualifiedName: `${specId}.sym`, targetFilePath: file } as SpecLink);

  it('drift findings are limited to links whose target file changed (A1)', () => {
    const d = deps({ drift: [at('REQ-A', 'src/a.ts'), at('REQ-B', 'src/b.ts')] });
    const r = evaluateEnforcement(d, { gate: { drift: true } }, { changedFiles: ['src/a.ts'], since: 'HEAD~1' });
    expect(find(r, 'drift').findings).toEqual(['REQ-A drifted → REQ-A.sym']);
    expect(find(r, 'drift').scoped).toBe(true);
  });

  it('a requirement is in scope when a file it links to changed (A1)', () => {
    const d = deps({
      requirements: [{
        id: 'REQ-A', title: 'A', testsLinks: [], sourcePath: 'specs/a.md', linkedFiles: ['src/a.ts'],
      }],
    });
    const r = evaluateEnforcement(d, { gate: { behaviour: true } }, { changedFiles: ['src/a.ts'] });
    expect(find(r, 'behaviour').findings[0]).toMatch(/REQ-A: unverified/);
    expect(r.passed).toBe(false);
  });

  it('a requirement is in scope when its own spec file changed (A1)', () => {
    const d = deps({
      requirements: [{ id: 'REQ-A', title: 'A', testsLinks: [], sourcePath: 'specs/a.md', linkedFiles: [] }],
    });
    const r = evaluateEnforcement(d, { gate: { behaviour: true } }, { changedFiles: ['specs/a.md'] });
    expect(find(r, 'behaviour').findings[0]).toMatch(/REQ-A/);
  });

  it('untouched requirements produce no findings at all (A2)', () => {
    const d = deps({
      drift: [at('REQ-B', 'src/b.ts')],
      requirements: [
        { id: 'REQ-A', title: 'A', testsLinks: [], sourcePath: 'specs/a.md', linkedFiles: ['src/a.ts'] },
        { id: 'REQ-B', title: 'B', testsLinks: [], sourcePath: 'specs/b.md', linkedFiles: ['src/b.ts'] },
      ],
    });
    const r = evaluateEnforcement(d, strictEnforceConfig(), { changedFiles: ['src/a.ts'] });
    expect(find(r, 'behaviour').findings.map((f) => f.split(':')[0])).toEqual(['REQ-A']);
    expect(find(r, 'drift').findings).toEqual([]);
  });

  it('without a scope, behaviour is unchanged — every requirement is evaluated (A2)', () => {
    const d = deps({
      drift: [at('REQ-B', 'src/b.ts')],
      requirements: [
        { id: 'REQ-A', title: 'A', testsLinks: [], sourcePath: 'specs/a.md', linkedFiles: ['src/a.ts'] },
        { id: 'REQ-B', title: 'B', testsLinks: [], sourcePath: 'specs/b.md', linkedFiles: ['src/b.ts'] },
      ],
    });
    const r = evaluateEnforcement(d, strictEnforceConfig());
    expect(find(r, 'behaviour').findings).toHaveLength(2);
    expect(find(r, 'drift').findings).toHaveLength(1);
    expect(find(r, 'behaviour').scoped).toBeUndefined();
  });

  it('fitness and maintainability stay repo-global under a scope', () => {
    const r = evaluateEnforcement(
      deps({ fitness: dirtyFitness }), { gate: { fitness: true } }, { changedFiles: ['src/unrelated.ts'] },
    );
    expect(find(r, 'fitness').findings).toHaveLength(1);
    expect(find(r, 'fitness').scoped).toBeUndefined();
  });

  it('path shapes normalize before matching (windows separators, ./ prefix)', () => {
    const r = evaluateEnforcement(
      deps({ drift: [at('REQ-A', 'src\\a.ts')] }), { gate: { drift: true } }, { changedFiles: ['./src/a.ts'] },
    );
    expect(find(r, 'drift').findings).toHaveLength(1);
  });
});

describe('changedFilesSince — git scoping (REQ-AUTHG-006.A1/A3)', () => {
  let repo: string;
  const git = (args: string[], cwd = repo) =>
    execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-since-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(repo, 'base.ts'), 'export const a = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
  });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it('reports committed, modified and untracked files since the ref (A1)', () => {
    const baseRef = git(['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(repo, 'committed.ts'), 'export const b = 2;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'second']);
    fs.writeFileSync(path.join(repo, 'base.ts'), 'export const a = 99;\n');
    fs.writeFileSync(path.join(repo, 'untracked.md'), '# new spec\n');

    const files = changedFilesSince(repo, baseRef);
    expect(files).toEqual(['base.ts', 'committed.ts', 'untracked.md']);
  });

  it('an unknown ref throws InvalidRefError rather than falling back to the whole repo (A3)', () => {
    expect(() => changedFilesSince(repo, 'no-such-ref')).toThrow(InvalidRefError);
    expect(() => changedFilesSince(repo, 'no-such-ref')).toThrow(/not a git ref/);
  });

  it('a non-git directory is reported as such, not as an empty change set (A3)', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-nogit-'));
    try {
      expect(() => changedFilesSince(plain, 'HEAD')).toThrow(/not a git repository|not a git ref/);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

/**
 * End-to-end scoping over a real indexed project: `specship check --since` is
 * exactly `changedFilesSince` feeding `getEnforce`'s scope argument, so this
 * covers everything the CLI flag does except commander's option parsing.
 */
describe('getEnforce — scoped run over a real project (REQ-AUTHG-006.A1/A2)', () => {
  let repo: string;
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

  beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-scoped-')); });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it('a scoped gate reports only the requirement whose code changed', async () => {
    const { SpecShip } = await import('../src');
    fs.writeFileSync(path.join(repo, 'alpha.ts'), 'export function alpha(): number { return 1; }\n');
    fs.writeFileSync(path.join(repo, 'beta.ts'), 'export function beta(): number { return 2; }\n');
    fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'specs', 'demo.md'), [
      '<!-- id: DEMO-DOC -->', '# Demo', '',
      '<!-- id: REQ-ALPHA-001 -->', '## Alpha MUST work', '',
      'implementations:', '- alpha.ts:alpha', '',
      '<!-- id: REQ-BETA-001 -->', '## Beta MUST work', '',
      'implementations:', '- beta.ts:beta', '',
    ].join('\n'));

    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']).trim();

    const cg = SpecShip.initSync(repo);
    await cg.indexAll();

    // Neither requirement has a passing test link, so an unscoped behaviour
    // run flags both.
    const all = cg.getEnforce({ gate: { behaviour: true } });
    const allIds = all.checks.find((c) => c.check === 'behaviour')!.findings.map((f) => f.split(':')[0]);
    expect(allIds).toEqual(expect.arrayContaining(['REQ-ALPHA-001', 'REQ-BETA-001']));

    // Touch only alpha.ts — the scoped run must name alpha and nothing else.
    fs.writeFileSync(path.join(repo, 'alpha.ts'), 'export function alpha(): number { return 42; }\n');
    const changedFiles = changedFilesSince(repo, base);
    expect(changedFiles).toContain('alpha.ts');

    const scoped = cg.getEnforce({ gate: { behaviour: true } }, { changedFiles, since: base });
    const behaviour = scoped.checks.find((c) => c.check === 'behaviour')!;
    expect(behaviour.scoped).toBe(true);
    expect(behaviour.findings.map((f) => f.split(':')[0])).toEqual(['REQ-ALPHA-001']);
    cg.close();
  });
});
