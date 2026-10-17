/**
 * Suppression scan (REQ-QGATE-004): deterministic detection of lint/type
 * suppression comments INTRODUCED by a change. Pure function over unified
 * diff text (A2) — no git, no DB.
 */

import { describe, it, expect } from 'vitest';
import { scanDisableComments } from '../src/enforce/suppressions';
import { evaluateEnforcement, EnforceDeps } from '../src/enforce/enforce';
import { FitnessReport } from '../src/fitness/fitness';
import { MaintainabilityReport } from '../src/graph/maintainability';

function diff(file: string, added: string[], removed: string[] = []): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,5 +1,9 @@',
    ' const unchanged = 1;',
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ' const alsoUnchanged = 2;',
  ].join('\n');
}

function flagsAddedNoqaWithFileLineMarker(): void {
  const findings = scanDisableComments(diff('app/models.py', [
    'import os',
    'result = do_thing()  # noqa',
  ]));
  expect(findings).toHaveLength(1);
  expect(findings[0].file).toBe('app/models.py');
  expect(findings[0].marker).toBe('noqa');
  // added lines start after one context line at new line 1 → first added is 2
  expect(findings[0].line).toBe(3);
}

function flagsEachMarkerFamily(): void {
  const cases: Array<[string, string]> = [
    ['// eslint-disable-next-line no-console', 'eslint-disable'],
    ['/* eslint-disable foo */', 'eslint-disable'],
    ['// @ts-ignore', '@ts-ignore'],
    ['// @ts-expect-error', '@ts-expect-error'],
    ['// biome-ignore lint/suspicious/noExplicitAny: legacy', 'biome-ignore'],
  ];
  for (const [line, marker] of cases) {
    const findings = scanDisableComments(diff('src/a.ts', [line]));
    expect(findings, line).toHaveLength(1);
    expect(findings[0].marker, line).toBe(marker);
  }
  const py = scanDisableComments(diff('app/b.py', ['x = f()  # type: ignore']));
  expect(py).toHaveLength(1);
  expect(py[0].marker).toBe('type: ignore');
}

function ignoresMentionsOutsideLintableContext(): void {
  // Python markers in a TS string literal are mentions, not suppressions.
  expect(scanDisableComments(diff('src/a.ts', ["const s = 'use # noqa here';"]))).toHaveLength(0);
  // JS-family markers in docs / YAML / markdown are prose.
  expect(scanDisableComments(diff('docs/guide.md', ['mention of eslint-disable and @ts-ignore']))).toHaveLength(0);
  expect(scanDisableComments(diff('wf.yaml', ['# comments the change introduces (noqa, eslint-disable)']))).toHaveLength(0);
  // A JS marker inside a plain string on a code line (no comment) is a mention.
  expect(scanDisableComments(diff('src/a.ts', ["desc('noqa, eslint-disable, @ts-ignore');"]))).toHaveLength(0);
  // A comment opener INSIDE a string literal is not a comment (the scanner's
  // own test fixtures are the dogfood case).
  expect(scanDisableComments(diff('src/a.ts', ["const fixture = '// @ts-ignore';"]))).toHaveLength(0);
  expect(scanDisableComments(diff('src/a.ts', ['const row = ["/* eslint-disable foo */", 1];']))).toHaveLength(0);
  // A doc comment MENTIONING a directive is prose — linters only honor a
  // directive at the start of the comment.
  expect(scanDisableComments(diff('src/a.ts', ['/** Which marker matched (e.g. `noqa`, `eslint-disable`). */']))).toHaveLength(0);
  expect(scanDisableComments(diff('src/a.ts', ['// never add @ts-ignore to make this pass']))).toHaveLength(0);
  // But a trailing comment on a code line IS a suppression.
  expect(scanDisableComments(diff('src/a.ts', ['foo(); // eslint-disable-line no-foo']))).toHaveLength(1);
  expect(scanDisableComments(diff('src/a.ts', ["const s = 'x'; // @ts-ignore"]))).toHaveLength(1);
  expect(scanDisableComments(diff('app/b.py', ['x = 1  # noqa: E501']))).toHaveLength(1);
}

function ignoresMovedAndDeletedSuppressions(): void {
  // Moved: identical suppression line removed and re-added (A1).
  const moved = scanDisableComments(
    diff('src/a.ts', ['// @ts-ignore'], ['// @ts-ignore']),
  );
  expect(moved).toHaveLength(0);
  // Deleted only.
  const deleted = scanDisableComments(diff('src/a.ts', [], ['x()  # noqa']));
  expect(deleted).toHaveLength(0);
  // Clean addition.
  expect(scanDisableComments(diff('src/a.ts', ['const ok = 1;']))).toHaveLength(0);
}

function labelsJustifiedSuppressions(): void {
  const justified = scanDisableComments(diff('src/a.ts', [
    '// eslint-disable-next-line no-console -- CLI entry point must print',
  ]));
  expect(justified).toHaveLength(1);
  expect(justified[0].justified).toBe(true);
  const bare = scanDisableComments(diff('src/a.ts', ['// eslint-disable-next-line no-console']));
  expect(bare[0].justified).toBe(false);
}

