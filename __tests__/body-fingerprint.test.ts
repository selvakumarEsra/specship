/**
 * REQ-LINKACC-004 — a change to a linked symbol's body is flagged without
 * changing the link's state.
 *
 * The normalizer is exercised directly (pure), and the marker end to end
 * against a real SQLite index plus real files on disk: the resolver reads the
 * symbol's lines, so each test edits the file the way a developer would.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { Node, NodeKind, SpecLinkState } from '../src/types';
import type { QueryBuilder } from '../src/db/queries';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';
import { fingerprintBody, stripCommentsAndWhitespace } from '../src/resolution/body-fingerprint';
import { formatLink, handleSpecshipLinkVerify } from '../src/mcp/spec-tools';
import { computeSpecCoverage } from '../src/graph/spec-coverage';

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

const TS_V1 = `export function total(items: number[]): number {
  let sum = 0;
  for (const i of items) sum += i;
  return sum;
}
`;

/** One statement changed; signature identical. */
const TS_BODY_CHANGED = `export function total(items: number[]): number {
  let sum = 1;
  for (const i of items) sum += i;
  return sum;
}
`;

/** Re-indented (4 spaces), blank line added. */
const TS_REINDENTED = `export function total(items: number[]): number {
    let sum = 0;

    for (const i of items) sum += i;
    return sum;
}
`;

/** Only comments added / edited. */
const TS_COMMENTED = `export function total(items: number[]): number {
  // start from zero
  let sum = 0; /* running total */
  for (const i of items) sum += i; // add each
  return sum;
}
`;

const SIG = '(items: number[]): number';

type Fixture = {
  cg: SpecShip;
  dir: string;
  queries: QueryBuilder;
  /** Seed spec + node + link at `state`, with the file written as `source`. */
  seed: (opts: { source: string; state: SpecLinkState; file?: string; language?: string }) => number;
  /** Rewrite the linked file and run the resolver over it. */
  edit: (source: string) => ReturnType<ReturnType<SpecShip['getSpecLinkResolver']>['resolveLinksForFiles']>;
};

function makeNode(filePath: string, qualifiedName: string, kind: NodeKind, source: string, language: string): Node {
  return {
    id: generateNodeId(filePath, kind, qualifiedName, 1),
    kind,
    name: qualifiedName,
    qualifiedName,
    filePath,
    language: language as Node['language'],
    startLine: 1,
    endLine: source.split('\n').filter((_, i, a) => i < a.length - 1 || a[i] !== '').length,
    startColumn: 0,
    endColumn: 0,
    signature: SIG,
    updatedAt: Date.now(),
  };
}

function fixture(cg: SpecShip, dir: string): Fixture {
  const sq = cg.getSpecQueries();
  const queries = (cg as unknown as { queries: QueryBuilder }).queries;
  let file = 'src/total.ts';
  let language = 'typescript';
  const write = (source: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), source);
    queries.deleteNodesByFile(file);
    queries.insertNode(makeNode(file, 'total', 'function', source, language));
  };
  return {
    cg,
    dir,
    queries,
    seed({ source, state, file: f, language: lang }) {
      if (f) file = f;
      if (lang) language = lang;
      const now = Date.now();
      sq.insertSpec({
        id: 'REQ-BF-001', kind: 'requirement', title: 'Total', body: 'b', format: 'markdown',
        sourcePath: 'specs/bf.md', contentHash: 'h', createdAt: now, updatedAt: now,
      });
      write(source);
      const node = makeNode(file, 'total', 'function', source, language);
      const id = sq.upsertSpecLink({
        specId: 'REQ-BF-001', targetFilePath: file, targetQualifiedName: 'total', targetNodeKind: 'function',
        resolvedNodeId: node.id, kind: 'implements', state: 'implemented', driftAxis: null,
        specHashAtLink: 'h', nodeSigAtLink: SIG, provenance: 'agent-asserted',
        confidence: 1.0, createdAt: now, updatedAt: now,
      });
      // First pass takes the body baseline silently (no marker).
      cg.getSpecLinkResolver().resolveLinksForFiles([file]);
      if (state !== 'implemented') sq.updateSpecLinkState(id, state, null, now);
      return id;
    },
    edit(source: string) {
      write(source);
      return cg.getSpecLinkResolver().resolveLinksForFiles([file]);
    },
  };
}

// ---------------------------------------------------------------------------
// A2 — the normalizer (pure)
// ---------------------------------------------------------------------------

