/**
 * Link preservation across spec re-extraction (REQ-VSTATE-001).
 *
 * `spec_links.spec_id` is `ON DELETE CASCADE` and spec indexing deleted the
 * file's specs before re-inserting them, so editing ANY part of a spec file
 * destroyed every link the file didn't re-declare — every agent-asserted link,
 * every verification record. Which also meant the sticky-state and
 * spec-axis-drift machinery never ran on the real edit path: there was nothing
 * left to transition.
 *
 * These tests drive the REAL edit path (write file → indexSpecs → edit file →
 * indexSpecs) rather than calling the DB layer directly, because that path is
 * exactly what used to bypass the guarantees.
 *
 * Skipped without FTS5 in the system SQLite (same pattern as the sibling spec
 * suites) — SpecShip.init runs the full schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-link-preserve-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

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

const SPEC_V1 = `---
id: PRESERVE-DOC
title: Preservation demo
---

<!-- id: PRESERVE-DOC -->
# Preservation demo

Intro prose.

<!-- id: REQ-PRESERVE-001 -->
## The first requirement

Body of the first requirement.

<!-- id: REQ-PRESERVE-002 -->
## The second requirement

Body of the second requirement.
`;

/** Same spec ids, different prose — the "editing a spec file" case. */
const SPEC_V2 = SPEC_V1.replace(
  'Body of the first requirement.',
  'Body of the first requirement, now reworded.'
);

/** REQ-PRESERVE-002 removed entirely — the mark-and-sweep case. */
const SPEC_V3 = SPEC_V1.slice(0, SPEC_V1.indexOf('<!-- id: REQ-PRESERVE-002 -->'));

