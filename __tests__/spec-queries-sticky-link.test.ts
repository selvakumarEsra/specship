/**
 * upsertSpecLink sticky-state guard (REQ-STICKYLINK-001).
 *
 * A confidence-≥ re-upsert of a link whose logical key already exists must
 * NOT reset a `verified`/`broken` verdict back to the incoming state when the
 * spec body hasn't moved (same spec_hash_at_link). This reproduces the
 * JIRAPUB-009 incident: appending a requirement re-extracts the whole spec,
 * which re-upserts every existing link — silently downgrading verified links.
 *
 * The guard preserves state / drift_axis / spec_hash_at_link from the existing
 * row while still refreshing everything else (resolved node, signature,
 * provenance, confidence, metadata, updated_at). A genuine spec-hash change is
 * the ONE legitimate downgrade path and must still flow through.
 *
 * Skipped on environments without FTS5 in the system SQLite (same pattern as
 * spec-link-resolver.test.ts) — SpecShip.init runs the full schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { SpecLinkState } from '../src/types';
import { SpecQueries } from '../src/db/spec-queries';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-sticky-link-'));
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

describe.skipIf(!fts5Available)('upsertSpecLink sticky-state guard (REQ-STICKYLINK-001)', () => {
  let dir: string;
  let cg: SpecShip;
  let sq: SpecQueries;

  const SPEC_HASH = 'spec-hash-v1';

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    const now = Date.now();
    sq.insertSpec({
      id: 'REQ-1',
      kind: 'requirement',
      title: 'Demo',
      body: 'body',
      format: 'markdown',
      sourcePath: 'specs/demo.md',
      contentHash: SPEC_HASH,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(async () => {
    cg?.close();
    clean(dir);
  });

  /** Seed a link in a given state, then return its id + the seed timestamp. */
  function seedLink(state: SpecLinkState, at: number): number {
    return sq.upsertSpecLink({
      specId: 'REQ-1',
      targetFilePath: 'src/auth.ts',
      targetQualifiedName: 'authenticate',
      targetNodeKind: 'function',
      resolvedNodeId: 'node-v1',
      kind: 'implements',
      state,
      driftAxis: null,
      specHashAtLink: SPEC_HASH,
      nodeSigAtLink: 'auth(user)',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: at,
      updatedAt: at,
    });
  }

  /** Re-upsert the same logical key (equal confidence) with `state`. */
  function reUpsert(
    state: SpecLinkState,
    at: number,
    overrides: Partial<{
      specHashAtLink: string;
      resolvedNodeId: string;
      nodeSigAtLink: string;
      provenance: 'agent-asserted' | 'code-comment' | 'spec-declaration' | 'resolver';
      confidence: number;
      metadata: Record<string, unknown>;
    }> = {}
  ): number {
    return sq.upsertSpecLink({
      specId: 'REQ-1',
      targetFilePath: 'src/auth.ts',
      targetQualifiedName: 'authenticate',
      targetNodeKind: 'function',
      resolvedNodeId: overrides.resolvedNodeId ?? 'node-v1',
      kind: 'implements',
      state,
      driftAxis: null,
      specHashAtLink: overrides.specHashAtLink ?? SPEC_HASH,
      nodeSigAtLink: overrides.nodeSigAtLink ?? 'auth(user)',
      provenance: overrides.provenance ?? 'agent-asserted',
      confidence: overrides.confidence ?? 1.0,
      metadata: overrides.metadata,
      createdAt: at,
      updatedAt: at,
    });
  }

  it('A1: re-upsert of a verified link with unchanged spec hash preserves verdict', () => {
    const id = seedLink('verified', 1000);
    // Re-extraction re-upserts as 'implemented' (the resolver's default state).
    reUpsert('implemented', 2000);

    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('verified');
    expect(link.driftAxis).toBeNull();
    expect(link.specHashAtLink).toBe(SPEC_HASH);
  });

  it('A2: preserved link still refreshes resolved node, signature, metadata, updated_at', () => {
    const id = seedLink('verified', 1000);
    // Equal confidence so the confidence gate passes through to the UPDATE —
    // the guard preserves state but everything else is current.
    reUpsert('implemented', 2000, {
      resolvedNodeId: 'node-v2',
      nodeSigAtLink: 'auth(user, opts)',
      metadata: { via: 'reextract' },
    });

    const link = sq.getLinkById(id)!;
    // State preserved...
    expect(link.state).toBe('verified');
    // ...but the current-ness fields refreshed.
    expect(link.resolvedNodeId).toBe('node-v2');
    expect(link.nodeSigAtLink).toBe('auth(user, opts)');
    expect(link.metadata).toEqual({ via: 'reextract' });
    expect(link.updatedAt).toBe(2000);
  });

  it('A3: a broken link is preserved identically', () => {
    const id = seedLink('broken', 1000);
    reUpsert('implemented', 2000, { resolvedNodeId: 'node-v2' });

    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('broken');
    expect(link.resolvedNodeId).toBe('node-v2'); // still refreshed
  });

  it('A4: a non-sticky (implemented) link is still overwritten', () => {
    const id = seedLink('implemented', 1000);
    reUpsert('drifted', 2000);

    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('drifted'); // guard does not apply
  });

  it('negative: sticky link re-upsert with a CHANGED spec hash downgrades (legit drift path)', () => {
    const id = seedLink('verified', 1000);
    reUpsert('implemented', 2000, { specHashAtLink: 'spec-hash-v2' });

    const link = sq.getLinkById(id)!;
    expect(link.state).toBe('implemented'); // hash moved → downgrade proceeds
    expect(link.specHashAtLink).toBe('spec-hash-v2');
  });
});
