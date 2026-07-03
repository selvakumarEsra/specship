/**
 * `specship_spec` ideas mode (REQ-IDEAS-002): `ideas: true` returns the ideas
 * review view — exactly the idea-state briefs, each with id, title, age since
 * capture, and labels, from a single call (A1); it closes by naming the
 * promotion hand-off `/specship:spec new <brief-id>` (A3); an empty lane reports
 * cleanly, never an error, pointing at the `idea` capture verb (A4); and the
 * list-mode inventory's Ideas section carries the SAME age + labels so both
 * surfaces agree (A2).
 *
 * Skipped where the system SQLite lacks FTS5 (same pattern as the resolver suite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { handleSpecshipSpec } from '../src/mcp/spec-tools';
import { Spec } from '../src/types';

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
    /* fall through */
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
    /* not available */
  }
  return false;
})();

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

/** The rendered inventory/ideas row for a brief id, or null if absent. */
function rowFor(out: string, id: string): string | null {
  return out.split('\n').find((l) => l.trimStart().startsWith(`- ${id} `)) ?? null;
}

const DAY = 86_400_000;

describe.skipIf(!fts5Available)('specship_spec — ideas mode (REQ-IDEAS-002)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-ideas-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(async () => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function insertSpec(partial: Partial<Spec> & Pick<Spec, 'id' | 'title' | 'kind'>): void {
    const now = Date.now();
    cg.getSpecQueries().insertSpec({
      format: 'markdown',
      body: '',
      sourcePath: 'specs/x/brief.md',
      contentHash: partial.id,
      createdAt: now,
      updatedAt: now,
      ...partial,
    });
  }

  /**
   * Two idea briefs (one comma-`labels`, one singular `label`, one unlabeled),
   * plus a `specified` brief and a `conflict` brief — both non-idea, so both
   * must be excluded from the ideas view. Capture dates are fixed offsets from
   * now so the day-granular age renders deterministically.
   */
  function seedIdeas(): { createdMs: number } {
    // A "specified" target document + a brief that resolves to it.
    insertSpec({ id: 'DOC-A', kind: 'document', title: 'Doc A', sourcePath: 'specs/a.md' });
    insertSpec({
      id: 'brief:specd',
      kind: 'brief',
      title: 'Already specified',
      sourcePath: 'specs/specd/brief.md',
      metadata: { slug: 'specd', spec: 'DOC-A' },
    });

    // A "conflict" brief: brief.spec → DOCX, but DOCY's brief: points back at it.
    insertSpec({ id: 'DOCX', kind: 'document', title: 'Doc X', sourcePath: 'specs/docx.md' });
    insertSpec({
      id: 'DOCY',
      kind: 'document',
      title: 'Doc Y',
      sourcePath: 'specs/docy.md',
      metadata: { brief: 'bd/brief.md' },
    });
    insertSpec({
      id: 'brief:conflict',
      kind: 'brief',
      title: 'Conflicted',
      sourcePath: 'specs/bd/brief.md',
      metadata: { slug: 'conflict', spec: 'DOCX' },
    });

    // Idea briefs — the only entries the view should list.
    const createdMs = Date.now() - (3 * DAY + 60_000); // 3d + 1min ago → "3d"
    insertSpec({
      id: 'brief:perf',
      kind: 'brief',
      title: 'Cache the snapshots',
      sourcePath: 'specs/perf/brief.md',
      metadata: { slug: 'perf', created: createdMs, labels: 'perf, cache' },
    });
    insertSpec({
      id: 'brief:infra',
      kind: 'brief',
      title: 'Move to inotify',
      sourcePath: 'specs/infra/brief.md',
      metadata: { slug: 'infra', created: Date.now() - (20 * DAY + 60_000), label: 'infra' },
    });
    insertSpec({
      id: 'brief:bare',
      kind: 'brief',
      title: 'No metadata idea',
      sourcePath: 'specs/bare/brief.md',
      metadata: { slug: 'bare' },
    });
    return { createdMs };
  }

  // ---- A1: exactly the idea-state briefs, each with id / title / age / labels

  it('lists exactly the idea-state briefs with id, title, age, and labels', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { ideas: true }));

    expect(out).toContain('# Ideas');

    const perf = rowFor(out, 'brief:perf');
    expect(perf).not.toBeNull();
    expect(perf).toContain('Cache the snapshots');
    expect(perf).toContain('3d');
    expect(perf).toContain('perf, cache');

    // Singular `label` renders as its one label; ~20d ago → "2w".
    const infra = rowFor(out, 'brief:infra');
    expect(infra).toContain('2w');
    expect(infra).toContain('infra');

    // Unlabeled / undated idea still lists — age "unknown", labels em-dash.
    const bare = rowFor(out, 'brief:bare');
    expect(bare).toContain('unknown  ·  —');
  });

  it('excludes specified and conflict briefs (only idea-state shown)', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { ideas: true }));
    expect(rowFor(out, 'brief:specd')).toBeNull();
    expect(rowFor(out, 'brief:conflict')).toBeNull();
    // Documents are never idea entries either.
    expect(rowFor(out, 'DOC-A')).toBeNull();
  });

  // ---- A3: closes by naming the promotion hand-off

  it('closes by naming the promotion hand-off /specship:spec new <brief-id>', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { ideas: true }));
    expect(out).toContain('/specship:spec new <brief-id>');
  });

  // ---- A4: empty lane is clean, not an error, points at the capture verb

  it('reports an empty lane cleanly on an empty index — not an error', async () => {
    const result = await handleSpecshipSpec(cg, { ideas: true });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain('# Ideas');
    expect(out).toContain('/specship:spec idea'); // points at the capture verb
  });

  it('reports an empty lane when specs exist but no brief is idea-state', async () => {
    // A specified brief only → zero idea-state briefs.
    insertSpec({ id: 'DOC-A', kind: 'document', title: 'Doc A', sourcePath: 'specs/a.md' });
    insertSpec({
      id: 'brief:specd',
      kind: 'brief',
      title: 'Already specified',
      sourcePath: 'specs/specd/brief.md',
      metadata: { slug: 'specd', spec: 'DOC-A' },
    });
    const result = await handleSpecshipSpec(cg, { ideas: true });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain('/specship:spec idea');
    expect(rowFor(out, 'brief:specd')).toBeNull();
  });

  // ---- A2: the list-mode inventory carries the SAME age + labels

  it('the inventory Ideas section shows the same age + labels as the ideas view', async () => {
    seedIdeas();
    const ideasOut = textOf(await handleSpecshipSpec(cg, { ideas: true }));
    const listOut = textOf(await handleSpecshipSpec(cg, { list: true }));

    // Extract the "·  <age>  ·  <labels>" tail the ideas view rendered and assert
    // the inventory row carries it verbatim — one renderer, both surfaces agree.
    const ideaRow = rowFor(ideasOut, 'brief:perf')!;
    const tail = ideaRow.slice(ideaRow.indexOf('·'));
    expect(tail).toContain('3d');
    expect(tail).toContain('perf, cache');

    const listRow = rowFor(listOut, 'brief:perf')!;
    expect(listRow).toContain('[idea]');
    expect(listRow).toContain(tail);
  });

  // ---- regression: the other modes are untouched by the ideas branch

  it('the no-arg funnel is unchanged — never the ideas view', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, {}));
    expect(out).toContain('Spec lifecycle funnel');
    expect(out).not.toContain('parked, newest first');
  });

  it('a spec_id detail is unchanged — never the ideas view', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'DOC-A' }));
    expect(out).toContain('# DOC-A — Doc A');
    expect(out).not.toContain('parked, newest first');
  });

  it('list takes precedence over ideas', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { list: true, ideas: true }));
    expect(out).toContain('# Spec inventory');
    expect(out).not.toContain('parked, newest first');
  });

  it('a free-text query takes precedence over ideas', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { query: 'cache', ideas: true }));
    expect(out).toContain('Spec search — "cache"');
    expect(out).not.toContain('parked, newest first');
  });

  it('ideas defaults off — a non-boolean ideas falls through to the funnel', async () => {
    seedIdeas();
    const out = textOf(await handleSpecshipSpec(cg, { ideas: 'yes' as unknown as boolean }));
    expect(out).toContain('Spec lifecycle funnel');
    expect(out).not.toContain('parked, newest first');
  });
});
