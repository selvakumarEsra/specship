import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPostcheck } from '../src/spec-quality/postcheck';

/**
 * PIPETRUST-DOC REQ-PIPETRUST-005 — the agent's work is checked mechanically
 * after implement: real verifies symbols covering every criterion, a CHANGELOG
 * entry for source changes, and the project's configured checks (fix first).
 * Git lookups are injected so the CHANGELOG check runs without a repo.
 */

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'postcheck-'));
  fs.mkdirSync(path.join(root, 'specs'));
  fs.mkdirSync(path.join(root, '__tests__'));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- Added rate limiting.\n\n## [0.1.0]\n');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function spec(verifies: string[]): void {
  fs.writeFileSync(
    path.join(root, 'specs', 'demo.md'),
    [
      '<!-- id: DEMO-DOC -->',
      '# Demo',
      '',
      '<!-- id: REQ-DEMO-001 -->',
      '## Login attempts MUST be rate-limited',
      '',
      'verifies:',
      ...verifies.map((v) => `  - ${v}`),
      '',
      '## Acceptance',
      '<!-- id: REQ-DEMO-001.A1 -->',
      '- The 6th failed attempt is refused.',
      '<!-- id: REQ-DEMO-001.A2 -->',
      '- A success resets the count.',
      '',
      '<!-- id: REQ-DEMO-002 -->',
      '## Another requirement MUST NOT bleed into this one',
      '',
    ].join('\n'),
  );
}

function testFile(body: string): void {
  fs.writeFileSync(path.join(root, '__tests__', 'rate.test.ts'), body);
}

const GOOD_TESTS = [
  "function refusesSixth(): void {}",
  "function resetsOnSuccess(): void {}",
  "it('refuses the 6th (REQ-DEMO-001.A1)', refusesSixth);",
  "it('resets on success (REQ-DEMO-001.A2)', resetsOnSuccess);",
].join('\n');

/** No source changes, so the CHANGELOG check is a no-op unless a test says otherwise. */
const noChanges = { changedFiles: () => [] as string[], base: 'BASE' };

function titleStringVerifiesFails(): void {
  testFile(GOOD_TESTS);
  spec(['__tests__/rate.test.ts:refuses the 6th failed attempt', '__tests__/rate.test.ts:resetsOnSuccess']);
  const r = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', ...noChanges });
  expect(r.ok).toBe(false);
  expect(r.findings.map((f) => f.message).join('\n')).toMatch(/title string, not a symbol/);
  // A symbol absent from the file fails too.
  spec(['__tests__/rate.test.ts:refusesSixth', '__tests__/rate.test.ts:noSuchTest']);
  const r2 = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', ...noChanges });
  expect(r2.findings.map((f) => f.message).join('\n')).toMatch(/no symbol noSuchTest defined/);
}

function uncoveredCriterionFails(): void {
  testFile(["function refusesSixth(): void {}", "it('refuses the 6th (REQ-DEMO-001.A1)', refusesSixth);"].join('\n'));
  spec(['__tests__/rate.test.ts:refusesSixth']);
  const r = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', ...noChanges });
  expect(r.ok).toBe(false);
  expect(r.findings.map((f) => f.message)).toEqual([
    expect.stringMatching(/^REQ-DEMO-001\.A2 has no test evidence/),
  ]);
}

function sourceChangeWithoutChangelogFails(): void {
  testFile(GOOD_TESTS);
  spec(['__tests__/rate.test.ts:refusesSixth', '__tests__/rate.test.ts:resetsOnSuccess']);
  const unchangedBase = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const r = runPostcheck({
    projectRoot: root,
    requirementId: 'REQ-DEMO-001',
    base: 'BASE',
    changedFiles: () => ['src/auth/rate-limit.ts'],
    baseFile: () => unchangedBase,
  });
  expect(r.ok).toBe(false);
  expect(r.findings.map((f) => f.check)).toEqual(['changelog']);
  // With a new [Unreleased] entry relative to the base, it passes.
  const r2 = runPostcheck({
    projectRoot: root,
    requirementId: 'REQ-DEMO-001',
    base: 'BASE',
    changedFiles: () => ['src/auth/rate-limit.ts'],
    baseFile: () => '# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n',
  });
  expect(r2.ok).toBe(true);
}

