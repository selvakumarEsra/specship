/**
 * Link suggestions from implementing commits (REQ-LINKACC-010).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { lintSpecs, formatLintReport, runLintCli } from '../src/spec-lint/lint';
import {
  findRequirementCommits,
  parseNewSideHunks,
  messageNames,
  clearCommitSuggestionCaches,
  MAX_COMMITS_PER_REQUIREMENT,
  type RequirementCommit,
  type RequirementCommitResolver,
} from '../src/spec-lint/commit-suggestions';
import { loadGrammarsForLanguages } from '../src/extraction/grammars';

beforeAll(async () => {
  await loadGrammarsForLanguages(['typescript']);
});

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'linkacc010-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  clearCommitSuggestionCaches();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function specFile(id: string, key: string | null, links: string[], extra = ''): string {
  const fm = key ? `---\nid: DOC-T\ntitle: T\njira_issue_${id}: ${key}\n---\n\n` : '';
  const impl = links.length ? `implementations:\n${links.map((l) => `  - ${l}`).join('\n')}\n\n` : '';
  return `${fm}<!-- id: DOC-T -->\n# T\n\nNon-goals: none. verifies: none.\n\n<!-- id: ${id} -->\n## The thing MUST work\n\nBody.\n\n${impl}## Acceptance\n<!-- id: ${id}.A1 -->\n- It does not fail.\n${extra}`;
}

function writeSpecs(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'specs', name), body);
}

function fakeResolver(commits: RequirementCommit[]): RequirementCommitResolver {
  return (needles) => commits.filter((c) => needles.some((n) => messageNames(c.message, n)));
}

function suggestionsOf(dir: string, resolver: RequirementCommitResolver) {
  const report = lintSpecs(['specs'], { projectRoot: dir, resolveRequirementCommits: resolver });
  return {
    report,
    suggestions: report.files.flatMap((f) => f.findings.filter((x) => x.code === 'spec_link_suggestion')),
  };
}

const FIVE = ['alpha', 'beta', 'gamma', 'delta', 'Box.epsilon'].map((symbol) => ({ filePath: 'src/a.ts', symbol }));

function reqLinkacc010A1(): void {
  const dir = tmp();
  writeSpecs(dir, { 'a.md': specFile('REQ-T-001', 'PROJ-1', ['src/a.ts:alpha', 'src/a.ts:beta']) });
  const { suggestions, report } = suggestionsOf(
    dir,
    fakeResolver([{ sha: 'abcdef1234567890', message: 'PROJ-1: feat: thing', changed: FIVE }])
  );
  expect(suggestions.map((s) => s.message)).toEqual([
    '`src/a.ts:Box.epsilon` changed in abcdef1 is not linked',
    '`src/a.ts:delta` changed in abcdef1 is not linked',
    '`src/a.ts:gamma` changed in abcdef1 is not linked',
  ]);
  expect(suggestions.every((s) => s.severity === 'suggestion' && s.specId === 'REQ-T-001')).toBe(true);
  expect(report.suggestionCount).toBe(3);
  expect(report.errorCount).toBe(0);
  expect(formatLintReport(report)).toContain('Suggested links');

  // A symbol linked by another requirement the same commit names is theirs.
  const dir2 = tmp();
  writeSpecs(dir2, {
    'a.md': specFile('REQ-T-001', null, ['src/a.ts:alpha', 'src/a.ts:beta']),
    'b.md': specFile('REQ-U-001', null, ['src/a.ts:gamma']).replace(/DOC-T/g, 'DOC-U'),
  });
  const shared = suggestionsOf(
    dir2,
    fakeResolver([{ sha: 'abcdef1234567890', message: 'feat: REQ-T-001 and REQ-U-001', changed: FIVE }])
  ).suggestions.filter((s) => s.specId === 'REQ-T-001');
  expect(shared.map((s) => s.message.split('`')[1])).toEqual(['src/a.ts:Box.epsilon', 'src/a.ts:delta']);
}

function reqLinkacc010A2(): void {
  const dir = tmp();
  writeSpecs(dir, { 'a.md': specFile('REQ-T-001', 'PROJ-1', ['src/a.ts:alpha']) });
  const file = path.join(dir, 'specs', 'a.md');
  const before = fs.readFileSync(file);
  const mtime = fs.statSync(file).mtimeMs;
  const listing = () => fs.readdirSync(dir, { recursive: true }).map(String).sort();
  const filesBefore = listing();
  const { report, suggestions } = suggestionsOf(
    dir,
    fakeResolver([{ sha: 'abcdef1234567890', message: 'PROJ-1: x', changed: FIVE }])
  );
  expect(suggestions.length).toBe(4);
  // Nothing created (no link sidecar, no index), nothing rewritten.
  expect(listing()).toEqual(filesBefore);
  expect(fs.readFileSync(file).equals(before)).toBe(true);
  expect(fs.statSync(file).mtimeMs).toBe(mtime);
  expect(report.hasErrors).toBe(false);
  expect(runLintCli([], { projectRoot: dir, resolveRequirementCommits: fakeResolver([
    { sha: 'abcdef1234567890', message: 'PROJ-1: x', changed: FIVE },
  ]) }).exitCode).toBe(0);
}

function reqLinkacc010A3(): void {
  const dir = tmp();
  writeSpecs(dir, { 'a.md': specFile('REQ-T-001', 'PROJ-1', ['src/a.ts:alpha']) });
  const none = suggestionsOf(dir, () => []);
  expect(none.suggestions).toEqual([]);
  expect(none.report.errorCount).toBe(0);
  expect(none.report.suggestionCount).toBe(0);

  // The real resolver on a directory that is not a git repository.
  expect(() => findRequirementCommits(['REQ-T-001', 'PROJ-1'], dir)).not.toThrow();
  expect(findRequirementCommits(['REQ-T-001'], dir)).toEqual([]);
  const real = lintSpecs(['specs'], { projectRoot: dir, resolveRequirementCommits: findRequirementCommits });
  expect(real.suggestionCount).toBe(0);
  expect(real.errorCount).toBe(0);

  // A resolver that throws is treated as "no commits".
  const throwing = suggestionsOf(dir, () => {
    throw new Error('boom');
  });
  expect(throwing.suggestions).toEqual([]);
}

function g(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function initRepo(): string {
  const dir = tmp();
  g(dir, 'init', '-q', '-b', 'main');
  g(dir, 'config', 'user.email', 't@example.com');
  g(dir, 'config', 'user.name', 'T');
  g(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commitAll(dir: string, message: string): string {
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', message);
  return g(dir, 'rev-parse', 'HEAD').trim();
}

function reqLinkacc010A4(): void {
  const dir = initRepo();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function keep() {\n  return 0;\n}\n');
  commitAll(dir, 'chore: seed');
  fs.writeFileSync(
    path.join(dir, 'src', 'a.ts'),
    'export function keep() {\n  return 0;\n}\nexport function added() {\n  return 1;\n}\nexport class Box {\n  open() {\n    return 2;\n  }\n}\n'
  );
  fs.mkdirSync(path.join(dir, '__tests__'), { recursive: true });
  fs.writeFileSync(path.join(dir, '__tests__', 'helper.ts'), 'export const BUDGET = 1;\n');
  fs.writeFileSync(
    path.join(dir, 'src', 'a.test.ts'),
    'export function helperInTest() {\n  return 3;\n}\n'
  );
  const sha = commitAll(dir, 'PROJ-9: feat: add things (REQ-T-001)');

  const commits = findRequirementCommits(['REQ-T-001'], dir);
  expect(commits.map((c) => c.sha)).toEqual([sha]);
  const changed = commits[0]!.changed.map((c) => `${c.filePath}:${c.symbol}`).sort();
  expect(changed).toEqual(['src/a.ts:Box', 'src/a.ts:Box.open', 'src/a.ts:added']); // Box: its header line is new too
  expect(changed.some((c) => c.includes('a.test.ts'))).toBe(false);
  expect(changed.some((c) => c.includes('__tests__/'))).toBe(false);

  writeSpecs(dir, { 'a.md': specFile('REQ-T-001', 'PROJ-9', ['src/a.ts:Box']) });
  const report = lintSpecs(['specs'], { projectRoot: dir, resolveRequirementCommits: findRequirementCommits });

  // A programmatic caller that does not ask for suggestions gets none, and
  // pays for no git history (postcheck, tests that lint the whole repo).
  const plain = lintSpecs(['specs'], { projectRoot: dir });
  expect(plain.suggestionCount).toBe(0);
  // `specship lint` (runLintCli) asks for them by default.
  const viaCli = runLintCli(['--json'], { projectRoot: dir });
  expect(JSON.parse(viaCli.output).suggestionCount).toBe(2);
  const msgs = report.files.flatMap((f) => f.findings).filter((f) => f.code === 'spec_link_suggestion').map((f) => f.message.split('`')[1]);
  expect([...msgs].sort()).toEqual(['src/a.ts:Box.open', 'src/a.ts:added']);
}

describe('REQ-LINKACC-010 link suggestions from implementing commits', () => {
  it('REQ-LINKACC-010.A1: five changed symbols, two linked → the other three suggested', reqLinkacc010A1);
  it('REQ-LINKACC-010.A2: suggestions change no spec file and no link', reqLinkacc010A2);
  it('REQ-LINKACC-010.A3: no identifiable commit → no suggestions, no error', reqLinkacc010A3);
  it('REQ-LINKACC-010.A4: changed test files are not suggested', reqLinkacc010A4);
});

describe('commit-suggestions internals', () => {
  it('parses new-side hunk ranges and drops pure deletions and deleted files', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +2,3 @@',
      '+x',
      '@@ -10 +12 @@',
      '@@ -20,2 +23,0 @@',
      'diff --git a/src/gone.ts b/src/gone.ts',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,4 +0,0 @@',
    ].join('\n');
    expect(parseNewSideHunks(patch)).toEqual([{ filePath: 'src/a.ts', ranges: [[2, 4], [12, 12]] }]);
  });

  it('matches requirement ids and JIRA keys on word boundaries', () => {
    expect(messageNames('feat: REQ-LINKACC-010 done', 'REQ-LINKACC-010')).toBe(true);
    expect(messageNames('feat: REQ-LINKACC-010 done', 'REQ-LINKACC-01')).toBe(false);
    expect(messageNames('SSHIP-828: x', 'SSHIP-82')).toBe(false);
    expect(messageNames('SSHIP-828: x', 'SSHIP-828')).toBe(true);
    expect(messageNames('(REQ-T-001.A2)', 'REQ-T-001')).toBe(true);
    expect(messageNames('REQ-T-001-extra', 'REQ-T-001')).toBe(false);
  });

  it('ignores a merge commit that names the requirement', () => {
    const dir = initRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function base() {}\n');
    commitAll(dir, 'chore: seed');
    g(dir, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'export function onSide() {}\n');
    commitAll(dir, 'feat: side work');
    g(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'src', 'c.ts'), 'export function onMain() {}\n');
    commitAll(dir, 'feat: main work');
    g(dir, 'merge', '-q', '--no-ff', '-m', 'merge REQ-T-001 (run x) into main', 'side');
    expect(findRequirementCommits(['REQ-T-001'], dir)).toEqual([]);
  });

  it('a method-only edit suggests Class.method, not the class', () => {
    const dir = initRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'k.ts'), 'export class K {\n  m() {\n    return 1;\n  }\n}\n');
    commitAll(dir, 'chore: seed');
    fs.writeFileSync(path.join(dir, 'src', 'k.ts'), 'export class K {\n  m() {\n    return 2;\n  }\n}\n');
    commitAll(dir, 'REQ-T-001: tweak');
    const changed = findRequirementCommits(['REQ-T-001'], dir)[0]!.changed.map((c) => c.symbol);
    expect(changed).toEqual(['K.m']);
  });

  it('--no-suggest turns the suggestion pass off', () => {
    const dir = tmp();
    writeSpecs(dir, { 'a.md': specFile('REQ-T-001', null, []) });
    let called = 0;
    const resolver: RequirementCommitResolver = () => {
      called++;
      return [{ sha: 'abcdef1234567890', message: 'REQ-T-001', changed: FIVE }];
    };
    const off = runLintCli(['--json', '--no-suggest'], { projectRoot: dir, resolveRequirementCommits: resolver });
    expect(called).toBe(0);
    expect(JSON.parse(off.output).suggestionCount).toBe(0);
  });

  it('caps matching commits per requirement at the newest 25', () => {
    const dir = initRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const shas: string[] = [];
    for (let i = 0; i < MAX_COMMITS_PER_REQUIREMENT + 3; i++) {
      fs.writeFileSync(path.join(dir, 'src', 'a.ts'), `export function f${i}() {}\n`);
      shas.push(commitAll(dir, `REQ-T-001: step ${i}`));
    }
    const commits = findRequirementCommits(['REQ-T-001'], dir);
    expect(commits.length).toBe(MAX_COMMITS_PER_REQUIREMENT);
    expect(commits.map((c) => c.sha)).toEqual(shas.slice(-MAX_COMMITS_PER_REQUIREMENT).reverse());
  });

  it('skips the symbols of a commit touching more than 200 files', () => {
    const dir = initRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    for (let i = 0; i < 201; i++) fs.writeFileSync(path.join(dir, 'src', `v${i}.ts`), `export function v${i}() {}\n`);
    commitAll(dir, 'REQ-T-001: vendor');
    const commits = findRequirementCommits(['REQ-T-001'], dir);
    expect(commits.length).toBe(1);
    expect(commits[0]!.changed).toEqual([]);
  });
});
