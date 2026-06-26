/**
 * Domain gap-seed tests — REQ-DOMAIN-003.
 *
 * The gap-seed is a read-only pass: it lists the structural code entities and
 * non-domain specs that no domain fact yet covers, and tallies coverage over
 * the entity ∪ spec universe. These tests map 1:1 to the acceptance IDs:
 *
 *   A1 — an entity with no domain fact is surfaced as a gap.
 *   A2 — an entity a domain fact reaches (via its spec-tier chain) is excluded.
 *   A3 — documented + gaps reconstitutes the universe; the call writes nothing.
 *
 * Skipped without FTS5 in the system SQLite (same pattern as the other DB tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { Node, NodeKind, Spec } from '../src/types';
import { QueryBuilder } from '../src/db/queries';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-domain-gap-'));
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

/** FTS5 availability probe (mirrors spec-link-resolver.test.ts). */
const fts5Available = (() => {
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

describe.skipIf(!fts5Available)('domain gap-seed (REQ-DOMAIN-003)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
  });

  afterEach(() => {
    cg?.close();
    clean(dir);
  });

  /** The private QueryBuilder used to seed nodes directly. */
  function rawQueries(): QueryBuilder {
    return (cg as unknown as { queries: QueryBuilder }).queries;
  }

  /** Insert a requirement spec and a resolved `implements` link to a node. */
  function seedReqLinkedTo(specId: string, node: Node, now: number): void {
    const sq = cg.getSpecQueries();
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
    sq.upsertSpecLink({
      specId,
      targetFilePath: node.filePath,
      targetQualifiedName: node.qualifiedName,
      targetNodeKind: node.kind,
      resolvedNodeId: node.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: node.signature,
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Insert a domain fact with optional parent / depends_on. */
  function insertDomainFact(
    id: string,
    now: number,
    opts: { parentId?: string; dependsOn?: string[] } = {}
  ): Spec {
    const spec: Spec = {
      id,
      kind: 'domain',
      title: id,
      body: 'A domain fact.',
      format: 'markdown',
      sourcePath: 'specs/domain/fact.md',
      contentHash: 'dh',
      parentId: opts.parentId,
      metadata: opts.dependsOn
        ? { type: 'rule', depends_on: opts.dependsOn }
        : { type: 'rule' },
      createdAt: now,
      updatedAt: now,
    };
    cg.getSpecQueries().insertSpec(spec);
    return spec;
  }

  it('A1 — surfaces an entity that no domain fact covers', () => {
    const now = Date.now();
    rawQueries().insertNode(
      makeNode('src/pay.ts', 'Payment', 'class', 1, 'class Payment')
    );

    const seed = cg.getDomainGapSeed();

    const names = seed.entities.map((e) => e.name);
    expect(names).toContain('Payment');
    expect(seed.coverage.gaps).toBeGreaterThanOrEqual(1);
  });

  it('A2 — excludes an entity a domain fact reaches via its spec-tier chain', () => {
    const now = Date.now();
    const payment = makeNode('src/pay.ts', 'Payment', 'class', 1, 'class Payment');
    rawQueries().insertNode(payment);

    // A requirement implements Payment; a domain fact depends_on that requirement.
    seedReqLinkedTo('REQ-PAY-001', payment, now);
    insertDomainFact('DOM-PAY-001', now, { dependsOn: ['REQ-PAY-001'] });

    const seed = cg.getDomainGapSeed();

    expect(seed.entities.map((e) => e.name)).not.toContain('Payment');
    // The requirement the fact reaches is documented too — not a spec gap.
    expect(seed.specs.map((s) => s.id)).not.toContain('REQ-PAY-001');
  });

  it('A2 — documents a reached spec even when it contributes no code link', () => {
    const now = Date.now();
    // Requirement with NO spec_links; a domain fact still reaches it.
    cg.getSpecQueries().insertSpec({
      id: 'REQ-EMPTY-001',
      kind: 'requirement',
      title: 'Empty',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/REQ-EMPTY-001.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    insertDomainFact('DOM-EMPTY-001', now, { dependsOn: ['REQ-EMPTY-001'] });

    const seed = cg.getDomainGapSeed();
    expect(seed.specs.map((s) => s.id)).not.toContain('REQ-EMPTY-001');
  });

  it('A3 — documented + gaps reconstitutes the entity ∪ spec universe', () => {
    const now = Date.now();
    const q = rawQueries();

    // Entities: two classes (one covered, one not) + one out-of-scope function.
    const covered = makeNode('src/a.ts', 'Covered', 'class', 1, 'class Covered');
    const uncovered = makeNode('src/b.ts', 'Uncovered', 'class', 1, 'class Uncovered');
    q.insertNode(covered);
    q.insertNode(uncovered);
    q.insertNode(makeNode('src/c.ts', 'helper', 'function', 1, 'helper()')); // out of scope

    // One requirement (covered by a fact) + one orphan requirement (a spec gap).
    seedReqLinkedTo('REQ-COV-001', covered, now);
    cg.getSpecQueries().insertSpec({
      id: 'REQ-ORPHAN-001',
      kind: 'requirement',
      title: 'Orphan',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/REQ-ORPHAN-001.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    insertDomainFact('DOM-COV-001', now, { dependsOn: ['REQ-COV-001'] });

    // Universe = in-scope entities (2 classes) + non-domain specs (2 reqs).
    const inScopeEntities = ['class', 'struct', 'interface', 'route', 'component']
      .flatMap((k) => cg.getNodesByKind(k as NodeKind)).length;
    const nonDomainSpecs = cg
      .getSpecQueries()
      .getAllSpecs()
      .filter((s) => s.kind !== 'domain').length;

    const seed = cg.getDomainGapSeed();
    expect(seed.coverage.documented + seed.coverage.gaps).toBe(
      inScopeEntities + nonDomainSpecs
    );
  });

  it('A3 — the call writes nothing (specs / links / nodes unchanged)', () => {
    const now = Date.now();
    const q = rawQueries();
    const sq = cg.getSpecQueries();

    const payment = makeNode('src/pay.ts', 'Payment', 'class', 1, 'class Payment');
    q.insertNode(payment);
    seedReqLinkedTo('REQ-PAY-002', payment, now);
    insertDomainFact('DOM-PAY-002', now, { dependsOn: ['REQ-PAY-002'] });

    const before = {
      specs: sq.getAllSpecs().length,
      links: sq.getAllLinks().length,
      nodes: q.getNodeAndEdgeCount().nodes,
    };

    cg.getDomainGapSeed();

    const after = {
      specs: sq.getAllSpecs().length,
      links: sq.getAllLinks().length,
      nodes: q.getNodeAndEdgeCount().nodes,
    };
    expect(after).toEqual(before);
  });
});
