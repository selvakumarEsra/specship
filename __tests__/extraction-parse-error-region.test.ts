/**
 * REQ-HTMLLEX-003 — a parse error that swallows declarations is reported as a
 * `parse_error_region` warning, never silently.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpecShip } from '../src';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import { countParseWarningFiles, formatParseWarningSummary } from '../src/extraction/parse-warnings';
import type { ExtractionError } from '../src/types';

const repoRoot = path.resolve(__dirname, '..');

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

const parseWarnings = (errors: ExtractionError[]) => errors.filter((e) => e.code === 'parse_error_region');

/** `bad`'s parameter list never closes — a real ERROR node, not a MISSING token. */
const MALFORMED = [
  'function bad(a, {',
  '  const A = 1;',
  '  const B = 2;',
  '  return A + B;',
  '}',
  '',
  'function good() { return 1; }',
  '',
].join('\n');

const CLEAN = [
  'export function alpha(x: number): number {',
  '  const doubled = x * 2;',
  '  return doubled;',
  '}',
  '',
  'export class Beta {',
  '  run(): void {}',
  '}',
  '',
].join('\n');

/** Files that lost declarations before REQ-HTMLLEX-001. */
const PREVIOUSLY_AFFECTED = [
  'src/activation/cheatsheet.ts',
  'src/design-md/extract.ts',
  'src/design-md/check.ts',
  'src/jira/spec-generator.ts',
  'src/extraction/tree-sitter.ts',
  '__tests__/design-md-upkeep.test.ts',
  '__tests__/docs-reference.test.ts',
  '__tests__/installer-targets.test.ts',
  '__tests__/criterion-ids.test.ts',
];

function reqHtmllex003A1(): void {
  const result = extractFromSource('src/malformed.ts', MALFORMED);
  const warnings = parseWarnings(result.errors);
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings[0]).toMatchObject({
    severity: 'warning',
    code: 'parse_error_region',
    filePath: 'src/malformed.ts',
    line: 1,
  });
  expect(warnings[0]!.message).toMatch(/lines? 1/);
  // A warning, not an error: nothing here is severity 'error'.
  expect(result.errors.some((e) => e.severity === 'error')).toBe(false);
  // Surviving declarations are still extracted; the warning changes no nodes.
  expect(result.nodes.some((n) => n.kind === 'function' && n.name === 'good')).toBe(true);
}

function reqHtmllex003A1LocalsDoNotMask(): void {
  // `bad` is lost to a program-level ERROR region, but its body still yields
  // local constants that start inside the region. They must not hide it.
  const src = [
    'export function bad(x: string) {',
    '  const A = x.trim();',
    '  const B = A.split(",");',
    '  if (@B.length) {',
    '    return B;',
    '  }',
    '  return [];',
    '}',
    '',
    'export function good() { return 1; }',
    '',
  ].join('\n');
  const result = extractFromSource('src/locals.ts', src);
  expect(result.nodes.some((n) => n.kind === 'function' && n.name === 'bad')).toBe(false);
  const locals = result.nodes.filter((n) => n.kind === 'constant' || n.kind === 'variable');
  expect(locals.map((n) => n.name)).toEqual(expect.arrayContaining(['A', 'B']));

  const warnings = parseWarnings(result.errors);
  expect(warnings.length).toBeGreaterThan(0);
  const first = warnings[0]!;
  expect(first).toMatchObject({ severity: 'warning', code: 'parse_error_region', filePath: 'src/locals.ts', line: 1 });
  // The region really does contain the local constants' start lines.
  const [, endLine] = /lines? \d+(?:–(\d+))?/.exec(first.message)!;
  expect(Number(endLine ?? first.line)).toBeGreaterThanOrEqual(3);
}

function reqHtmllex003A1EnclosedRegionSilent(): void {
  // An ERROR inside an extracted function's body is enclosed by that function.
  const src = 'function a() {\n  const k = 1;\n  if (\n}\nfunction b() {}\n';
  const result = extractFromSource('src/enclosed.ts', src);
  expect(result.nodes.some((n) => n.kind === 'function' && n.name === 'a')).toBe(true);
  expect(parseWarnings(result.errors)).toEqual([]);
}

function reqHtmllex003A2(): void {
  expect(parseWarnings(extractFromSource('src/clean.ts', CLEAN).errors)).toEqual([]);
  for (const file of PREVIOUSLY_AFFECTED) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
    const warnings = parseWarnings(extractFromSource(file, source).errors);
    // A hit here is a REQ-HTMLLEX-001 regression, not noise to suppress.
    expect(warnings, file).toEqual([]);
  }
}

async function reqHtmllex003A3(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-parse-warn-'));
  let cg: SpecShip | undefined;
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'malformed.ts'), MALFORMED);
    fs.writeFileSync(path.join(dir, 'src', 'clean.ts'), CLEAN);

    cg = await SpecShip.init(dir);
    const indexed = await cg.indexAll();
    expect(indexed.filesWithParseWarnings).toBe(1);
    expect(indexed.filesErrored).toBe(0);
    expect(formatParseWarningSummary(indexed.filesWithParseWarnings))
      .toBe('1 file had parse-error regions — some declarations may be missing');
    expect(formatParseWarningSummary(0)).toBeNull();
    expect(countParseWarningFiles(indexed.errors)).toBe(1);

    // Everything that was extracted is still stored.
    const cleanNodes = cg.getNodesInFile('src/clean.ts').map((n) => n.name);
    expect(cleanNodes).toEqual(expect.arrayContaining(['alpha', 'Beta', 'run']));
    expect(cg.getNodesInFile('src/malformed.ts').some((n) => n.name === 'good')).toBe(true);

    // The count is not persisted: stats carry no such field.
    const stats = cg.getStats() as unknown as Record<string, unknown>;
    expect(Object.keys(stats).some((k) => /parse.?warn/i.test(k))).toBe(false);

    // sync reports the count for the changed files it re-extracts.
    fs.writeFileSync(path.join(dir, 'src', 'malformed.ts'), MALFORMED + 'function later() {}\n');
    const synced = await cg.sync();
    expect(synced.filesModified).toBe(1);
    expect(synced.filesWithParseWarnings).toBe(1);
    expect(cg.getNodesInFile('src/malformed.ts').some((n) => n.name === 'later')).toBe(true);

    // Fixing the file clears the warning on the next sync.
    fs.writeFileSync(path.join(dir, 'src', 'malformed.ts'), CLEAN.replace(/alpha/g, 'gamma').replace(/Beta/g, 'Delta'));
    const fixed = await cg.sync();
    expect(fixed.filesWithParseWarnings).toBe(0);
  } finally {
    cg?.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('parse-error-region warnings (REQ-HTMLLEX-003)', () => {
  it('a malformed function yields a parse_error_region warning with file and start line (REQ-HTMLLEX-003.A1)', reqHtmllex003A1);
  it('local constants inside a program-level error region do not mask the warning (REQ-HTMLLEX-003.A1)', reqHtmllex003A1LocalsDoNotMask);
  it('an error region enclosed by an extracted function stays silent (REQ-HTMLLEX-003.A1)', reqHtmllex003A1EnclosedRegionSilent);
  it('clean files and the nine previously affected files emit no warning (REQ-HTMLLEX-003.A2)', reqHtmllex003A2);
  it('index and sync report the warned-file count, store all nodes, persist no count (REQ-HTMLLEX-003.A3)', reqHtmllex003A3, 60_000);
});
