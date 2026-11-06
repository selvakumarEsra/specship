/**
 * REQ-LINKACC-002 — code drift MUST say what changed.
 *
 * The classifier is exercised directly (pure, deterministic) and through the
 * resolver against a real SQLite index, so the kind is proven to land on the
 * stored link and on every surface that prints a drifted link.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { Node, NodeKind, SpecLink } from '../src/types';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';
import {
  classifySignatureDrift,
  parseSignature,
  formatDriftedLine,
} from '../src/resolution/signature-drift';
import { formatLink } from '../src/mcp/spec-tools';

const fts5Available = (() => {
  for (const probe of [
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      return new Database(':memory:');
    },
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(':memory:');
    },
  ]) {
    try {
      const db = probe();
      try {
        db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
        return true;
      } catch {
        /* no fts5 on this backend */
      } finally {
        db.close();
      }
    } catch {
      /* backend unavailable */
    }
  }
  return false;
})();

function makeNode(filePath: string, qualifiedName: string, kind: NodeKind, signature?: string, language = 'typescript'): Node {
  return {
    id: generateNodeId(filePath, kind, qualifiedName, 1),
    kind,
    name: qualifiedName.split('.').pop()!,
    qualifiedName,
    filePath,
    language: language as Node['language'],
    startLine: 1,
    endLine: 6,
    startColumn: 0,
    endColumn: 0,
    signature,
    updatedAt: Date.now(),
  };
}

type Harness = {
  cg: SpecShip;
  seed: (opts: { specId: string; qname: string; baseline: string | undefined; current: string | undefined }) => number;
};

/** Seed a spec + linked node, swap the node's signature, run the resolver. */
function harness(cg: SpecShip): Harness {
  const sq = cg.getSpecQueries();
  const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
  return {
    cg,
    seed({ specId, qname, baseline, current }) {
      const now = Date.now();
      const file = `src/${qname}.ts`;
      sq.insertSpec({
        id: specId, kind: 'requirement', title: 'X', body: 'b', format: 'markdown',
        sourcePath: 'specs/x.md', contentHash: 'h', createdAt: now, updatedAt: now,
      });
      const v1 = makeNode(file, qname, 'function', baseline);
      queries.insertNode(v1);
      const id = sq.upsertSpecLink({
        specId, targetFilePath: file, targetQualifiedName: qname, targetNodeKind: 'function',
        resolvedNodeId: v1.id, kind: 'implements', state: 'implemented', driftAxis: null,
        specHashAtLink: 'h', nodeSigAtLink: baseline, provenance: 'agent-asserted',
        confidence: 1.0, createdAt: now, updatedAt: now,
      });
      queries.deleteNodesByFile(file);
      queries.insertNode(makeNode(file, qname, 'function', current));
      cg.getSpecLinkResolver().resolveLinksForFiles([file]);
      return id;
    },
  };
}

// ---------------------------------------------------------------------------
// A1 — a parameter rename is `rename-only`
// ---------------------------------------------------------------------------

function reqLinkacc002A1Classifier(): void {
  expect(classifySignatureDrift('(installClaude: boolean)', '(hasStatusLine: boolean)')).toBe('rename-only');
  expect(classifySignatureDrift('(installClaude: boolean): void', '(hasStatusLine: boolean): void')).toBe('rename-only');
  // Other host shapes the extractors store.
  expect(classifySignatureDrift('(a, b: int = 1) -> str', '(x, b: int = 1) -> str', 'python')).toBe('rename-only');
  expect(classifySignatureDrift('(a int, b string) error', '(x int, b string) error', 'go')).toBe('rename-only');
  expect(classifySignatureDrift('(int a, const char *b)', '(int a, const char *name)', 'c')).toBe('rename-only');
}

describe('REQ-LINKACC-002 signature drift classifier', () => {
  it('REQ-LINKACC-002.A1 renaming installClaude: boolean to hasStatusLine: boolean is rename-only', reqLinkacc002A1Classifier);
  it('REQ-LINKACC-002.A2 a type, return-type or arity change is type-change or shape-change', reqLinkacc002A2);
  it('REQ-LINKACC-002.A3 a missing baseline or unparseable signature is unclassified, never rename-only', reqLinkacc002A3);
});