function countsLinesAcrossHunksAndFiles(): void {
  const text = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,4 @@',
    ' ctx;',
    '+// @ts-ignore',
    ' ctx;',
    '@@ -40,2 +41,3 @@',
    ' ctx;',
    '+ok();',
    '+bad(); // @ts-expect-error',
    'diff --git a/src/b.py b/src/b.py',
    '--- a/src/b.py',
    '+++ b/src/b.py',
    '@@ -1,1 +1,2 @@',
    ' ctx;',
    '+y = 1  # type: ignore[assignment]',
  ].join('\n');
  const findings = scanDisableComments(text);
  expect(findings).toHaveLength(3);
  expect(findings[0]).toMatchObject({ file: 'src/a.ts', line: 11, marker: '@ts-ignore' });
  expect(findings[1]).toMatchObject({ file: 'src/a.ts', line: 43, marker: '@ts-expect-error' });
  expect(findings[2]).toMatchObject({ file: 'src/b.py', line: 2, marker: 'type: ignore' });
}

describe('scanDisableComments (REQ-QGATE-004)', () => {
  it('flags an added noqa with file, line and marker (A1)', flagsAddedNoqaWithFileLineMarker);
  it('flags every recognized marker family (A2)', flagsEachMarkerFamily);
  it('ignores marker mentions in prose, strings, and non-lintable files (A2)', ignoresMentionsOutsideLintableContext);
  it('does not flag moved or deleted suppressions (A1, A2)', ignoresMovedAndDeletedSuppressions);
  it('labels a justified suppression but still flags it (A2)', labelsJustifiedSuppressions);
  it('tracks hunk line numbers across hunks and files (A2)', countsLinesAcrossHunksAndFiles);
});

// ---- enforcement gate integration (REQ-QGATE-004.A1) ----

const cleanFitness: FitnessReport = { clean: true, violations: [], configErrors: [], rulesEvaluated: 0 } as unknown as FitnessReport;
const cleanMaint: MaintainabilityReport = {
  clean: true, coupling: [], oversized: [], godFiles: [], cycles: [], deadCode: [],
} as unknown as MaintainabilityReport;

function baseDeps(): EnforceDeps {
  return { drift: [], fitness: cleanFitness, maintainability: cleanMaint, requirements: [] };
}

function suppressionsCheckAbsentWhenNotScanned(): void {
  const r = evaluateEnforcement(baseDeps());
  expect(r.checks.map((c) => c.check)).not.toContain('suppressions');
}

function suppressionsCheckReportsFindings(): void {
  const findings = scanDisableComments(diff('src/a.ts', ['// @ts-ignore']));
  const r = evaluateEnforcement(
    { ...baseDeps(), suppressions: findings },
    { gate: { suppressions: true } },
  );
  const check = r.checks.find((c) => c.check === 'suppressions');
  expect(check).toBeDefined();
  expect(check!.passed).toBe(false);
  expect(check!.gating).toBe(true);
  expect(check!.findings[0]).toContain('src/a.ts');
  expect(check!.findings[0]).toContain('@ts-ignore');
  expect(r.passed).toBe(false);
}

function suppressionsCheckPassesWhenClean(): void {
  const r = evaluateEnforcement({ ...baseDeps(), suppressions: [] });
  const check = r.checks.find((c) => c.check === 'suppressions');
  expect(check).toBeDefined();
  expect(check!.passed).toBe(true);
  expect(check!.gating).toBe(false); // advisory by default
}

describe('enforcement gate: suppressions check (REQ-QGATE-004.A1)', () => {
  it('is absent when no scan was supplied (back-compat)', suppressionsCheckAbsentWhenNotScanned);
  it('reports introduced suppressions and fails when gated', suppressionsCheckReportsFindings);
  it('passes with no findings and stays advisory by default', suppressionsCheckPassesWhenClean);
});

// ---- working-tree diff helper (REQ-QGATE-004.A1 — the check-gate vehicle) ----

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workingTreeDiffText } from '../src/enforce/changed-files';

function scansWorkingTreeIncludingUntracked(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-suppr-'));
  try {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    g('init', '-q');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    fs.writeFileSync(path.join(dir, 'tracked.ts'), 'const a = 1;\n');
    g('add', 'tracked.ts');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add');
    fs.writeFileSync(path.join(dir, 'tracked.ts'), 'const a = 1;\n// @ts-ignore\nconst b = 2;\n');
    fs.writeFileSync(path.join(dir, 'fresh.py'), 'x = 1  # noqa\n');
    const text = workingTreeDiffText(dir);
    const findings = scanDisableComments(text);
    const markers = findings.map((f) => `${f.file}:${f.marker}`).sort();
    expect(markers).toEqual(['fresh.py:noqa', 'tracked.ts:@ts-ignore']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('workingTreeDiffText (REQ-QGATE-004.A1)', () => {
  it('captures tracked edits and untracked files as added lines', scansWorkingTreeIncludingUntracked);
});
