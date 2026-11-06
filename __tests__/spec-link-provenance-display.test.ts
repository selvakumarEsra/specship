/**
 * Provenance + confidence on every `specship_spec` link line (REQ-LINKACC-012).
 *
 * A1: each line names where the link came from and how much to trust it —
 *     including a test-title link, stored as `code-comment` but shown as
 *     `test-title`.
 * A2: a link followed across a move (REQ-LINKACC-005) says so in its tag.
 * A3: a link with no recorded confidence shows no figure, and the store keeps
 *     it missing rather than writing a made-up 1.0. The upsert's
 *     "equal or higher wins" comparison still ranks a missing value as 1.0.
 *
 * The formatting checks are pure; the store round-trip needs FTS5 (skipped
 * without it, like the sibling spec suites).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';
import { confidenceRank } from '../src/db/spec-queries';
import { formatLink } from '../src/mcp/spec-tools';
import { linkSourceLabel } from '../src/resolution/link-repoint';
import { formatDriftedLine } from '../src/resolution/signature-drift';
import type { SpecLink, SpecLinkProvenance } from '../src/types';

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

function link(over: Partial<SpecLink> = {}): SpecLink {
  return {
    id: 7,
    specId: 'REQ-X-001',
    targetFilePath: 'src/a.ts',
    targetQualifiedName: 'foo',
    targetNodeKind: 'function',
    resolvedNodeId: 'n1',
    kind: 'implements',
    state: 'implemented',
    driftAxis: null,
    specHashAtLink: 'h',
    provenance: 'spec-declaration',
    confidence: 0.7,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/** The `<…>` tag of a rendered link line. */
function tagOf(line: string): string {
  const m = /<([^>]*)>\s+#\d+/.exec(line);
  return m ? m[1]! : '';
}

describe('specship_spec link provenance and confidence (REQ-LINKACC-012)', () => {
  // One label everywhere: the `specship drifted` line uses linkSourceLabel too.
  function reqLinkacc012DriftedLineSameLabel(): void {
    const drifted = (over: Partial<SpecLink>) =>
      formatDriftedLine({ ...link({ state: 'drifted', driftAxis: 'code', ...over }) });
    const testTitle = { provenance: 'code-comment' as SpecLinkProvenance, kind: 'tests' as const, metadata: { evidenceSource: 'test-title' } };
    expect(drifted(testTitle)).toContain('<test-title>');
    const moved = { metadata: { repointed: { from: { file: 'src/old.ts', name: 'foo' }, to: { file: 'src/a.ts', name: 'foo' }, at: 1 } } };
    expect(drifted(moved)).toContain(`<${linkSourceLabel(link(moved))}>`);
    expect(drifted(moved)).toContain('followed-move');
    expect(drifted({})).toContain('<spec-declaration>');
  }

  function reqLinkacc012A1(): void {
    const cases: Array<[Partial<SpecLink>, string]> = [
      [{ provenance: 'agent-asserted', confidence: 1.0 }, 'agent-asserted (1.00)'],
      [{ provenance: 'code-comment', confidence: 0.9 }, 'code-comment (0.90)'],
      [{ provenance: 'spec-declaration', confidence: 0.7 }, 'spec-declaration (0.70)'],
      [
        {
          provenance: 'code-comment',
          kind: 'tests',
          confidence: 0.9,
          metadata: { evidenceSource: 'test-title', testTitles: ['REQ-X-001.A1: t'] },
        },
        'test-title (0.90)',
      ],
    ];
    for (const [over, want] of cases) {
      expect(tagOf(formatLink(link(over)))).toBe(want);
    }
  }
  it('REQ-LINKACC-012.A1: each link line names its provenance and confidence', reqLinkacc012A1);
  it('REQ-LINKACC-012.A1: specship drifted labels a link the same way specship_spec does', reqLinkacc012DriftedLineSameLabel);

  function reqLinkacc012A2(): void {
    const moved = link({
      targetFilePath: 'src/b.ts',
      targetQualifiedName: 'bar',
      metadata: {
        repointed: { from: { file: 'src/a.ts', name: 'foo' }, to: { file: 'src/b.ts', name: 'bar' }, at: Date.UTC(2026, 10, 6) },
      },
    });
    const out = formatLink(moved);
    expect(tagOf(out)).toBe('followed-move (was spec-declaration) (0.70)');
    expect(out).toContain('↳ re-pointed from src/a.ts:foo (2026-11-06)');
    // A moved test-title link keeps its origin in the wording.
    expect(
      linkSourceLabel({
        provenance: 'code-comment',
        metadata: { evidenceSource: 'test-title', repointed: moved.metadata!.repointed },
      })
    ).toBe('followed-move (was test-title)');
    // A link that never moved does not claim one.
    expect(linkSourceLabel(link())).toBe('spec-declaration');
  }
  it('REQ-LINKACC-012.A2: a re-pointed link shows the followed-across-a-move provenance', reqLinkacc012A2);

  function reqLinkacc012A3(): void {
    expect(tagOf(formatLink(link({ provenance: 'code-comment', confidence: undefined })))).toBe('code-comment');
    // A non-finite value is no recorded confidence either — never "NaN".
    expect(tagOf(formatLink(link({ provenance: 'code-comment', confidence: Number.NaN })))).toBe('code-comment');
    // Ranking alone still treats a missing confidence as 1.0.
    expect(confidenceRank(undefined)).toBe(1);
    expect(confidenceRank(null)).toBe(1);
    expect(confidenceRank(0.7)).toBe(0.7);
  }
  it('REQ-LINKACC-012.A3: a link with no recorded confidence shows no figure', reqLinkacc012A3);
});