// ---------------------------------------------------------------------------
// A2 — type changes and shape changes
// ---------------------------------------------------------------------------

function reqLinkacc002A2(): void {
  // Parameter type.
  expect(classifySignatureDrift('(installClaude: boolean)', '(installClaude: string)')).toBe('type-change');
  // Return type.
  expect(classifySignatureDrift('(a: number): void', '(a: number): Promise<void>')).toBe('type-change');
  expect(classifySignatureDrift('(a: number)', '(a: number): string')).toBe('type-change');
  // Rename AND type change together is still a type change, not a rename.
  expect(classifySignatureDrift('(a: number)', '(b: string)')).toBe('type-change');
  // Go result type.
  expect(classifySignatureDrift('(a int) error', '(a int) (int, error)', 'go')).toBe('type-change');
  // Added / removed parameters.
  expect(classifySignatureDrift('(a: number)', '(a: number, b: number)')).toBe('shape-change');
  expect(classifySignatureDrift('(a: number, b: number)', '(a: number)')).toBe('shape-change');
  expect(classifySignatureDrift('()', '(a: number)')).toBe('shape-change');
  // Neither rename nor type change: optional marker / default value differs.
  expect(classifySignatureDrift('(a: number)', '(a?: number)')).toBe('shape-change');
  expect(classifySignatureDrift('(a: number = 1)', '(a: number = 2)')).toBe('shape-change');
  // Generic commas don't split parameters.
  expect(parseSignature('(m: Map<string, number>, f: (x: A, y: B) => C)')?.params).toHaveLength(2);
}

// ---------------------------------------------------------------------------
// A3 — no baseline / unparseable is unclassified (property-based)
// ---------------------------------------------------------------------------

/** A well-formed TS signature: `(p0: T0, …): R`. */
const validSignature = fc
  .tuple(
    fc.array(fc.tuple(fc.constantFrom('a', 'b', 'opts', 'id', 'hasStatusLine'), fc.constantFrom('number', 'string', 'boolean', 'Foo<Bar>')), { maxLength: 4 }),
    fc.constantFrom('', ': void', ': string', ': Promise<number>')
  )
  .map(([params, ret]) => `(${params.map(([n, t], i) => `${n}${i}: ${t}`).join(', ')})${ret}`);

/** No baseline at all. */
const missing = fc.constantFrom<string | null | undefined>(undefined, null, '', '   ', '\n\t');

/** Text that is not a parseable signature: no parameter list, or unbalanced brackets. */
const unparseable = fc.oneof(
  fc.string().filter((s) => !s.includes('(')),
  fc.string().map((s) => `(${s.replace(/[()]/g, '')}`), // never closed
  validSignature.map((s) => s.replace(/\)/, '>)')), // stray closer inside the list
  validSignature.map((s) => `${s}]`) // unbalanced tail
);

function reqLinkacc002A3(): void {
  fc.assert(
    fc.property(missing, validSignature, (base, cur) => {
      expect(classifySignatureDrift(base, cur)).toBe('unclassified');
      expect(classifySignatureDrift(cur, base)).toBe('unclassified');
    }),
    { seed: 2002, numRuns: 200 }
  );
  fc.assert(
    fc.property(unparseable, validSignature, (bad, good) => {
      expect(parseSignature(bad)).toBeNull();
      const kind = classifySignatureDrift(bad, good);
      expect(kind).toBe('unclassified');
      expect(kind).not.toBe('rename-only');
      expect(classifySignatureDrift(good, bad)).toBe('unclassified');
    }),
    { seed: 2003, numRuns: 300 }
  );
  // A token-only parameter whose name position the language can't settle.
  expect(classifySignatureDrift('(int a)', '(int b)')).toBe('unclassified');
}

// ---------------------------------------------------------------------------
// Resolver + surfaces (real SQLite)
// ---------------------------------------------------------------------------

