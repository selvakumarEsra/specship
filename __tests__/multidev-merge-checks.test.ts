/**
 * Merge checks on the enforcement gate (REQ-MULTIDEV-002).
 *
 * - undeclaredLinks: an `agent-asserted` link with no spec-file declaration or
 *   code comment behind it — a fresh clone would never see it.
 * - branchBroken: with `--since <ref>`, a link that resolved at the ref but is
 *   orphaned/broken on the checkout.
 *
 * A1/A3/A4 are pure `evaluateEnforcement` tests; A2/A3 and the method-rename
 * case drive a real temp git repo through `getEnforce`; A5/A6 drive the built
 * CLI (skipped when dist/ is absent — run `npm run build` first).
 *
 * The real-repo suites are skipped without FTS5 in the system SQLite (same
 * pattern as the sibling spec suites) — SpecShip.init runs the full schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import SpecShip from '../src';
import { changedFilesSince, InvalidRefError } from '../src/enforce/changed-files';
import { evaluateEnforcement, strictEnforceConfig } from '../src/enforce/enforce';
import type { EnforceDeps, EnforceReport, BrokenAtRefEntry } from '../src/enforce/enforce';
import type { SpecLink } from '../src/types';
import type { FitnessReport } from '../src/fitness/fitness';
import type { MaintainabilityReport } from '../src/graph/maintainability';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
const binBuilt = fs.existsSync(BIN);

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

// --- pure fixtures ----------------------------------------------------------

const cleanFitness: FitnessReport = { ruleCount: 0, violations: [], configErrors: [], clean: true };
const cleanMaint: MaintainabilityReport = {
  thresholds: { highDegree: 20, largeSymbolLines: 200, godFileSymbols: 40 },
  coupling: [], oversized: [], godFiles: [], cycles: [], deadCode: [], clean: true,
};

const mkLink = (over: Partial<SpecLink>): SpecLink =>
  ({
    specId: 'REQ-X-001',
    targetFilePath: 'src/a.ts',
    targetQualifiedName: 'foo',
    targetNodeKind: 'function',
    kind: 'implements',
    state: 'verified',
    provenance: 'agent-asserted',
    ...over,
  }) as SpecLink;

function deps(over: Partial<EnforceDeps> = {}): EnforceDeps {
  return { drift: [], fitness: cleanFitness, maintainability: cleanMaint, requirements: [], ...over };
}
const check = (r: EnforceReport, name: string) => r.checks.find((c) => c.check === name);

// --- real-repo fixtures -----------------------------------------------------

const SRC_MAIN = [
  'export function foo(): number {', '  return 1;', '}', '',
  'export class Greeter {', '  hello(): string {', "    return 'hi';", '  }', '}', '',
].join('\n');
// Renamed AND changed: a same-body rename is followed by the link
// (REQ-LINKACC-005), so the branch must also change each body for the link to
// break — which is what branch-broken reports.
const SRC_BRANCH = SRC_MAIN
  .replace('function foo(', 'function fooRenamed(').replace('return 1;', 'return 2;')
  .replace('hello(): string', 'greet(): string').replace("return 'hi';", "return 'hey';");

const SPEC = `---
id: DEMO-DOC
title: Demo
---

<!-- id: DEMO-DOC -->
# Demo

<!-- id: REQ-FOO-001 -->
## Foo MUST return one

Foo MUST return one.

implementations:
  - src/a.ts:foo

<!-- id: REQ-GREET-001 -->
## Greeter MUST say hello

The greeter MUST say hello.

implementations:
  - src/a.ts:Greeter.hello

<!-- id: REQ-GHOST-001 -->
## Ghost MUST haunt

The ghost link never resolves, at main or on the branch.

implementations:
  - src/a.ts:ghost
`;

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** `main` has foo + Greeter.hello; branch `feature` renames both. HEAD = main. */
function buildRepo(dir: string): void {
  write(dir, 'src/a.ts', SRC_MAIN);
  write(dir, 'specs/demo.md', SPEC);
  write(dir, '.gitignore', '.specship/\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'SpecShip Test');
  git(dir, 'config', 'user.email', 'specship-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feature');
  write(dir, 'src/a.ts', SRC_BRANCH);
  git(dir, 'commit', '-q', '-am', 'rename foo and Greeter.hello');
  git(dir, 'checkout', '-q', 'main');
}

function runCli(cwd: string, args: string[]): { code: number; stdout: string; out: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, SPECSHIP_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// --- A1 ---------------------------------------------------------------------

describe('undeclared links (REQ-MULTIDEV-002.A1)', () => {
  it('REQ-MULTIDEV-002.A1 agent-asserted link with no declaration is reported; a declared one is not', function reqMultidev002A1() {
    const links = [
      // Index-only: nothing in the checkout re-derives it.
      mkLink({ specId: 'REQ-ONLY-001', targetQualifiedName: 'onlyInIndex' }),
      // Asserted, but also declared in an implementations: block — and in the
      // other separator form, which is the same logical link.
      mkLink({ specId: 'REQ-DECL-001', targetQualifiedName: 'Greeter.hello' }),
      mkLink({ specId: 'REQ-DECL-001', targetQualifiedName: 'Greeter::hello', provenance: 'spec-declaration' }),
      // Asserted and backed by an @implements comment.
      mkLink({ specId: 'REQ-CMT-001', targetQualifiedName: 'bar' }),
      mkLink({ specId: 'REQ-CMT-001', targetQualifiedName: 'bar', provenance: 'code-comment' }),
      // A plain declaration is never a finding.
      mkLink({ specId: 'REQ-PLAIN-001', targetQualifiedName: 'baz', provenance: 'spec-declaration' }),
    ];
    const r = evaluateEnforcement(deps({ links }));
    const c = check(r, 'undeclaredLinks')!;
    expect(c).toBeDefined();
    expect(c.findings).toHaveLength(1);
    expect(c.findings[0]).toContain('REQ-ONLY-001');
    expect(c.findings[0]).toContain('src/a.ts:onlyInIndex');
    expect(c.findings[0]).toMatch(/undeclared \(agent-asserted\)/);
    expect(c.passed).toBe(false);
  });
});

// --- A3 (pure) / A4 ---------------------------------------------------------

describe('branch-broken + gating (REQ-MULTIDEV-002.A3/A4)', () => {
  const broken: BrokenAtRefEntry[] = [
    { link: mkLink({ specId: 'REQ-BRK-001', state: 'orphaned', provenance: 'spec-declaration' }), resolvedAtRef: true, ref: 'main' },
    { link: mkLink({ specId: 'REQ-OLD-001', state: 'orphaned', provenance: 'spec-declaration', targetQualifiedName: 'ghost' }), resolvedAtRef: false, ref: 'main' },
  ];

  it('REQ-MULTIDEV-002.A3 a link already orphaned at the ref is not reported as branch-broken', function reqMultidev002A3() {
    const r = evaluateEnforcement(deps({ brokenAtRef: broken }));
    const c = check(r, 'branchBroken')!;
    expect(c.scoped).toBe(true);
    expect(c.findings).toHaveLength(1);
    expect(c.findings[0]).toContain('REQ-BRK-001');
    expect(c.findings.join('\n')).not.toContain('REQ-OLD-001');
    // No --since → the check is absent entirely, never reported as passed.
    expect(check(evaluateEnforcement(deps()), 'branchBroken')).toBeUndefined();
  });

  it('REQ-MULTIDEV-002.A4 advisory by default; gating via enforce.gate or --strict', function reqMultidev002A4() {
    const d = deps({ links: [mkLink({})], brokenAtRef: broken });

    const advisory = evaluateEnforcement(d, {});
    expect(advisory.passed).toBe(true);
    expect(check(advisory, 'undeclaredLinks')!.findings.length).toBeGreaterThan(0);
    expect(check(advisory, 'branchBroken')!.findings.length).toBeGreaterThan(0);
    expect(check(advisory, 'undeclaredLinks')!.gating).toBe(false);
    expect(check(advisory, 'branchBroken')!.gating).toBe(false);

    const gatedUndeclared = evaluateEnforcement(d, { gate: { undeclaredLinks: true } });
    expect(gatedUndeclared.passed).toBe(false);
    expect(gatedUndeclared.gatedFailures).toEqual(['undeclaredLinks']);

    const gatedBroken = evaluateEnforcement(d, { gate: { branchBroken: true } });
    expect(gatedBroken.passed).toBe(false);
    expect(gatedBroken.gatedFailures).toEqual(['branchBroken']);

    const strict = evaluateEnforcement(d, strictEnforceConfig());
    expect(strict.passed).toBe(false);
    expect(strict.gatedFailures).toEqual(expect.arrayContaining(['undeclaredLinks', 'branchBroken']));
  });
});

// --- A2 / A3 over a real repo -----------------------------------------------

describe.skipIf(!fts5Available)('branch-broken over a real git repo (REQ-MULTIDEV-002.A2/A3)', () => {
  let dir: string;
  let cg: SpecShip | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-multidev-002-'));
    buildRepo(dir);
  });
  afterEach(() => {
    cg?.close();
    cg = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const branchRun = async () => {
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    const sq = cg.getSpecQueries();
    // On main, the function and the dotted method link both resolve.
    const stateOf = (id: string) => sq.getLinksBySpec(id).find((l) => l.kind === 'implements')?.state;
    expect(stateOf('REQ-FOO-001')).not.toBe('orphaned');
    expect(stateOf('REQ-GREET-001')).not.toBe('orphaned');
    expect(stateOf('REQ-GHOST-001')).toBe('orphaned');

    git(dir, 'checkout', '-q', 'feature');
    await cg.sync();
    expect(stateOf('REQ-FOO-001')).toBe('orphaned');
    expect(stateOf('REQ-GREET-001')).toBe('orphaned');

    const scope = { changedFiles: changedFilesSince(dir, 'main'), since: 'main' };
    await cg.prepareEnforce(scope);
    return check(cg.getEnforce({}, scope), 'branchBroken')!;
  };

  it('REQ-MULTIDEV-002.A2 a function renamed on the branch is reported, naming spec ID and old target', async function reqMultidev002A2() {
    const c = await branchRun();
    const foo = c.findings.filter((f) => f.startsWith('REQ-FOO-001'));
    expect(foo).toHaveLength(1);
    expect(foo[0]).toContain('src/a.ts:foo');
    expect(foo[0]).toMatch(/orphaned on this branch, resolved at main/);
  });

  it('REQ-MULTIDEV-002.A2 a METHOD (Class.method) renamed on the branch is reported via the resolver qname match', async function reqMultidev002A2Method() {
    const c = await branchRun();
    const greet = c.findings.filter((f) => f.startsWith('REQ-GREET-001'));
    expect(greet).toHaveLength(1);
    expect(greet[0]).toContain('src/a.ts:Greeter.hello');
  });

  it('REQ-MULTIDEV-002.A3 a link already orphaned at the ref is not reported (real repo)', async function reqMultidev002A3Repo() {
    const c = await branchRun();
    expect(c.findings.join('\n')).not.toContain('REQ-GHOST-001');
  });
});

// --- A5 / A6 via the built CLI ----------------------------------------------

describe.skipIf(!fts5Available || !binBuilt)('specship check --since via the CLI (REQ-MULTIDEV-002.A5/A6)', () => {
  let root: string;

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-multidev-002-cli-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('REQ-MULTIDEV-002.A5 an unresolvable --since ref exits non-zero and never runs the gate', function reqMultidev002A5() {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    buildRepo(repo);
    expect(runCli(repo, ['init']).code).toBe(0);
    for (const bad of ['no-such-branch', 'deadbeef', '../x']) {
      expect(() => changedFilesSince(repo, bad)).toThrow(InvalidRefError);
      const r = runCli(repo, ['check', '--since', bad, '--json']);
      expect(r.code, bad).not.toBe(0);
      expect(r.out, bad).toContain(`not a git ref in this repository: ${bad}`);
      // getEnforce never ran: no report, no full-repo fallback.
      expect(r.stdout, bad).not.toContain('"checks"');
      expect(r.out, bad).not.toContain('Enforcement gate');
    }
  });

  it('REQ-MULTIDEV-002.A6 a fresh CI clone lists both merge checks in --json', function reqMultidev002A6() {
    const origin = path.join(root, 'origin');
    fs.mkdirSync(origin);
    buildRepo(origin);
    const clone = path.join(root, 'clone');
    execFileSync('git', ['clone', '-q', '-b', 'feature', origin, clone], { stdio: 'ignore' });
    expect(fs.existsSync(path.join(clone, '.specship'))).toBe(false); // no developer index

    expect(runCli(clone, ['init']).code).toBe(0);
    expect(runCli(clone, ['index']).code).toBe(0);
    const r = runCli(clone, ['check', '--since', 'origin/main', '--json']);
    expect(r.code).toBe(0); // advisory by default
    const report = JSON.parse(r.stdout) as EnforceReport;

    const undeclared = check(report, 'undeclaredLinks');
    expect(undeclared).toBeDefined();
    // A fresh clone holds only declared links, so nothing is index-only.
    expect(undeclared!.findings).toEqual([]);

    const broken = check(report, 'branchBroken')!;
    expect(broken).toBeDefined();
    expect(broken.findings.some((f) => f.startsWith('REQ-FOO-001') && f.includes('src/a.ts:foo'))).toBe(true);
    expect(broken.findings.some((f) => f.startsWith('REQ-GREET-001'))).toBe(true);
    expect(broken.findings.join('\n')).not.toContain('REQ-GHOST-001');
  });
});
