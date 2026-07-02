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

  // ===========================================================================
  // Transitive spec-tier inheritance — REQ-DOMAIN-002 (getInheritedLinks)
  // ===========================================================================

  /** Insert a requirement spec + a resolved code link in one helper. */
  function seedRequirementWithLink(
    sq: ReturnType<SpecShip['getSpecQueries']>,
    queries: import('../src/db/queries').QueryBuilder,
    specId: string,
    file: string,
    symbol: string,
    sig: string,
    now: number
  ): void {
    sq.insertSpec({
      id: specId,
      kind: 'requirement',
      title: specId,
      body: 'b',
      format: 'markdown',
      sourcePath: `specs/${specId}.md`,
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    const v = makeNode(file, symbol, 'function', 1, sig);
    queries.insertNode(v);
    sq.upsertSpecLink({
      specId,
      targetFilePath: file,
      targetQualifiedName: symbol,
      targetNodeKind: 'function',
      resolvedNodeId: v.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: sig,
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Insert a domain fact spec with optional parent / depends_on. */
  function insertDomainFact(
    sq: ReturnType<SpecShip['getSpecQueries']>,
    id: string,
    now: number,
    opts: { parentId?: string; dependsOn?: string[] } = {}
  ): import('../src/types').Spec {
    const spec: import('../src/types').Spec = {
      id,
      kind: 'domain',
      title: id,
      body: 'A domain fact.',
      format: 'markdown',
      sourcePath: 'specs/domain/fact.md',
      contentHash: 'dh',
      parentId: opts.parentId,
      metadata: opts.dependsOn ? { type: 'rule', depends_on: opts.dependsOn } : { type: 'rule' },
      createdAt: now,
      updatedAt: now,
    };
    sq.insertSpec(spec);
    return spec;
  }

  it('surfaces a depends_on requirement\'s code links transitively (A1)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    seedRequirementWithLink(sq, queries, 'REQ-PAY-004', 'src/pay.ts', 'settle', 'settle(x)', now);
    const fact = insertDomainFact(sq, 'DOM-PAY-001', now, { dependsOn: ['REQ-PAY-004'] });

    const { links, gaps } = resolver.getInheritedLinks(fact);
    expect(gaps).toEqual([]);
    expect(links).toHaveLength(1);
    expect(links[0]!.viaSpecId).toBe('REQ-PAY-004');
    expect(links[0]!.link.targetQualifiedName).toBe('settle');
  });

  it('inherits via parent_id as well as depends_on', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    seedRequirementWithLink(sq, queries, 'REQ-A', 'src/a.ts', 'fa', 'fa()', now);
    seedRequirementWithLink(sq, queries, 'REQ-B', 'src/b.ts', 'fb', 'fb()', now);
    const fact = insertDomainFact(sq, 'DOM-X-001', now, {
      parentId: 'REQ-A',
      dependsOn: ['REQ-B'],
    });

    const { links } = resolver.getInheritedLinks(fact);
    const vias = links.map((l) => l.viaSpecId).sort();
    expect(vias).toEqual(['REQ-A', 'REQ-B']);
  });

  it('reflects drifted state on an inherited link (A2)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    seedRequirementWithLink(sq, queries, 'REQ-PAY-004', 'src/pay.ts', 'settle', 'settle(x)', now);
    const fact = insertDomainFact(sq, 'DOM-PAY-002', now, { dependsOn: ['REQ-PAY-004'] });

    // Code signature changes → resolver flips REQ-PAY-004's link to drifted(code).
    queries.deleteNodesByFile('src/pay.ts');
    queries.insertNode(makeNode('src/pay.ts', 'settle', 'function', 1, 'settle(x, y)'));
    resolver.resolveLinksForFiles(['src/pay.ts']);

    const { links } = resolver.getInheritedLinks(fact);
    expect(links).toHaveLength(1);
    expect(links[0]!.link.state).toBe('drifted');
    expect(links[0]!.link.driftAxis).toBe('code');
  });

  it('reports an unresolvable dependency as a gap, not an error (A3)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const now = Date.now();

    // Fact depends on a spec that was never indexed.
    const fact = insertDomainFact(sq, 'DOM-GAP-001', now, { dependsOn: ['REQ-MISSING'] });

    const { links, gaps } = resolver.getInheritedLinks(fact);
    expect(links).toEqual([]);
    expect(gaps).toEqual(['REQ-MISSING']);
  });

  it('a fact with no spec deps yields no links and no gaps (unlinked/proposed)', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const now = Date.now();
    const fact = insertDomainFact(sq, 'DOM-NONE-001', now, {});

    const { links, gaps } = resolver.getInheritedLinks(fact);
    expect(links).toEqual([]);
    expect(gaps).toEqual([]);
  });

  it('follows a multi-hop chain and survives a cycle without infinite loop', () => {
    const sq = cg.getSpecQueries();
    const resolver = cg.getSpecLinkResolver();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    // REQ-LEAF has the code; REQ-MID depends on it; the fact depends on REQ-MID.
    seedRequirementWithLink(sq, queries, 'REQ-LEAF', 'src/leaf.ts', 'leaf', 'leaf()', now);
    // REQ-MID is a requirement that depends_on REQ-LEAF and (cycle) back on itself's parent fact.
    sq.insertSpec({
      id: 'REQ-MID',
      kind: 'requirement',
      title: 'mid',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/mid.md',
      contentHash: 'h',
      metadata: { depends_on: ['REQ-LEAF', 'DOM-CYCLE-001'] }, // cycle back to the fact
      createdAt: now,
      updatedAt: now,
    });
    const fact = insertDomainFact(sq, 'DOM-CYCLE-001', now, { dependsOn: ['REQ-MID'] });

    const { links } = resolver.getInheritedLinks(fact);
    // Reaches REQ-LEAF's code through REQ-MID; the cycle back to the fact is guarded.
    expect(links.map((l) => l.viaSpecId)).toContain('REQ-LEAF');
    expect(links.some((l) => l.link.targetQualifiedName === 'leaf')).toBe(true);
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

/**
 * Drift-push transitions (DRIFT-PUSH-DOC / REQ-DRIFT-PUSH-001): the resolver
 * records links that TRANSITION into `drifted` — once, not on every re-drift —
 * so the sync CLI can push a one-line notice at the moment drift happens.
 */
describe.skipIf(!fts5Available)('SpecLinkResolver drift transitions (REQ-DRIFT-PUSH-001)', () => {
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

  function seedLink(specId: string, qname: string) {
    const sq = cg.getSpecQueries();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();
    sq.insertSpec({
      id: specId, kind: 'requirement', title: 'X', body: 'b', format: 'markdown',
      sourcePath: 'specs/x.md', contentHash: 'h', createdAt: now, updatedAt: now,
    });
    const v1 = makeNode('src/t.ts', qname, 'function', 1, `${qname}(a)`);
    queries.insertNode(v1);
    sq.upsertSpecLink({
      specId, targetFilePath: 'src/t.ts', targetQualifiedName: qname,
      targetNodeKind: 'function', resolvedNodeId: v1.id, kind: 'implements',
      state: 'implemented', driftAxis: null, specHashAtLink: 'h',
      nodeSigAtLink: `${qname}(a)`, provenance: 'agent-asserted', confidence: 1.0,
      createdAt: now, updatedAt: now,
    });
    return { sq, queries };
  }

  it('records a transition with fromState/axis/symbol when a link drifts (A1)', () => {
    const { queries } = seedLink('REQ-T1', 'foo');
    const resolver = cg.getSpecLinkResolver();

    queries.deleteNodesByFile('src/t.ts');
    queries.insertNode(makeNode('src/t.ts', 'foo', 'function', 1, 'foo(a, b)'));

    const stats = resolver.resolveLinksForFiles(['src/t.ts']);
    expect(stats.transitions).toEqual([
      { specId: 'REQ-T1', fromState: 'implemented', axis: 'code', symbol: 'foo' },
    ]);
  });

  it('does not record a re-drift of an already-drifted link (A2)', () => {
    const { queries } = seedLink('REQ-T2', 'bar');
    const resolver = cg.getSpecLinkResolver();

    queries.deleteNodesByFile('src/t.ts');
    queries.insertNode(makeNode('src/t.ts', 'bar', 'function', 1, 'bar(a, b)'));
    const first = resolver.resolveLinksForFiles(['src/t.ts']);
    expect(first.transitions).toHaveLength(1);

    // Second sync over the still-different signature: state is already
    // `drifted`, so no new transition is recorded.
    const second = resolver.resolveLinksForFiles(['src/t.ts']);
    expect(second.transitions).toHaveLength(0);
  });

  it('records a spec-axis transition once via markSpecDrifted', () => {
    const { sq } = seedLink('REQ-T3', 'baz');
    const resolver = cg.getSpecLinkResolver();
    const stats = {
      scanned: 0, reresolved: 0, orphaned: 0, driftedCode: 0,
      candidatesApplied: 0, commentLinksApplied: 0, transitions: [] as import('../src/resolution/spec-link-resolver').DriftTransition[],
    };

    resolver.markSpecDrifted('REQ-T3', 'h2', stats);
    expect(stats.transitions).toEqual([
      { specId: 'REQ-T3', fromState: 'implemented', axis: 'spec', symbol: 'baz' },
    ]);
    expect(sq.getLinksBySpec('REQ-T3')[0]!.state).toBe('drifted');

    // Re-mark with a still-different hash: already drifted → no new transition.
    const again = { ...stats, transitions: [] as import('../src/resolution/spec-link-resolver').DriftTransition[] };
    resolver.markSpecDrifted('REQ-T3', 'h3', again);
    expect(again.transitions).toHaveLength(0);
  });
});