describe.skipIf(!fts5Available)('spec link preservation across re-extraction (REQ-VSTATE-001)', () => {
  let dir: string;
  let cg: SpecShip;
  let sq: SpecQueries;

  const writeSpec = (content: string) => {
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', 'preserve.md'), content, 'utf-8');
  };

  /** An agent-asserted link that NO file declaration would ever re-create. */
  const assertAgentLink = (specId: string, state: 'verified' | 'implemented' = 'verified') => {
    const spec = sq.getSpecById(specId)!;
    const now = Date.now();
    return sq.upsertSpecLink({
      specId,
      targetFilePath: 'src/app.ts',
      targetQualifiedName: 'runApp',
      targetNodeKind: 'function',
      kind: 'tests',
      state,
      driftAxis: null,
      specHashAtLink: spec.contentHash,
      nodeSigAtLink: 'runApp()',
      provenance: 'agent-asserted',
      confidence: 1.0,
      metadata: { verification: { result: 'pass', verifiedAt: '2026-09-01T00:00:00.000Z' } },
      createdAt: now,
      updatedAt: now,
    });
  };

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    // A real target node, so the post-extraction resolve pass re-resolves the
    // link instead of orphaning it (orphaned would mask the drift assertion).
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    queries.insertNode({
      id: generateNodeId('src/app.ts', 'function', 'runApp', 1),
      kind: 'function',
      name: 'runApp',
      qualifiedName: 'runApp',
      filePath: 'src/app.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 0,
      signature: 'runApp()',
      updatedAt: Date.now(),
    });
    writeSpec(SPEC_V1);
    await cg.indexSpecs();
  });

  afterEach(async () => {
    cg?.close();
    clean(dir);
  });

  it('editing a spec file preserves agent-asserted links with no file declaration (REQ-VSTATE-001.A1)', async () => {
    const id = assertAgentLink('REQ-PRESERVE-002');
    writeSpec(SPEC_V2);
    await cg.indexSpecs();

    const link = sq.getLinkById(id);
    expect(link).not.toBeNull();
    expect(link!.specId).toBe('REQ-PRESERVE-002');
    expect(link!.provenance).toBe('agent-asserted');
    // REQ-PRESERVE-002's own body did not move, so its verdict is untouched.
    expect(link!.state).toBe('verified');
    // The verification evidence rides along — a `verified` state whose proof was
    // erased would be worse than no state at all.
    expect(link!.metadata?.verification).toBeDefined();
  });

  it('a preserved link on an EDITED spec drifts on the spec axis, not back to implemented (REQ-VSTATE-001.A2)', async () => {
    const id = assertAgentLink('REQ-PRESERVE-001');
    writeSpec(SPEC_V2); // REQ-PRESERVE-001's body changed
    await cg.indexSpecs();

    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('drifted');
    expect(link.driftAxis).toBe('spec');
  });

  it('removing a spec id from the file removes that spec\'s links — mark-and-sweep (REQ-VSTATE-001.A3)', async () => {
    const keptId = assertAgentLink('REQ-PRESERVE-001', 'implemented');
    const goneId = assertAgentLink('REQ-PRESERVE-002');
    writeSpec(SPEC_V3); // REQ-PRESERVE-002 deleted from the file
    await cg.indexSpecs();

    expect(sq.getSpecById('REQ-PRESERVE-002')).toBeNull();
    expect(sq.getLinkById(goneId)).toBeNull();
    // …and the surviving spec's link is untouched by the sweep.
    expect(sq.getLinkById(keptId)).not.toBeNull();
    expect(sq.getAllLinks().every((l) => l.specId !== 'REQ-PRESERVE-002')).toBe(true);
  });

  it('a full index run preserves agent-asserted links for unchanged spec files (REQ-VSTATE-001.A4)', async () => {
    const id = assertAgentLink('REQ-PRESERVE-002');
    await cg.indexAll();

    const link = sq.getLinkById(id);
    expect(link).not.toBeNull();
    expect(link!.state).toBe('verified');
    expect(link!.provenance).toBe('agent-asserted');
  });

  it('every column of a preserved link survives the edit untouched (REQ-VSTATE-001.A1)', async () => {
    const id = assertAgentLink('REQ-PRESERVE-002');
    const before = sq.getLinkById(id)!;
    writeSpec(SPEC_V2);
    await cg.indexSpecs();
    const after = sq.getLinkById(id)!;

    // Column-completeness: re-extraction rewrites nothing on a surviving link
    // except the resolver's own bookkeeping (resolved node cache + its
    // timestamp). Nothing is snapshotted and restored, so nothing can be
    // silently dropped in a round-trip.
    const { updatedAt: _u1, resolvedNodeId: _r1, ...beforeRest } = before;
    const { updatedAt: _u2, resolvedNodeId: _r2, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
    expect(Object.keys(afterRest).sort()).toEqual(
      ['confidence', 'createdAt', 'driftAxis', 'id', 'kind', 'metadata', 'nodeSigAtLink',
       'provenance', 'specHashAtLink', 'specId', 'state', 'targetFilePath',
       'targetNodeKind', 'targetQualifiedName'].sort()
    );
  });

  it('re-inserting a document does not cascade its requirements away (REQ-VSTATE-001.A1)', () => {
    // `INSERT OR REPLACE` resolved a conflict by DELETING the row first, which
    // fired the parent_id CASCADE: re-inserting a document silently deleted
    // every requirement under it (and their links). The upsert cannot.
    const linkId = assertAgentLink('REQ-PRESERVE-001');
    const doc = sq.getSpecById('PRESERVE-DOC')!;
    sq.insertSpec({ ...doc, title: 'Retitled document', updatedAt: Date.now() + 1 });

    expect(sq.getSpecById('PRESERVE-DOC')!.title).toBe('Retitled document');
    expect(sq.getSpecById('REQ-PRESERVE-001')).not.toBeNull();
    expect(sq.getLinkById(linkId)).not.toBeNull();
  });

  it('a spec keeps its original created_at across re-extraction (REQ-VSTATE-001.A1)', async () => {
    const born = sq.getSpecById('REQ-PRESERVE-001')!.createdAt;
    writeSpec(SPEC_V2);
    await cg.indexSpecs();

    const after = sq.getSpecById('REQ-PRESERVE-001')!;
    expect(after.createdAt).toBe(born);
    expect(after.body).toContain('now reworded');
  });

  it('the sweep only touches the named file and only removed ids (REQ-VSTATE-001.A3)', () => {
    const keptId = assertAgentLink('REQ-PRESERVE-001');
    // A spec from a DIFFERENT file must be immune to this file's sweep.
    const now = Date.now();
    sq.insertSpec({
      id: 'REQ-OTHER-001', kind: 'requirement', title: 'Other', body: 'b',
      format: 'markdown', sourcePath: 'specs/other.md', contentHash: 'h',
      createdAt: now, updatedAt: now,
    });

    const swept = sq.sweepRemovedSpecs('specs/preserve.md', ['PRESERVE-DOC', 'REQ-PRESERVE-001']);
    expect(swept).toBe(1); // REQ-PRESERVE-002 only
    expect(sq.getSpecById('REQ-PRESERVE-002')).toBeNull();
    expect(sq.getSpecById('REQ-OTHER-001')).not.toBeNull();
    expect(sq.getLinkById(keptId)).not.toBeNull();
    // Idempotent: a second sweep with the same keep set removes nothing.
    expect(sq.sweepRemovedSpecs('specs/preserve.md', ['PRESERVE-DOC', 'REQ-PRESERVE-001'])).toBe(0);
  });

  it('a preserved link keeps its row id and history across a prose edit (REQ-VSTATE-001.A1)', async () => {
    const id = assertAgentLink('REQ-PRESERVE-001', 'implemented');
    const before = sq.getLinkById(id)!;
    writeSpec(SPEC_V2);
    await cg.indexSpecs();

    const after = sq.getLinkById(id)!;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.targetQualifiedName).toBe(before.targetQualifiedName);
  });

  // ─────────────────────── declaration reconciliation ───────────────────────
  //
  // The mirror image of preservation: because the spec row now survives a
  // re-extract, so would every link it ever declared — deleting a `verifies:`
  // or `implementations:` bullet would stop meaning anything. The file owns the
  // links IT declares, so a withdrawn declaration must withdraw its link, while
  // links of every other provenance stay untouchable.

  /** Both declaration blocks present. */
  const DECL_V1 = `---
id: DECL-DOC
title: Declaration demo
---

<!-- id: DECL-DOC -->
# Declaration demo

<!-- id: REQ-DECL-001 -->
## The declared requirement

implementations:
  - src/app.ts:runApp

verifies:
  - __tests__/app.test.ts:runsApp
`;

  /** The `verifies:` bullet deleted; `implementations:` untouched. */
  const DECL_NO_VERIFIES = DECL_V1.replace(
    '\nverifies:\n  - __tests__/app.test.ts:runsApp\n',
    ''
  );

  /** The `implementations:` bullet deleted; `verifies:` untouched. */
  const DECL_NO_IMPL = DECL_V1.replace(
    '\nimplementations:\n  - src/app.ts:runApp\n',
    ''
  );

  const writeDecl = (content: string) => {
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', 'declared.md'), content, 'utf-8');
  };

  const declLinks = (kind: 'implements' | 'tests') =>
    sq.getLinksBySpec('REQ-DECL-001').filter((l) => l.kind === kind);

  /** The `verifies:` target, so its declared link resolves like a real one. */
  const insertTestNode = () => {
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    queries.insertNode({
      id: generateNodeId('__tests__/app.test.ts', 'function', 'runsApp', 1),
      kind: 'function',
      name: 'runsApp',
      qualifiedName: 'runsApp',
      filePath: '__tests__/app.test.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 3,
      startColumn: 0,
      endColumn: 0,
      signature: 'runsApp()',
      updatedAt: Date.now(),
    });
  };

  it('removing a verifies: bullet removes exactly that link (REQ-VSTATE-001)', async () => {
    insertTestNode();
    writeDecl(DECL_V1);
    await cg.indexSpecs();
    expect(declLinks('tests')).toHaveLength(1);
    const implBefore = declLinks('implements')[0]!;

    writeDecl(DECL_NO_VERIFIES);
    await cg.indexSpecs();

    expect(declLinks('tests'), 'a withdrawn verifies: bullet must withdraw its link').toHaveLength(0);
    // …and only that one: the untouched implementations: bullet keeps its row.
    expect(declLinks('implements')).toHaveLength(1);
    expect(declLinks('implements')[0]!.id).toBe(implBefore.id);
  });

  it('removing an implementations: bullet removes exactly that link (REQ-VSTATE-001)', async () => {
    insertTestNode();
    writeDecl(DECL_V1);
    await cg.indexSpecs();
    const testsBefore = declLinks('tests')[0]!;

    writeDecl(DECL_NO_IMPL);
    await cg.indexSpecs();

    expect(declLinks('implements')).toHaveLength(0);
    expect(declLinks('tests')).toHaveLength(1);
    expect(declLinks('tests')[0]!.id).toBe(testsBefore.id);
  });

  it('a verified declaration link is reconciled away too, and counted (REQ-VSTATE-001)', async () => {
    insertTestNode();
    writeDecl(DECL_V1);
    await cg.indexSpecs();

    // The confidence guard leaves provenance at `spec-declaration` even after a
    // promotion to verified, and the withdrawal still wins: the verdict was
    // about a promise the spec no longer makes.
    const verified = declLinks('tests')[0]!;
    sq.updateSpecLinkState(verified.id, 'verified', null);

    writeDecl(DECL_NO_VERIFIES);
    const stats = await cg.indexSpecs();

    expect(sq.getLinkById(verified.id)).toBeNull();
    expect(
      stats.resolverStats.declarationsReconciled,
      'a removed link must be counted, never silent'
    ).toBe(1);
  });

  it('agent-asserted and code-comment links survive the same edit (REQ-VSTATE-001)', async () => {
    insertTestNode();
    writeDecl(DECL_V1);
    await cg.indexSpecs();

    // An agent-asserted link on the same spec, which no file declares.
    const spec = sq.getSpecById('REQ-DECL-001')!;
    const now = Date.now();
    const agentId = sq.upsertSpecLink({
      specId: 'REQ-DECL-001',
      targetFilePath: 'src/app.ts',
      targetQualifiedName: 'runApp',
      targetNodeKind: 'function',
      kind: 'tests',
      state: 'verified',
      driftAxis: null,
      specHashAtLink: spec.contentHash,
      nodeSigAtLink: 'runApp()',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    // …and a code-comment link, from an `@implements` marker in a docstring.
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    queries.insertNode({
      id: generateNodeId('src/marked.ts', 'function', 'marked', 1),
      kind: 'function',
      name: 'marked',
      qualifiedName: 'marked',
      filePath: 'src/marked.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 3,
      startColumn: 0,
      endColumn: 0,
      docstring: '/** @implements REQ-DECL-001 */',
      signature: 'marked()',
      updatedAt: Date.now(),
    });
    cg.getSpecLinkResolver().applyCodeCommentLinks(['src/marked.ts']);
    const commentLink = sq
      .getLinksBySpec('REQ-DECL-001')
      .find((l) => l.provenance === 'code-comment')!;
    expect(commentLink, 'the code-comment link must exist before the edit').toBeDefined();

    // Withdraw BOTH declarations at once — the maximal reconciliation.
    writeDecl(DECL_NO_IMPL.replace('\nverifies:\n  - __tests__/app.test.ts:runsApp\n', ''));
    await cg.indexSpecs();

    expect(sq.getLinkById(agentId), 'agent-asserted links are not file-declared').not.toBeNull();
    // It survives, but deleting the bullets moved the requirement's body, so
    // the spec-axis drift rule claims it (A2) — `drifted(spec)`, which is a
    // re-verify prompt, not the deletion reconciliation would have been.
    expect(sq.getLinkById(agentId)!.state).toBe('drifted');
    expect(sq.getLinkById(agentId)!.driftAxis).toBe('spec');
    expect(sq.getLinkById(commentLink.id), 'code-comment links are not file-declared').not.toBeNull();
    // Every spec-declaration row is gone; nothing else was touched.
    expect(
      sq.getLinksBySpec('REQ-DECL-001').filter((l) => l.provenance === 'spec-declaration')
    ).toHaveLength(0);
  });

  it('an unchanged declaration keeps its row id — no drop-and-recreate (REQ-VSTATE-001)', async () => {
    insertTestNode();
    writeDecl(DECL_V1);
    await cg.indexSpecs();
    const before = declLinks('implements')[0]!;

    // A prose edit that leaves both declarations exactly as they were.
    writeDecl(DECL_V1.replace('## The declared requirement', '## The declared requirement, reworded'));
    const stats = await cg.indexSpecs();

    const after = declLinks('implements')[0]!;
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(stats.resolverStats.declarationsReconciled ?? 0).toBe(0);
  });
});