function reqLinkacc004A2Normalizer(): void {
  const base = fingerprintBody(TS_V1, 'typescript');
  expect(fingerprintBody(TS_REINDENTED, 'typescript')).toBe(base);
  expect(fingerprintBody(TS_COMMENTED, 'typescript')).toBe(base);
  expect(fingerprintBody(TS_BODY_CHANGED, 'typescript')).not.toBe(base);

  // A `//` inside a string literal is code, not a comment.
  const url = `function u() { return "http://a"; }`;
  expect(fingerprintBody(url, 'typescript')).not.toBe(fingerprintBody(`function u() { return "http://b"; }`, 'typescript'));
  expect(stripCommentsAndWhitespace(url, 'typescript')).toContain('"http://a"');
  // Whitespace inside a string is significant.
  expect(fingerprintBody(`f("a b")`, 'typescript')).not.toBe(fingerprintBody(`f("ab")`, 'typescript'));

  // Python: `#` comments and a uniform re-indent are ignored …
  const py = `def total(items):\n    s = 0\n    for i in items:\n        s += i\n    return s\n`;
  const pyReindent = `def total(items):\n  s = 0  # start\n  for i in items:\n    s += i\n  return s\n`;
  expect(fingerprintBody(pyReindent, 'python')).toBe(fingerprintBody(py, 'python'));
  // … but moving a statement out of a block is a real change.
  const pyMoved = `def total(items):\n    s = 0\n    for i in items:\n        s += i\n        return s\n`;
  expect(fingerprintBody(pyMoved, 'python')).not.toBe(fingerprintBody(py, 'python'));
  // `#` inside a Python string is code.
  expect(fingerprintBody(`x = "#a"`, 'python')).not.toBe(fingerprintBody(`x = "#b"`, 'python'));
}

// ---------------------------------------------------------------------------
// Unknown language: whitespace only, comment syntax never guessed
// ---------------------------------------------------------------------------

function reqLinkacc004UnknownLanguage(): void {
  const lua = `function total(t)\n  local s = 0 -- start\n  return s\nend\n`;
  // Whitespace is still collapsed …
  expect(fingerprintBody(lua.replace(/\n  /g, '\n      '), 'lua')).toBe(fingerprintBody(lua, 'lua'));
  // … but `--` is not treated as a comment, and neither is `//` or `#`.
  expect(fingerprintBody(lua.replace('-- start', '-- begin'), 'lua')).not.toBe(fingerprintBody(lua, 'lua'));
  expect(stripCommentsAndWhitespace('a // b # c', 'lua')).toBe('a // b # c');
}

describe('REQ-LINKACC-004 body normalizer', () => {
  it('REQ-LINKACC-004.A2: re-indenting or comment-only edits leave the fingerprint unchanged; strings stay code', reqLinkacc004A2Normalizer);
  it('REQ-LINKACC-004: an unknown language collapses whitespace only and never guesses comment syntax', reqLinkacc004UnknownLanguage);
});

// ---------------------------------------------------------------------------
// The marker end to end
// ---------------------------------------------------------------------------