describe.skipIf(!fts5Available)('missing confidence round-trips through the store (REQ-LINKACC-012.A3)', () => {
  let dir: string;
  let cg: SpecShip;
  let sq: SpecQueries;

  const SPEC = `---
id: CONF-DOC
title: Confidence demo
---

<!-- id: CONF-DOC -->
# Confidence demo

<!-- id: REQ-CONF-001 -->
## A requirement

Body.
`;

  const row = (provenance: SpecLinkProvenance, confidence: number | undefined) => {
    const now = Date.now();
    return {
      specId: 'REQ-CONF-001',
      targetFilePath: 'src/a.ts',
      targetQualifiedName: 'foo',
      targetNodeKind: 'function' as const,
      kind: 'implements' as const,
      state: 'implemented' as const,
      driftAxis: null,
      specHashAtLink: sq.getSpecById('REQ-CONF-001')!.contentHash,
      provenance,
      confidence,
      createdAt: now,
      updatedAt: now,
    };
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-link-conf-'));
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', 'conf.md'), SPEC, 'utf-8');
    await cg.indexSpecs();
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function reqLinkacc012A3Store(): void {
    // Insert with no confidence → reads back missing, not 1.
    const id = sq.upsertSpecLink(row('code-comment', undefined));
    expect(sq.getLinkById(id)!.confidence).toBeUndefined();

    // Ranking: a missing confidence still ranks as 1.0, so a weaker 0.7
    // signal does not overwrite it…
    sq.upsertSpecLink(row('spec-declaration', 0.7));
    const kept = sq.getLinkById(id)!;
    expect(kept.provenance).toBe('code-comment');
    expect(kept.confidence).toBeUndefined();

    // …while an equal-or-higher one does, and stores its real figure.
    sq.upsertSpecLink(row('agent-asserted', 1.0));
    expect(sq.getLinkById(id)!.confidence).toBe(1);

    // An incoming link with no confidence (ranks 1.0 ≥ 1.0) replaces it and
    // stays missing rather than inheriting or inventing a figure.
    sq.upsertSpecLink(row('code-comment', undefined));
    const after = sq.getLinkById(id)!;
    expect(after.provenance).toBe('code-comment');
    expect(after.confidence).toBeUndefined();
  }
  it(
    'REQ-LINKACC-012.A3: a link stored with no confidence reads back with none, and ranks as 1.0',
    reqLinkacc012A3Store
  );
});