function configuredCommandFixRunsFirst(): void {
  testFile(GOOD_TESTS);
  spec(['__tests__/rate.test.ts:refusesSixth', '__tests__/rate.test.ts:resetsOnSuccess']);
  fs.writeFileSync(
    path.join(root, 'specship.config.json'),
    JSON.stringify({ postcheck: { commands: [{ name: 'docs', check: 'check-docs', fix: 'regen-docs' }] } }),
  );
  const calls: string[] = [];
  let regenerated = false;
  const run = (cmd: string) => {
    calls.push(cmd);
    if (cmd === 'regen-docs') regenerated = true;
    return { code: cmd === 'check-docs' && !regenerated ? 1 : 0, output: '' };
  };
  const withFix = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', fix: true, run, ...noChanges });
  expect(calls).toEqual(['regen-docs', 'check-docs']);
  expect(withFix.ok).toBe(true);
  regenerated = false;
  calls.length = 0;
  const noFix = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', run, ...noChanges });
  expect(calls).toEqual(['check-docs']);
  expect(noFix.ok).toBe(false);
  expect(noFix.findings[0]!.message).toMatch(/^docs failed/);
}

function allChecksPass(): void {
  testFile(GOOD_TESTS);
  spec(['__tests__/rate.test.ts:refusesSixth', '__tests__/rate.test.ts:resetsOnSuccess']);
  const r = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', ...noChanges });
  expect(r.findings).toEqual([]);
  expect(r.ok).toBe(true);
}

function postcheckRunsKnowledgeCheck(): void {
  testFile(GOOD_TESTS);
  spec(['__tests__/rate.test.ts:refusesSixth', '__tests__/rate.test.ts:resetsOnSuccess']);
  fs.mkdirSync(path.join(root, 'specs', 'domain'));
  fs.writeFileSync(
    path.join(root, 'specs', 'domain', 'acme.md'),
    ['---', 'id: DOM-X-001', 'title: Acme tables', 'type: rule', '---', '', '# Acme tables', '', '## Enforced',
      '- `src/**/*.ts` must not match `/\\[\\[rules\\]\\]/`', ''].join('\n'),
  );
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'policy.ts'), "export const T = '[[rules]]';\n");
  const r = runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', ...noChanges });
  expect(r.ok).toBe(false);
  expect(r.findings.map((f) => f.check)).toEqual(['knowledge']);
  expect(r.findings[0]!.message).toMatch(/^src\/policy\.ts:1 violates DOM-X-001/);
  fs.writeFileSync(path.join(root, 'src', 'policy.ts'), "export const T = '[[rule]]';\n");
  expect(runPostcheck({ projectRoot: root, requirementId: 'REQ-DEMO-001', ...noChanges }).ok).toBe(true);
}

describe('mechanical postcheck (REQ-PIPETRUST-005)', () => {
  it('a title-string or missing verifies symbol fails (REQ-PIPETRUST-005.A1)', titleStringVerifiesFails);
  it('a criterion without test evidence fails (REQ-PIPETRUST-005.A2)', uncoveredCriterionFails);
  it('a src change without a CHANGELOG entry fails (REQ-PIPETRUST-005.A3)', sourceChangeWithoutChangelogFails);
  it('a configured fix runs before its check (REQ-PIPETRUST-005.A4)', configuredCommandFixRunsFirst);
  it('a fully covered, documented change passes', allChecksPass);
  it('postcheck fails on an enforced domain-fact rule violation (REQ-KNOW-003.A4)', postcheckRunsKnowledgeCheck);
});
