/**
 * Named-token extraction + seedable kinds for specship_explore
 * (EXPLORE-PIN-DOC, REQ-EXPLORE-PIN-002 / REQ-EXPLORE-PIN-003).
 *
 * The named-seed path in handleExplore decides which query tokens get
 * resolved to definitions and injected into the subgraph. Two filters used
 * to drop the most natural ways to name a target:
 *
 *   - the token pattern excluded `-`, so every kebab-case filename
 *     (`server-instructions.ts`, `git-hooks`) was silently discarded before
 *     it could seed anything;
 *   - only callable kinds were accepted, so naming a constant, interface,
 *     or type alias had no effect on ranking at all.
 *
 * Both produced the same user-visible failure: explore returns nothing for a
 * target the agent named verbatim, the agent falls back to Grep, and the
 * fallback gets reinforced. These tests pin the accepted token shapes and
 * kinds so a future tuning pass can't quietly narrow them again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractNamedTokens,
  SEEDABLE_KINDS,
  resolveNamedFilePaths,
  MAX_PINNED_FILES,
  getExploreOutputBudget,
  ToolHandler,
} from '../src/mcp/tools';
import SpecShip from '../src/index';

describe('extractNamedTokens', () => {
  it('extracts a kebab-case filename token carrying its extension', () => {
    // REQ-EXPLORE-PIN-002.A1 — the exact miss that motivated this spec.
    expect(extractNamedTokens('server-instructions.ts UserPromptSubmit hook'))
      .toContain('server-instructions.ts');
  });

  it('extracts a bare kebab-case basename', () => {
    // REQ-EXPLORE-PIN-002.A2
    expect(extractNamedTokens('git-hooks installGitSyncHook')).toContain('git-hooks');
  });

  it('emits both the extension-bearing token and its stripped form', () => {
    // Stripping the extension must not be a PRECONDITION for matching (the
    // extension is the strongest signal a token names a file), but the
    // stripped form still has to be tried — symbols are indexed by basename.
    const tokens = extractNamedTokens('server-instructions.ts');
    expect(tokens).toContain('server-instructions.ts');
    expect(tokens).toContain('server-instructions');
  });

  it('extracts a kebab-case project-relative path', () => {
    expect(extractNamedTokens('src/mcp/server-instructions.ts'))
      .toContain('src/mcp/server-instructions.ts');
  });

  it('still extracts the token shapes that already worked', () => {
    // Regression guard: widening the pattern must not drop qualified names,
    // Rust paths, screaming snake case, or plain identifiers.
    const tokens = extractNamedTokens(
      'GraphTraverser Harness::poll Class.method SPECSHIP_STEER_HOOKS $ref _private',
    );
    expect(tokens).toContain('GraphTraverser');
    expect(tokens).toContain('Harness::poll');
    expect(tokens).toContain('Class.method');
    expect(tokens).toContain('SPECSHIP_STEER_HOOKS');
    expect(tokens).toContain('$ref');
    expect(tokens).toContain('_private');
  });

  it('rejects tokens that cannot be an identifier or path', () => {
    const tokens = extractNamedTokens('-- --flag 123abc ab ...');
    expect(tokens).not.toContain('--flag');
    expect(tokens).not.toContain('123abc');
    expect(tokens).not.toContain('ab'); // under the 3-char floor
    expect(tokens).not.toContain('...');
  });

  it('deduplicates and caps the token count', () => {
    const tokens = extractNamedTokens('alpha alpha alpha beta');
    expect(tokens.filter((t) => t === 'alpha')).toHaveLength(1);

    const many = Array.from({ length: 40 }, (_, i) => `symbol${i}`).join(' ');
    expect(extractNamedTokens(many).length).toBeLessThanOrEqual(16);
  });

  it('honors an explicit limit', () => {
    expect(extractNamedTokens('alpha beta gamma delta', 2)).toHaveLength(2);
  });

  it('tolerates an empty or punctuation-only query', () => {
    expect(extractNamedTokens('')).toEqual([]);
    expect(extractNamedTokens('   ,, () [] ')).toEqual([]);
  });
});

describe('SEEDABLE_KINDS', () => {
  it('accepts non-callable kinds the agent routinely names', () => {
    // REQ-EXPLORE-PIN-003.A1/A2 — a config constant or an interface is as
    // likely to be the subject of a question as a function is.
    for (const kind of ['constant', 'interface', 'type_alias', 'class', 'enum', 'struct']) {
      expect(SEEDABLE_KINDS.has(kind), `${kind} should seed`).toBe(true);
    }
  });

  it('still accepts every callable kind that seeded before', () => {
    for (const kind of ['method', 'function', 'component', 'constructor']) {
      expect(SEEDABLE_KINDS.has(kind), `${kind} should seed`).toBe(true);
    }
  });

  it('excludes flood-prone kinds that would swamp the subgraph', () => {
    // These outnumber real answers by orders of magnitude and carry no
    // standalone meaning — seeding them would spend the budget on noise.
    for (const kind of ['variable', 'property', 'field', 'parameter', 'import', 'export']) {
      expect(SEEDABLE_KINDS.has(kind), `${kind} should not seed`).toBe(false);
    }
  });
});

describe('resolveNamedFilePaths', () => {
  const PATHS = [
    'src/mcp/server-instructions.ts',
    'src/mcp/tools.ts',
    'src/sync/git-hooks.ts',
    'src/installer/targets/claude.ts',
    'src/activation/steering.ts',
    'ui/src/components/claude.tsx',
    'src/db/queries.ts',
    'src/graph/traverser.ts',
  ];

  it('resolves a full project-relative path', () => {
    expect(resolveNamedFilePaths(['src/mcp/server-instructions.ts'], PATHS))
      .toEqual(['src/mcp/server-instructions.ts']);
  });

  it('resolves a trailing path fragment', () => {
    expect(resolveNamedFilePaths(['mcp/server-instructions.ts'], PATHS))
      .toEqual(['src/mcp/server-instructions.ts']);
  });

  it('resolves a unique basename carrying its extension', () => {
    // REQ-EXPLORE-PIN-001.A1 via the token form from REQ-EXPLORE-PIN-002.A1.
    expect(resolveNamedFilePaths(['server-instructions.ts'], PATHS))
      .toEqual(['src/mcp/server-instructions.ts']);
  });

  it('resolves a unique bare basename with no extension', () => {
    // REQ-EXPLORE-PIN-002.A2
    expect(resolveNamedFilePaths(['git-hooks'], PATHS))
      .toEqual(['src/sync/git-hooks.ts']);
  });

  it('does not resolve an ambiguous bare basename', () => {
    // `claude` matches both claude.ts and claude.tsx — guessing one would be
    // worse than leaving the ranker to decide, so resolve nothing.
    expect(resolveNamedFilePaths(['claude'], PATHS)).toEqual([]);
  });

  it('still resolves an ambiguous basename when the token disambiguates it', () => {
    expect(resolveNamedFilePaths(['targets/claude.ts'], PATHS))
      .toEqual(['src/installer/targets/claude.ts']);
  });

  it('ignores tokens that match no indexed file', () => {
    // REQ-EXPLORE-PIN-001.A5 — the caller reports the miss; the resolver is
    // simply silent rather than guessing a near-match.
    expect(resolveNamedFilePaths(['does-not-exist.ts', 'nope'], PATHS)).toEqual([]);
  });

  it('ignores ordinary symbol tokens', () => {
    expect(resolveNamedFilePaths(['GraphTraverser', 'handleExplore'], PATHS)).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(resolveNamedFilePaths(['Server-Instructions.TS'], PATHS))
      .toEqual(['src/mcp/server-instructions.ts']);
  });

  it('deduplicates and caps at MAX_PINNED_FILES', () => {
    // REQ-EXPLORE-PIN-001.A3 — a name-heavy query must not consume the whole
    // response, so pinning is bounded.
    expect(MAX_PINNED_FILES).toBe(4);
    const many = resolveNamedFilePaths(
      ['tools.ts', 'git-hooks.ts', 'steering.ts', 'queries.ts', 'traverser.ts', 'tools.ts'],
      PATHS,
    );
    expect(many).toHaveLength(MAX_PINNED_FILES);
    expect(new Set(many).size).toBe(MAX_PINNED_FILES);
  });

  it('preserves query order so the earliest-named file is pinned first', () => {
    expect(resolveNamedFilePaths(['git-hooks.ts', 'tools.ts'], PATHS))
      .toEqual(['src/sync/git-hooks.ts', 'src/mcp/tools.ts']);
  });
});

/**
 * End-to-end exact-name recall (REQ-EXPLORE-PIN-004.A1).
 *
 * The unit tests above pin the filters; this pins the property that actually
 * matters to an agent — naming a target verbatim returns that target. The
 * fixture is deliberately hostile to the ranker: the named files are
 * kebab-case AND call nothing and are called by nothing, so graph connectivity
 * cannot rescue them. Before this fix, all three assertions failed and the
 * agent's only recourse was Grep.
 */
