/**
 * SpecLinkResolver refactor-scenario tests.
 *
 * These are the load-bearing assertions for Q3 of the design grill: the
 * link layer survives the code refactors that would orphan a node-id-keyed
 * design.
 *
 * Skipped on environments without FTS5 in the system SQLite (pre-existing
 * issue on `main` — same skip pattern as the existing sqlite-backend tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { Node, NodeKind } from '../src/types';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-link-resolver-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/** Insert a node directly into the DB (faster than running an extractor). */
function makeNode(
  filePath: string,
  qualifiedName: string,
  kind: NodeKind,
  line: number,
  signature?: string
): Node {
  const id = generateNodeId(filePath, kind, qualifiedName, line);
  return {
    id,
    kind,
    name: qualifiedName.split('.').pop()!,
    qualifiedName,
    filePath,
    language: 'typescript',
    startLine: line,
    endLine: line + 5,
    startColumn: 0,
    endColumn: 0,
    signature,
    updatedAt: Date.now(),
  };
}

/**
 * Synchronously probe whether the current process has FTS5 available.
 * We check both `better-sqlite3` (preferred dev backend) and `node:sqlite`
 * (production backend) and pass if either supports FTS5.
 */
const fts5Available = (() => {
  // Try better-sqlite3 first — when installed it ships its own SQLite
  // with FTS5, which is the dev / contributor path.
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

describe.skipIf(!fts5Available)('SpecLinkResolver refactor scenarios', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
  });

  afterEach(async () => {
    cg?.close();
    clean(dir);
  });

  it('verified link stays verified when only line shifts (signature unchanged)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const now = Date.now();

    // Spec
    sq.insertSpec({
      id: 'REQ-1',
      kind: 'requirement',
      title: 'Demo',
      body: 'body',
      format: 'markdown',
      sourcePath: 'specs/demo.md',
      contentHash: 'hash1',
      createdAt: now,
      updatedAt: now,
    });

    // Code node v1 at line 10.
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const v1 = makeNode('src/auth.ts', 'authenticate', 'function', 10, 'auth(user)');
    queries.insertNode(v1);

    // Link asserted.
    const linkId = sq.upsertSpecLink({
      specId: 'REQ-1',
      targetFilePath: 'src/auth.ts',
      targetQualifiedName: 'authenticate',
      targetNodeKind: 'function',
      resolvedNodeId: v1.id,
      kind: 'implements',
      state: 'verified',
      driftAxis: null,
      specHashAtLink: 'hash1',
      nodeSigAtLink: 'auth(user)',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    // Simulate re-extract: delete v1, insert v2 with same signature, different line.
    queries.deleteNodesByFile('src/auth.ts');
    const v2 = makeNode('src/auth.ts', 'authenticate', 'function', 25, 'auth(user)');
    queries.insertNode(v2);

    resolver.resolveLinksForFiles(['src/auth.ts']);

    const link = sq.getLinkById(linkId)!;
    expect(link.resolvedNodeId).toBe(v2.id);
    expect(link.state).toBe('verified'); // sticky — verified survives
  });

  it('signature change flips link to drifted(code)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    sq.insertSpec({
      id: 'REQ-2',
      kind: 'requirement',
      title: 'X',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/x.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });

    const v1 = makeNode('src/x.ts', 'foo', 'function', 1, 'foo(a)');
    queries.insertNode(v1);

    const linkId = sq.upsertSpecLink({
      specId: 'REQ-2',
      targetFilePath: 'src/x.ts',
      targetQualifiedName: 'foo',
      targetNodeKind: 'function',
      resolvedNodeId: v1.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: 'foo(a)',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    // Signature change.
    queries.deleteNodesByFile('src/x.ts');
    const v2 = makeNode('src/x.ts', 'foo', 'function', 1, 'foo(a, b)');
    queries.insertNode(v2);

    resolver.resolveLinksForFiles(['src/x.ts']);

    const link = sq.getLinkById(linkId)!;
    expect(link.state).toBe('drifted');
    expect(link.driftAxis).toBe('code');
  });

  it('symbol rename orphans the link', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    sq.insertSpec({
      id: 'REQ-3',
      kind: 'requirement',
      title: 'X',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/x.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });

    const v1 = makeNode('src/y.ts', 'authenticate', 'function', 1, 'auth()');
    queries.insertNode(v1);

    const linkId = sq.upsertSpecLink({
      specId: 'REQ-3',
      targetFilePath: 'src/y.ts',
      targetQualifiedName: 'authenticate',
      targetNodeKind: 'function',
      resolvedNodeId: v1.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: 'auth()',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    // Rename: authenticate → authenticateUser
    queries.deleteNodesByFile('src/y.ts');
    queries.insertNode(makeNode('src/y.ts', 'authenticateUser', 'function', 1, 'auth()'));

    resolver.resolveLinksForFiles(['src/y.ts']);

    const link = sq.getLinkById(linkId)!;
    expect(link.state).toBe('orphaned');
    expect(link.resolvedNodeId).toBeUndefined();
  });

  it('spec hash change flips link to drifted(spec)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    sq.insertSpec({
      id: 'REQ-4',
      kind: 'requirement',
      title: 'X',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/x.md',
      contentHash: 'h1',
      createdAt: now,
      updatedAt: now,
    });
    const v1 = makeNode('src/z.ts', 'doit', 'function', 1, 'doit()');
    queries.insertNode(v1);
    const linkId = sq.upsertSpecLink({
      specId: 'REQ-4',
      targetFilePath: 'src/z.ts',
      targetQualifiedName: 'doit',
      targetNodeKind: 'function',
      resolvedNodeId: v1.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h1',
      nodeSigAtLink: 'doit()',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const flipped = resolver.markSpecDrifted('REQ-4', 'h2-new');
    expect(flipped).toBe(1);
    const link = sq.getLinkById(linkId)!;
    expect(link.state).toBe('drifted');
    expect(link.driftAxis).toBe('spec');
  });

  it('cascades spec_links when spec deleted', () => {
    const sq = cg.getSpecQueries();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    sq.insertSpec({
      id: 'REQ-5',
      kind: 'requirement',
      title: 'X',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/dead.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    const v1 = makeNode('src/x.ts', 'g', 'function', 1, 'g()');
    queries.insertNode(v1);
    sq.upsertSpecLink({
      specId: 'REQ-5',
      targetFilePath: 'src/x.ts',
      targetQualifiedName: 'g',
      targetNodeKind: 'function',
      resolvedNodeId: v1.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: 'g()',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    expect(sq.getLinksBySpec('REQ-5')).toHaveLength(1);
    sq.deleteSpecsByFile('specs/dead.md');
    expect(sq.getLinksBySpec('REQ-5')).toHaveLength(0);
  });

  it('agent-asserted (1.0) wins over spec-declaration (0.7) on the same logical key', () => {
    const sq = cg.getSpecQueries();
    const now = Date.now();
    sq.insertSpec({
      id: 'REQ-6',
      kind: 'requirement',
      title: 'X',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/x.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    // Spec-declaration link arrives first.
    sq.upsertSpecLink({
      specId: 'REQ-6',
      targetFilePath: 'src/a.ts',
      targetQualifiedName: 'foo',
      targetNodeKind: 'function',
      kind: 'implements',
      state: 'orphaned',
      driftAxis: null,
      specHashAtLink: 'h',
      provenance: 'spec-declaration',
      confidence: 0.7,
      createdAt: now,
      updatedAt: now,
    });
    // Agent asserts later.
    sq.upsertSpecLink({
      specId: 'REQ-6',
      targetFilePath: 'src/a.ts',
      targetQualifiedName: 'foo',
      targetNodeKind: 'function',
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
    const links = sq.getLinksBySpec('REQ-6');
    expect(links).toHaveLength(1);
    expect(links[0]!.provenance).toBe('agent-asserted');
    expect(links[0]!.state).toBe('implemented');
  });
});
