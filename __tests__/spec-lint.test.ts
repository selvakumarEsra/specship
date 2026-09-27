/**
 * Spec linter tests (AUTHG-DOC, REQ-AUTHG-001).
 *
 * `lintSpecSource` is pure over (path, source), so most checks are string
 * fixtures; the file-walking and exit-code behavior are covered through
 * `lintSpecs` / `runLintCli` against a temp directory.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  lintSpecSource,
  lintSpecs,
  formatLintReport,
  runLintCli,
} from '../src/spec-lint/lint';
import type { LintFinding } from '../src/spec-lint/lint';

const codes = (findings: LintFinding[]) => findings.map((f) => f.code);
const byCode = (findings: LintFinding[], code: string) => findings.filter((f) => f.code === code);

/** A spec that passes every error check, for use as a baseline. */
const CLEAN = `---
id: CLEAN-DOC
---
<!-- id: CLEAN-DOC -->
# A clean document

Non-goals: nothing else.

<!-- id: REQ-CLEAN-001 -->
## The thing MUST work

verifies:
  - __tests__/thing.test.ts:worksEndToEnd

## Acceptance
<!-- id: REQ-CLEAN-001.A1 -->
- The thing MUST return a value for a valid input.
<!-- id: REQ-CLEAN-001.A2 -->
- An invalid input MUST be rejected with an error.
`;

const tmpDirs: string[] = [];
function tmpSpecDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-lint-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('spec lint — error checks (REQ-AUTHG-001.A1)', () => {
  it('a well-formed spec produces no error-severity findings (REQ-AUTHG-001.A1)', () => {
    const findings = lintSpecSource('specs/clean.md', CLEAN);
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('carries through the extractor errors (REQ-AUTHG-001.A1)', () => {
    const source = `---
id: DOC
---
<!-- id: DOC -->
# Doc

## A heading with no embedded id
`;
    const findings = lintSpecSource('specs/x.md', source);
    const missing = byCode(findings, 'spec_missing_id');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe('error');
  });

  it('carries through the extractor bare-path warning (REQ-AUTHG-001.A1)', () => {
    const source = `---
id: DOC
---
<!-- id: DOC -->
# Doc

<!-- id: REQ-X-001 -->
## A requirement that MUST hold

implementations:
  - commands/specship/thing.md

## Acceptance
<!-- id: REQ-X-001.A1 -->
- It MUST fail closed when absent.
`;
    const findings = lintSpecSource('specs/x.md', source);
    const bare = byCode(findings, 'spec_bare_path_ref');
    expect(bare).toHaveLength(1);
    expect(bare[0]!.severity).toBe('warning');
  });

  it('flags a duplicate id within a file, naming the first occurrence (REQ-AUTHG-001.A1)', () => {
    const source = `---
id: DOC
---
<!-- id: DOC -->
# Doc

Non-goals: none.

<!-- id: REQ-DUP-001 -->
## First MUST hold

## Acceptance
<!-- id: REQ-DUP-001.A1 -->
- It MUST reject bad input.

<!-- id: REQ-DUP-001 -->
## Second, same id, MUST hold

## Acceptance
<!-- id: REQ-DUP-001.A2 -->
- It MUST fail loudly.
`;
    const dup = byCode(lintSpecSource('specs/x.md', source), 'spec_duplicate_id');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.severity).toBe('error');
    expect(dup[0]!.specId).toBe('REQ-DUP-001');
    // Names where the id was first declared, and what the collision costs.
    expect(dup[0]!.message).toMatch(/first declared on line \d+/i);
    expect(dup[0]!.message).toMatch(/last occurrence overwrites/i);
  });

  it('flags an .A<N> id whose parent requirement is absent (REQ-AUTHG-001.A1)', () => {
    const source = `---
id: DOC
---
<!-- id: DOC -->
# Doc

Non-goals: none.

<!-- id: REQ-REAL-001 -->
## Real MUST hold

verifies:
  - __tests__/real.test.ts:holds

## Acceptance
<!-- id: REQ-REAL-001.A1 -->
- It MUST reject bad input.
<!-- id: REQ-GHOST-009.A1 -->
- An orphan criterion that MUST belong to a requirement that isn't here.
`;
    const orphans = byCode(lintSpecSource('specs/x.md', source), 'spec_orphan_acceptance_parent');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.severity).toBe('error');
    expect(orphans[0]!.specId).toBe('REQ-GHOST-009.A1');
    expect(orphans[0]!.message).toContain('REQ-GHOST-009');
  });

  it('flags a requirement with zero acceptance criteria (REQ-AUTHG-001.A1)', () => {
    const source = `---
id: DOC
---
<!-- id: DOC -->
# Doc

Non-goals: none.

<!-- id: REQ-BARE-001 -->
## Something that MUST happen

No criteria follow.

verifies:
  - __tests__/bare.test.ts:happens
`;
    const bare = byCode(lintSpecSource('specs/x.md', source), 'spec_requirement_without_acceptance');
    expect(bare).toHaveLength(1);
    expect(bare[0]!.severity).toBe('error');
    expect(bare[0]!.specId).toBe('REQ-BARE-001');
  });

  it('flags a [needs review] marker inside an acceptance bullet (REQ-AUTHG-001.A1)', () => {
    const source = CLEAN.replace(
      '- The thing MUST return a value for a valid input.',
      '- The thing MUST return a value [needs review] for a valid input.'
    );
    const marker = byCode(lintSpecSource('specs/clean.md', source), 'spec_needs_review_marker');
    expect(marker).toHaveLength(1);
    expect(marker[0]!.severity).toBe('error');
    expect(marker[0]!.specId).toBe('REQ-CLEAN-001.A1');
  });

  it('a backticked mention of the marker is not an unresolved marker (REQ-AUTHG-001.A1)', () => {
    const source = CLEAN.replace(
      '- The thing MUST return a value for a valid input.',
      '- The lint MUST report `[needs review]` markers inside acceptance bullets.'
    );
    expect(codes(lintSpecSource('specs/clean.md', source))).not.toContain('spec_needs_review_marker');
  });
});