describe.skipIf(!fts5Available)('REQ-LINKACC-002 drift kind on stored links', () => {
  let dir: string;
  let h: Harness;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sigdrift-'));
    h = harness(await SpecShip.init(dir));
  });
  afterEach(() => {
    h?.cg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function reqLinkacc002A1(): void {
    const id = h.seed({ specId: 'REQ-R-1', qname: 'install', baseline: '(installClaude: boolean): void', current: '(hasStatusLine: boolean): void' });
    const link = h.cg.getSpecQueries().getLinkById(id)!;
    expect(link.state).toBe('drifted');
    expect(link.driftAxis).toBe('code');
    expect(link.driftKind).toBe('rename-only');
  }

  function reqLinkacc002A2Stored(): void {
    const sq = h.cg.getSpecQueries();
    const t = h.seed({ specId: 'REQ-R-2', qname: 'typed', baseline: '(a: number)', current: '(a: string)' });
    const s = h.seed({ specId: 'REQ-R-3', qname: 'shaped', baseline: '(a: number)', current: '(a: number, b: number)' });
    expect(sq.getLinkById(t)!.driftKind).toBe('type-change');
    expect(sq.getLinkById(s)!.driftKind).toBe('shape-change');
  }

  function reqLinkacc002A3Resolver(): void {
    const sq = h.cg.getSpecQueries();
    // No signature baseline (file-level / test-title links): the link does
    // NOT start drifting at all.
    const noBase = h.seed({ specId: 'REQ-R-4', qname: 'nobase', baseline: undefined, current: '(a: number)' });
    const nb = sq.getLinkById(noBase)!;
    expect(nb.state).toBe('implemented');
    expect(nb.driftKind ?? null).toBeNull();
    // A drift whose signature can't be parsed is unclassified, never rename-only.
    const bad = h.seed({ specId: 'REQ-R-5', qname: 'bad', baseline: '(a: number', current: '(b: number)' });
    const bl = sq.getLinkById(bad)!;
    expect(bl.state).toBe('drifted');
    expect(bl.driftKind).toBe('unclassified');
  }

  function reqLinkacc002A4(): void {
    const sq = h.cg.getSpecQueries();
    const id = h.seed({ specId: 'REQ-R-6', qname: 'shown', baseline: '(installClaude: boolean)', current: '(hasStatusLine: boolean)' });
    const link = sq.getLinkById(id)!;
    // `specship drifted`
    expect(formatDriftedLine(link)).toBe(
      `#${id} [drifted [drift=code kind=rename-only]] REQ-R-6 → src/shown.ts:shown <agent-asserted>`
    );
    // `specship_spec` linked-code lines
    expect(formatLink(link)).toContain('[drifted [drift=code kind=rename-only]]');
    // A drift with no kind keeps the old label.
    const spec: SpecLink = { ...link, driftAxis: 'spec', driftKind: null };
    expect(formatLink(spec)).toContain('[drifted [drift=spec]]');
    expect(formatDriftedLine(spec)).not.toContain('kind=');
  }

  function reqLinkacc002A5(): void {
    const sq = h.cg.getSpecQueries();
    const id = h.seed({ specId: 'REQ-R-7', qname: 'stays', baseline: '(installClaude: boolean)', current: '(hasStatusLine: boolean)' });
    // A second resolve pass over the same rename keeps it drifted.
    h.cg.getSpecLinkResolver().resolveLinksForFiles(['src/stays.ts']);
    const link = sq.getLinkById(id)!;
    expect(link.driftKind).toBe('rename-only');
    expect(link.state).toBe('drifted');
    expect(link.state).not.toBe('verified');
    expect(link.driftAxis).toBe('code');
    // The kind is cleared, never left behind, when the state moves on.
    sq.updateSpecLinkState(id, 'implemented', null, Date.now(), 'rename-only');
    expect(sq.getLinkById(id)!.driftKind ?? null).toBeNull();
  }

  it('REQ-LINKACC-002.A1 a resolved parameter rename stores kind rename-only', reqLinkacc002A1);
  it('REQ-LINKACC-002.A2 type and shape changes store their kind', reqLinkacc002A2Stored);
  it('REQ-LINKACC-002.A3 a no-baseline link stays put; an unparseable drift stores unclassified', reqLinkacc002A3Resolver);
  it('REQ-LINKACC-002.A4 specship drifted and specship_spec print the kind', reqLinkacc002A4);
  it('REQ-LINKACC-002.A5 recording rename-only leaves the link drifted and unpromoted', reqLinkacc002A5);
});
