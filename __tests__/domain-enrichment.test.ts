/**
 * Domain fact enrichment — REQ-DOMAIN-008.
 *
 * The /api/domain route enriches each domain fact with the live state of the
 * code it governs, derived from the fact's inherited spec→code links
 * (`SpecLinkResolver.getInheritedLinks`). Two pure helpers do the collapse:
 *
 *   collapseInheritedState — worst-first chip state for a fact's links.
 *   toGovernedRefs         — the deduped {specId, symbol} set the fact governs.
 *
 * Part 1 unit-tests both helpers against synthetic links (no DB). Part 2 drives
 * a real SpecQueries + SpecLinkResolver to prove the end-to-end derivation:
 *   - a verified inherited link → state 'verified' + the right governs ref,
 *   - a drifted inherited link  → state 'drifted',
 *   - an unresolvable dependency → state 'none' / governs [].
 *
 * Part 2 is skipped without FTS5 (same pattern as the other DB-backed suites).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { Node, NodeKind, Spec } from '../src/types';
import { QueryBuilder } from '../src/db/queries';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';
import {
  collapseInheritedState,
  toGovernedRefs,
} from '../server/src/routes/domain';

// ---------------------------------------------------------------------------
// Synthetic inherited links for the pure-helper unit tests. The helpers only
// read `viaSpecId`, `link.state`, and `link.targetQualifiedName`, so a minimal
// shape cast to the parameter types is sufficient.
// ---------------------------------------------------------------------------
type Links = Parameters<typeof collapseInheritedState>[0];
type Result = Parameters<typeof toGovernedRefs>[0];

function synth(viaSpecId: string, state: string, symbol: string): unknown {
  return { viaSpecId, link: { state, targetQualifiedName: symbol } };
}
function links(...l: unknown[]): Links {
  return l as unknown as Links;
}
function result(...l: unknown[]): Result {
  return { links: l, gaps: [], visitedSpecIds: [] } as unknown as Result;
}

describe('collapseInheritedState (REQ-DOMAIN-008)', () => {
  it('returns none for no links', () => {
    expect(collapseInheritedState(links())).toBe('none');
  });

  it('collapses verified/implemented to verified', () => {
    expect(collapseInheritedState(links(synth('R1', 'verified', 'A')))).toBe('verified');
    expect(collapseInheritedState(links(synth('R1', 'implemented', 'A')))).toBe('verified');
  });

  it('drifted outranks verified', () => {
    expect(
      collapseInheritedState(links(synth('R1', 'verified', 'A'), synth('R2', 'drifted', 'B'))),
    ).toBe('drifted');
  });

  it('broken/orphaned outranks everything (worst-first)', () => {
    expect(
      collapseInheritedState(
        links(synth('R1', 'verified', 'A'), synth('R2', 'drifted', 'B'), synth('R3', 'broken', 'C')),
      ),
    ).toBe('broken');
    expect(
      collapseInheritedState(links(synth('R1', 'drifted', 'A'), synth('R2', 'orphaned', 'B'))),
    ).toBe('broken');
  });

  it('treats not-yet-implemented states (drafted/implementing) as none', () => {
    expect(
      collapseInheritedState(links(synth('R1', 'drafted', 'A'), synth('R2', 'implementing', 'B'))),
    ).toBe('none');
  });
});

describe('toGovernedRefs (REQ-DOMAIN-008)', () => {
  it('maps each link to {specId, symbol}', () => {
    expect(toGovernedRefs(result(synth('R1', 'verified', 'Payment.charge')))).toEqual([
      { specId: 'R1', symbol: 'Payment.charge' },
    ]);
  });

  it('dedupes identical (specId, symbol) pairs but keeps distinct ones', () => {
    expect(
      toGovernedRefs(
        result(
          synth('R1', 'verified', 'A'),
          synth('R1', 'drifted', 'A'), // dup key → dropped
          synth('R1', 'verified', 'B'), // distinct symbol
          synth('R2', 'verified', 'A'), // distinct spec
        ),
      ),
    ).toEqual([
      { specId: 'R1', symbol: 'A' },
      { specId: 'R1', symbol: 'B' },
      { specId: 'R2', symbol: 'A' },
    ]);
  });

  it('returns [] for a result with no links', () => {
    expect(toGovernedRefs(result())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FTS5 guard + helpers (mirrors domain-gap-seed.test.ts).
// ---------------------------------------------------------------------------
const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  return false;
})();

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'domain-enrich-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}
function makeNode(
  filePath: string,
  qualifiedName: string,
  kind: NodeKind,
  line: number,
  signature?: string,
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

describe.skipIf(!fts5Available)('domain fact enrichment — end-to-end (REQ-DOMAIN-008)', () => {
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

  function rawQueries(): QueryBuilder {
    return (cg as unknown as { queries: QueryBuilder }).queries;
  }

  /** Requirement spec + an `implements` link to a node in the given state. */
  function seedReqLinkedTo(
    specId: string,
    node: Node,
    state: 'implemented' | 'verified' | 'drifted',
    now: number,
  ): void {
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
      state,
      driftAxis: state === 'drifted' ? 'code' : null,
      specHashAtLink: 'h',
      nodeSigAtLink: node.signature,
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
  }

  function insertDomainFact(id: string, dependsOn: string[], now: number): Spec {
    const spec: Spec = {
      id,
      kind: 'domain',
      title: id,
      body: 'A domain fact.',
      format: 'markdown',
      sourcePath: 'specs/domain/fact.md',
      contentHash: 'dh',
      metadata: { type: 'rule', depends_on: dependsOn },
      createdAt: now,
      updatedAt: now,
    };
    cg.getSpecQueries().insertSpec(spec);
    return spec;
  }

  it('a verified inherited link → state verified + correct governs', () => {
    const now = Date.now();
    const node = makeNode('src/pay.ts', 'Payment.charge', 'method', 1, 'charge()');
    rawQueries().insertNode(node);
    seedReqLinkedTo('REQ-PAY-001', node, 'verified', now);
    const fact = insertDomainFact('DOM-PAY-001', ['REQ-PAY-001'], now);

    const inh = cg.getSpecLinkResolver().getInheritedLinks(fact);
    expect(collapseInheritedState(inh.links)).toBe('verified');
    expect(toGovernedRefs(inh)).toEqual([
      { specId: 'REQ-PAY-001', symbol: 'Payment.charge' },
    ]);
  });

  it('a drifted inherited link → state drifted', () => {
    const now = Date.now();
    const node = makeNode('src/pay.ts', 'Payment.charge', 'method', 1, 'charge()');
    rawQueries().insertNode(node);
    seedReqLinkedTo('REQ-PAY-002', node, 'drifted', now);
    const fact = insertDomainFact('DOM-PAY-002', ['REQ-PAY-002'], now);

    const inh = cg.getSpecLinkResolver().getInheritedLinks(fact);
    expect(collapseInheritedState(inh.links)).toBe('drifted');
  });

  it('an unresolvable dependency → state none / governs []', () => {
    const now = Date.now();
    const fact = insertDomainFact('DOM-MISSING-001', ['REQ-DOES-NOT-EXIST'], now);

    const inh = cg.getSpecLinkResolver().getInheritedLinks(fact);
    expect(inh.links).toHaveLength(0);
    expect(inh.gaps).toContain('REQ-DOES-NOT-EXIST');
    expect(collapseInheritedState(inh.links)).toBe('none');
    expect(toGovernedRefs(inh)).toEqual([]);
  });
});