describe('spec lint — advisory warnings (REQ-AUTHG-001.A2)', () => {
  it('warns when a requirement has no negative-case criterion (REQ-AUTHG-001.A2)', () => {
    const happyPathOnly = `---
id: DOC
---
<!-- id: DOC -->
# Doc

Non-goals: none.

<!-- id: REQ-HAPPY-001 -->
## It MUST greet

verifies:
  - __tests__/greet.test.ts:greets

## Acceptance
<!-- id: REQ-HAPPY-001.A1 -->
- The endpoint MUST return 200 with a greeting.
`;
    const warn = byCode(lintSpecSource('specs/x.md', happyPathOnly), 'spec_no_negative_case');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.severity).toBe('warning');
    expect(warn[0]!.specId).toBe('REQ-HAPPY-001');
  });

  it('does not warn about negative cases when one criterion covers a failure (REQ-AUTHG-001.A2)', () => {
    expect(codes(lintSpecSource('specs/clean.md', CLEAN))).not.toContain('spec_no_negative_case');
  });

  it('warns on a missing non-goals statement (REQ-AUTHG-001.A2)', () => {
    const source = CLEAN.replace('Non-goals: nothing else.\n', '');
    const findings = lintSpecSource('specs/clean.md', source);
    expect(codes(findings)).toContain('spec_missing_non_goals');
    expect(byCode(findings, 'spec_missing_non_goals')[0]!.severity).toBe('warning');
  });

  it('warns when nothing signals test evidence (REQ-AUTHG-001.A2)', () => {
    const source = CLEAN.replace('verifies:\n  - __tests__/thing.test.ts:worksEndToEnd\n', '');
    expect(codes(lintSpecSource('specs/clean.md', source))).toContain('spec_missing_test_plan');
  });

  it('warns on a requirement with no RFC 2119 keyword in title or body (REQ-AUTHG-001.A2)', () => {
    const source = CLEAN.replace('## The thing MUST work', '## The thing works');
    const warn = byCode(lintSpecSource('specs/clean.md', source), 'spec_requirement_without_rfc2119');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.specId).toBe('REQ-CLEAN-001');
    expect(warn[0]!.severity).toBe('warning');
  });

  it('declarative acceptance bullets alone never trip the RFC 2119 check (REQ-AUTHG-001.A2)', () => {
    // House style: the obligation sits on the requirement, the criteria read as
    // statements of fact. That must not produce a finding per bullet.
    const source = `---
id: DOC
---
<!-- id: DOC -->
# Doc

Non-goals: none.

<!-- id: REQ-STYLE-001 -->
## The tile MUST NOT show a fabricated delta

verifies:
  - __tests__/tile.test.ts:hidesDelta

## Acceptance
<!-- id: REQ-STYLE-001.A1 -->
- The tile shows no delta when no prior window is computed.
<!-- id: REQ-STYLE-001.A2 -->
- An unmeasured project renders an em dash, never a zero.
`;
    expect(codes(lintSpecSource('specs/x.md', source))).not.toContain('spec_requirement_without_rfc2119');
  });

  it('warnings alone never make the report fail (REQ-AUTHG-001.A3)', () => {
    const dir = tmpSpecDir({
      'specs/warn.md': CLEAN.replace('Non-goals: nothing else.\n', ''),
    });
    const report = lintSpecs(['specs'], { projectRoot: dir });
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.errorCount).toBe(0);
    expect(report.hasErrors).toBe(false);
  });
});