describe.skipIf(!fts5Available)('REQ-LINKACC-004 body-changed marker', () => {
  let dir: string;
  let f: Fixture;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bodyfp-'));
    f = fixture(await SpecShip.init(dir), dir);
  });
  afterEach(() => {
    f?.cg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const link = (id: number) => f.cg.getSpecQueries().getLinkById(id)!;

  async function reqLinkacc004A1(): Promise<void> {
    const id = f.seed({ source: TS_V1, state: 'verified' });
    expect(link(id).metadata?.bodyFpAtLink).toBe(fingerprintBody(TS_V1, 'typescript'));
    expect(link(id).metadata?.bodyChanged).toBeUndefined();

    f.edit(TS_BODY_CHANGED);
    const l = link(id);
    expect(l.state).toBe('verified');
    expect(l.metadata?.bodyChanged).toMatchObject({ since: 'verified' });
    expect(formatLink(l)).toContain('body changed since verified');

    // A second pass keeps the first marker.
    const at = (l.metadata?.bodyChanged as { at: number }).at;
    f.edit(TS_BODY_CHANGED);
    expect((link(id).metadata?.bodyChanged as { at: number }).at).toBe(at);

    // The coverage rollup Review reads carries the same marker.
    const req = computeSpecCoverage(f.cg.getSpecQueries(), 'REQ-BF-001').requirements[0]!;
    expect(req.implementsLinks.bodyChanged).toEqual({ verified: 1 });

    // Reverting the edit drops the marker.
    f.edit(TS_V1);
    expect(link(id).metadata?.bodyChanged).toBeUndefined();
  }

  async function reqLinkacc004A1Implemented(): Promise<void> {
    const id = f.seed({ source: TS_V1, state: 'implemented' });
    f.edit(TS_BODY_CHANGED);
    const l = link(id);
    expect(l.state).toBe('implemented');
    expect(formatLink(l)).toContain('body changed since implemented');
    const req = computeSpecCoverage(f.cg.getSpecQueries(), 'REQ-BF-001').requirements[0]!;
    expect(req.implementsLinks.bodyChanged).toEqual({ implemented: 1 });
  }

  async function reqLinkacc004A2(): Promise<void> {
    const id = f.seed({ source: TS_V1, state: 'verified' });
    f.edit(TS_REINDENTED);
    expect(link(id).metadata?.bodyChanged).toBeUndefined();
    f.edit(TS_COMMENTED);
    expect(link(id).metadata?.bodyChanged).toBeUndefined();
    expect(formatLink(link(id))).not.toContain('body changed');
  }

  async function reqLinkacc004A2Python(): Promise<void> {
    const py = `def total(items):\n    s = 0\n    return s\n`;
    const id = f.seed({ source: py, state: 'verified', file: 'src/total.py', language: 'python' });
    f.edit(`def total(items):\n  s = 0  # zero\n  return s\n`);
    expect(link(id).metadata?.bodyChanged).toBeUndefined();
    f.edit(`def total(items):\n    s = 1\n    return s\n`);
    expect(link(id).metadata?.bodyChanged).toMatchObject({ since: 'verified' });
  }

  async function reqLinkacc004UnknownLanguageMarked(): Promise<void> {
    const lua = `function total(t)\n  local s = 0\n  return s\nend\n`;
    const id = f.seed({ source: lua, state: 'verified', file: 'src/total.lua', language: 'lua' });
    f.edit(`function total(t)\n  local s = 1\n  return s\nend\n`);
    expect(link(id).state).toBe('verified');
    expect(link(id).metadata?.bodyChanged).toMatchObject({ since: 'verified' });
  }

  async function reqLinkacc004A3(): Promise<void> {
    const id = f.seed({ source: TS_V1, state: 'implemented' });
    // File-derived test evidence, so the verify gate lets the pass through.
    const now = Date.now();
    f.cg.getSpecQueries().upsertSpecLink({
      specId: 'REQ-BF-001', targetFilePath: '__tests__/total.test.ts', targetQualifiedName: 'totalWorks',
      targetNodeKind: 'function', kind: 'tests', state: 'verified', driftAxis: null,
      specHashAtLink: 'h', provenance: 'spec-declaration', confidence: 0.7, createdAt: now, updatedAt: now,
    });
    f.edit(TS_BODY_CHANGED);
    expect(link(id).metadata?.bodyChanged).toBeDefined();

    const res = await handleSpecshipLinkVerify(f.cg, { link_id: id, result: 'pass', reason: 'reviewed' });
    expect(JSON.stringify(res)).toContain('verified');
    const l = link(id);
    expect(l.state).toBe('verified');
    expect(l.metadata?.bodyChanged).toBeUndefined();
    expect(l.metadata?.bodyFpAtLink).toBe(fingerprintBody(TS_BODY_CHANGED, 'typescript'));
    expect(formatLink(l)).not.toContain('body changed');

    // The new baseline holds: the next pass over the same body sets nothing.
    f.edit(TS_BODY_CHANGED);
    expect(link(id).metadata?.bodyChanged).toBeUndefined();
  }

  async function reqLinkacc004A4(): Promise<void> {
    const id = f.seed({ source: TS_V1, state: 'verified' });
    const stats = f.edit(TS_BODY_CHANGED);
    expect(stats.driftedCode).toBe(0);
    expect(stats.transitions).toEqual([]);
    const l = link(id);
    expect(l.state).toBe('verified');
    expect(l.driftAxis ?? null).toBeNull();
    expect(f.cg.getSpecQueries().getLinksByState(['drifted', 'broken', 'orphaned'])).toEqual([]);
  }

  it('REQ-LINKACC-004.A1: one changed statement keeps the link verified and shows "body changed since verified"', reqLinkacc004A1);
  it('REQ-LINKACC-004.A1: an implemented link gets the marker too, labelled "since implemented"', reqLinkacc004A1Implemented);
  it('REQ-LINKACC-004.A2: re-indenting or a comment-only edit sets no marker', reqLinkacc004A2);
  it('REQ-LINKACC-004.A2: Python # comments and re-indent set no marker; a statement change does', reqLinkacc004A2Python);
  it('REQ-LINKACC-004: an unknown-language body change is still marked', reqLinkacc004UnknownLanguageMarked);
  it('REQ-LINKACC-004.A3: verifying the link again takes a new baseline and removes the marker', reqLinkacc004A3);
  it('REQ-LINKACC-004.A4: a body-only change creates no drift-queue entry', reqLinkacc004A4);
});