describe('specship_explore exact-name recall', () => {
  let testDir: string;
  let cg: SpecShip;
  let handler: ToolHandler;

  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-named-recall-'));
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    const write = (name: string, body: string) =>
      fs.writeFileSync(path.join(srcDir, name), body.trimStart());

    // A DENSE connected flow of competitors. This is load-bearing: with only a
    // handful of files, FTS returns everything and the test cannot distinguish
    // a seeded file from an incidentally-gathered one. The named targets below
    // must out-compete these for a render slot, which only the named-seed path
    // can achieve.
    write('main.ts', `
import { processRequest } from './stage-01';
import { helperOne } from './helpers';

export function runPipeline(): string {
  return processRequest() + helperOne();
}
`);
    for (let i = 1; i <= 24; i++) {
      const id = String(i).padStart(2, '0');
      const next = String(i + 1).padStart(2, '0');
      const call = i < 24 ? `import { processRequest as next } from './stage-${next}';` : '';
      const body = i < 24 ? 'next()' : `'STAGE_TAIL_MARKER'`;
      write(`stage-${id}.ts`, `
${call}

export interface StageOptions${id} { threshold: number }
export const STAGE_CONFIG_${id} = { retries: ${i} };

export function processRequest(): string {
  const config = STAGE_CONFIG_${id};
  return String(config.retries) + ${body};
}

export function handleResponse(): string {
  return 'stage-${id}';
}
`);
    }
    write('helpers.ts', `
export function helperOne(): string {
  return 'HELPER_BODY_MARKER';
}
`);

    // Kebab-case filename, non-callable kind, ZERO graph connectivity — the
    // exact shape that used to be unreachable by name.
    write('steer-config.ts', `
export const STEER_HOOK_COMMANDS = ['steer-nudge', 'spec-nudge'];
`);

    // Kebab-case filename holding only type-ish kinds, also disconnected.
    write('retrieval-gate.ts', `
export interface GateOptions {
  threshold: number;
}

export type GateMode = 'strict' | 'lenient';
`);

    // A file whose path matches the low-value heuristic (`\bicons?\b`) —
    // ordinarily hard-excluded from explore output. Naming it must bypass
    // that exclusion (REQ-EXPLORE-PIN-001.A2). The path deliberately avoids
    // "test"/"spec" words, which would soften the exclusion via
    // queryMentionsTests and let the assertion pass for the wrong reason.
    fs.mkdirSync(path.join(srcDir, 'icons'));
    fs.writeFileSync(path.join(srcDir, 'icons', 'pin-target.ts'), `
export const ICON_PIN_MARKER = 'low-value-but-named';
`.trimStart());

    // Four files big enough that rendering all of them in full would blow the
    // output budget (~7K chars each vs a 13K tier cap), with functions spaced
    // past the cluster gap threshold so per-file sectioning stays granular
    // (REQ-EXPLORE-PIN-001.A4).
    for (let f = 1; f <= 4; f++) {
      const chunks: string[] = [];
      for (let i = 0; i < 15; i++) {
        chunks.push(`
export function bigWorker${f}x${i}(input: string): string {
  const prefix = 'file-${f}-fn-${i}';
  const doubled = input + input;
  const upper = doubled.toUpperCase();
  const lower = doubled.toLowerCase();
  const mixed = upper + lower + prefix;
  const trimmed = mixed.trim();
  const padded = trimmed.padEnd(80, '.');
  return padded.slice(0, 64);
}
${Array.from({ length: 9 }, (_, k) => `// spacer ${k} keeps clusters apart`).join('\n')}
`);
      }
      write(`big-0${f}.ts`, chunks.join('\n'));
    }

    cg = SpecShip.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterAll(() => {
    if (cg) cg.destroy();
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Each query names its target alongside terms that match the 24-file
  // connected stage flow, and leaves `maxFiles` at the tier default so slots
  // are genuinely scarce. Without named seeding the flow wins every slot and
  // the named target is absent — which is the failure being guarded.
  const COMPETITORS = 'processRequest handleResponse StageOptions01 STAGE_CONFIG_01';

  const sectionPaths = (text: string) =>
    text.split('\n').filter((l) => l.startsWith('#### '));

  it('returns a kebab-case file named with its extension', async () => {
    // REQ-EXPLORE-PIN-002.A1
    const result = await handler.execute('specship_explore', {
      query: `steer-config.ts ${COMPETITORS}`,
    });
    const text = result.content?.[0]?.text ?? '';
    expect(sectionPaths(text).join('\n')).toContain('steer-config.ts');
    expect(text).toContain('STEER_HOOK_COMMANDS');
  });

  it('returns a kebab-case file named by bare basename', async () => {
    // REQ-EXPLORE-PIN-002.A2
    const result = await handler.execute('specship_explore', {
      query: `retrieval-gate ${COMPETITORS}`,
    });
    const text = result.content?.[0]?.text ?? '';
    expect(sectionPaths(text).join('\n')).toContain('retrieval-gate.ts');
  });

  it('returns a named constant that nothing calls', async () => {
    // REQ-EXPLORE-PIN-003.A1 — a constant is not callable, so the old
    // CALLABLE filter dropped it and the file never entered the subgraph.
    const result = await handler.execute('specship_explore', {
      query: `STEER_HOOK_COMMANDS ${COMPETITORS}`,
    });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('STEER_HOOK_COMMANDS');
    expect(sectionPaths(text).join('\n')).toContain('steer-config.ts');
  });

  it('returns a named interface and type alias', async () => {
    // REQ-EXPLORE-PIN-003.A2
    const result = await handler.execute('specship_explore', {
      query: `GateOptions GateMode ${COMPETITORS}`,
    });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('GateOptions');
    expect(sectionPaths(text).join('\n')).toContain('retrieval-gate.ts');
  });

  it('returns a named file whose path matches a low-value pattern', async () => {
    // REQ-EXPLORE-PIN-001.A2 — src/icons/ trips the low-value hard exclusion;
    // naming the file must bypass it.
    const result = await handler.execute('specship_explore', {
      query: `icons/pin-target.ts ${COMPETITORS}`,
    });
    const text = result.content?.[0]?.text ?? '';
    expect(sectionPaths(text).join('\n')).toContain('icons/pin-target.ts');
    expect(text).toContain('ICON_PIN_MARKER');
  });

  it('pins at least 4 of 6 named files and reports the omitted ones', async () => {
    // REQ-EXPLORE-PIN-001.A3
    const named = [
      'stage-01.ts', 'stage-02.ts', 'stage-03.ts',
      'steer-config.ts', 'retrieval-gate.ts', 'helpers.ts',
    ];
    const result = await handler.execute('specship_explore', {
      query: named.join(' '),
    });
    const text = result.content?.[0]?.text ?? '';
    const sections = sectionPaths(text).join('\n');
    const returned = named.filter((n) => sections.includes(n));
    expect(returned.length).toBeGreaterThanOrEqual(4);
    expect(text).toContain('Named files omitted for budget');
    for (const n of named) {
      // Every named file is either in a source section or named in the
      // omitted note — never silently dropped.
      expect(sections.includes(n) || text.split('omitted for budget')[1]!.includes(n),
        `${n} should be rendered or reported omitted`).toBe(true);
    }
  });

  it('keeps a 4-large-file pin within the resolved output budget', async () => {
    // REQ-EXPLORE-PIN-001.A4 — pinning displaces ranked files, never raises
    // the cap. The four files total ~28K raw, far past the tier budget.
    const result = await handler.execute('specship_explore', {
      query: 'big-01.ts big-02.ts big-03.ts big-04.ts',
    });
    const text = result.content?.[0]?.text ?? '';
    const budget = getExploreOutputBudget(cg.getStats().fileCount);
    expect(text.length).toBeLessThanOrEqual(budget.maxOutputChars * 1.1);
    // Presence is still guaranteed: each pinned file appears, sectioned down
    // rather than dropped.
    const sections = sectionPaths(text).join('\n');
    for (const f of ['big-01.ts', 'big-02.ts', 'big-03.ts', 'big-04.ts']) {
      expect(sections, `${f} should be present`).toContain(f);
    }
  });

  it('states when a named path is not in the index', async () => {
    // REQ-EXPLORE-PIN-001.A5 — the miss is reported, not swallowed, and the
    // exploration still answers normally.
    const result = await handler.execute('specship_explore', {
      query: 'does-not-exist.ts processRequest handleResponse',
    });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('not found in the index');
    expect(text).toContain('does-not-exist.ts');
    expect(text).toContain('### Source Code');
  });

  it('still answers a plain connected-flow question', async () => {
    // Guard the other direction: widening the filters must not displace the
    // ordinary case the ranker already handled well.
    const result = await handler.execute('specship_explore', {
      query: 'runPipeline helperOne',
    });
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('runPipeline');
    expect(text).toContain('HELPER_BODY_MARKER');
  });
});