describe('spec lint — non-spec artifacts under specs/ (REQ-AUTHG-001.A4)', () => {
  it('a design handoff transcript (source.md) produces zero findings (REQ-AUTHG-001.A4)', () => {
    const transcript = `# SpecShip Desktop — Claude Design import (handoff bundle)

## Design decision record (verbatim)

## You

Make the sidebar narrower.

## Claude

Done — 280px.
`;
    expect(lintSpecSource('specs/specship-desktop/source.md', transcript)).toEqual([]);
  });

  it('a brainstorm brief produces no requirement-structure findings (REQ-AUTHG-001.A4)', () => {
    const brief = `# An idea

Some freeform thinking with no ids at all.
`;
    expect(lintSpecSource('specs/thing/brief.md', brief)).toEqual([]);
  });

  it('a domain fact produces no requirement-structure findings (REQ-AUTHG-001.A4)', () => {
    const fact = `---
id: DOM-AREA-001
type: term
---
# A term

Its meaning.
`;
    expect(lintSpecSource('specs/domain/term.md', fact)).toEqual([]);
  });
});

describe('spec lint — report shape and exit codes (REQ-AUTHG-001.A3/A4)', () => {
  it('report.hasErrors drives a non-zero exit only for errors (REQ-AUTHG-001.A3)', () => {
    const dir = tmpSpecDir({
      'specs/bad.md': `<!-- id: DOC -->
# Doc

## Heading with no id
`,
    });
    const clean = runLintCli(['specs'], { projectRoot: tmpSpecDir({ 'specs/ok.md': CLEAN }) });
    expect(clean.exitCode).toBe(0);

    const bad = runLintCli(['specs'], { projectRoot: dir });
    expect(bad.exitCode).toBe(1);
  });

  it('groups findings by file in a stable, sorted order (REQ-AUTHG-001.A4)', () => {
    const dir = tmpSpecDir({
      'specs/zeta.md': CLEAN,
      'specs/alpha.md': CLEAN,
      'specs/nested/mid.md': CLEAN,
    });
    const report = lintSpecs(['specs'], { projectRoot: dir });
    expect(report.filesChecked).toBe(3);
    expect(report.files.map((f) => f.filePath)).toEqual([
      path.join('specs', 'alpha.md'),
      path.join('specs', 'nested', 'mid.md'),
      path.join('specs', 'zeta.md'),
    ]);
    // Re-running yields an identical report (no ordering nondeterminism).
    expect(lintSpecs(['specs'], { projectRoot: dir })).toEqual(report);
  });

  it('emits machine-readable JSON with --json (REQ-AUTHG-001.A4)', () => {
    const dir = tmpSpecDir({ 'specs/ok.md': CLEAN });
    const { output, exitCode } = runLintCli(['specs', '--json'], { projectRoot: dir });
    const parsed = JSON.parse(output);
    expect(exitCode).toBe(0);
    expect(parsed.filesChecked).toBe(1);
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.files[0].filePath).toBe(path.join('specs', 'ok.md'));
    expect(Array.isArray(parsed.files[0].findings)).toBe(true);
  });

  it('a lone spec file can be linted by path (REQ-AUTHG-001.A1)', () => {
    const dir = tmpSpecDir({ 'specs/ok.md': CLEAN });
    const report = lintSpecs([path.join('specs', 'ok.md')], { projectRoot: dir });
    expect(report.filesChecked).toBe(1);
    expect(report.hasErrors).toBe(false);
  });

  it('a path that does not exist is an error, not a clean run (REQ-AUTHG-001.A3)', () => {
    const dir = tmpSpecDir({ 'specs/ok.md': CLEAN });
    const report = lintSpecs(['specs/nope.md'], { projectRoot: dir });
    expect(report.hasErrors).toBe(true);
    expect(codes(report.files[0]!.findings)).toContain('lint_path_not_found');
  });

  it('formats a clean corpus as one line and a dirty one file-grouped (REQ-AUTHG-001.A4)', () => {
    const cleanDir = tmpSpecDir({ 'specs/ok.md': CLEAN });
    expect(formatLintReport(lintSpecs(['specs'], { projectRoot: cleanDir }))).toMatch(/^Clean — 0 error/);

    const dirtyDir = tmpSpecDir({
      'specs/bad.md': `<!-- id: DOC -->
# Doc

## Heading with no id
`,
    });
    const text = formatLintReport(lintSpecs(['specs'], { projectRoot: dirtyDir }));
    expect(text).toContain(path.join('specs', 'bad.md'));
    expect(text).toMatch(/error spec_missing_id:\d+/);
  });
});

describe('spec lint — the repo corpus (REQ-AUTHG-001.A4)', () => {
  it("lints this repo's own specs/ without crashing (REQ-AUTHG-001.A4)", () => {
    const repoRoot = path.resolve(__dirname, '..');
    const report = lintSpecs(['specs'], { projectRoot: repoRoot });
    expect(report.filesChecked).toBeGreaterThan(0);
    // A4 is a no-crash + stable-shape bar, not a clean-corpus bar: every file
    // reports, and every finding carries a code, a severity, and a file.
    for (const file of report.files) {
      for (const f of file.findings) {
        expect(f.code).toBeTruthy();
        expect(['error', 'warning']).toContain(f.severity);
        expect(f.filePath).toBe(file.filePath);
      }
    }
  });
});
