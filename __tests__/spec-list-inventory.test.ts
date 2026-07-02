/**
 * `specship_spec` list mode (REQ-FUNNEL-007): `list: true` returns the flat spec
 * inventory — every requirement grouped by its document with exactly ONE derived
 * lifecycle status, unlinked briefs as ideas, and a per-status totals line.
 *
 * The status is derived from the requirement's own spec→code links PLUS the
 * links of its acceptance children, with degraded states winning so a stale /
 * broken implementation is never reported as done (A: never overstate).
 *
 * Skipped where the system SQLite lacks FTS5 (same pattern as the resolver suite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { handleSpecshipSpec } from '../src/mcp/spec-tools';
import { Spec, SpecLink, SpecLinkState } from '../src/types';

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

/** The `[status]` rendered on a requirement's inventory row, or null if absent. */
function statusOf(out: string, id: string): string | null {
  const line = out.split('\n').find((l) => l.trimStart().startsWith(`- ${id} `));
  if (!line) return null;
  const m = line.match(/\[([a-z-]+)\]\s*$/);
  return m ? m[1] : null;
}

describe.skipIf(!fts5Available)('specship_spec — list mode (REQ-FUNNEL-007)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-list-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(async () => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function insertSpec(partial: Partial<Spec> & Pick<Spec, 'id' | 'title'>): void {
    const now = Date.now();
    cg.getSpecQueries().insertSpec({
      kind: 'requirement',
      format: 'markdown',
      body: '',
      sourcePath: 'specs/status.md',
      contentHash: partial.id,
      createdAt: now,
      updatedAt: now,
      ...partial,
    });
  }

  /** Attach one spec→code link in a given state (unique target per call). */
  function linkSpec(specId: string, state: SpecLinkState, name: string): void {
    const now = Date.now();
    const link: Omit<SpecLink, 'id'> = {
      specId,
      targetFilePath: 'src/impl.ts',
      targetQualifiedName: `${specId}.${name}`,
      targetNodeKind: 'function',
      kind: 'implements',
      state,
      driftAxis: null,
      specHashAtLink: 'h',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    };
    cg.getSpecQueries().upsertSpecLink(link);
  }

  /**
   * One document with a requirement per derivation branch plus the two
   * "never overstate" edge cases and one acceptance-child aggregation case.
   * Statuses: authored / in-progress / implemented / verified / needs-attention
   * across 8 requirements → totals 1 / 2 / 1 / 1 / 3.
   */
  function seedStatusDoc(): void {
    insertSpec({ id: 'STATUS-DOC', kind: 'document', title: 'Status doc' });

    const req = (id: string, title: string) =>
      insertSpec({ id, kind: 'requirement', title, parentId: 'STATUS-DOC' });

    // 1. authored — no links.
    req('REQ-S-AUTHORED', 'Authored requirement');

    // 2. in-progress — a lone drafted link.
    req('REQ-S-INPROGRESS', 'In-progress requirement');
    linkSpec('REQ-S-INPROGRESS', 'drafted', 'a');

    // 3. implemented — a declared (not-yet-verified) link.
    req('REQ-S-IMPL', 'Implemented requirement');
    linkSpec('REQ-S-IMPL', 'implemented', 'a');

    // 4. verified — all links verified.
    req('REQ-S-VERIFIED', 'Verified requirement');
    linkSpec('REQ-S-VERIFIED', 'verified', 'a');

    // 5. needs-attention — a drifted link.
    req('REQ-S-ATTENTION', 'Attention requirement');
    linkSpec('REQ-S-ATTENTION', 'drifted', 'a');

    // 6. mix never overstates — implemented + drafted ⇒ in-progress, NOT implemented.
    req('REQ-S-MIX', 'Mixed requirement');
    linkSpec('REQ-S-MIX', 'implemented', 'a');
    linkSpec('REQ-S-MIX', 'drafted', 'b');

    // 7. one degraded link wins — implemented + verified + broken ⇒ needs-attention.
    req('REQ-S-DEGRADEDWINS', 'Degraded-wins requirement');
    linkSpec('REQ-S-DEGRADEDWINS', 'implemented', 'a');
    linkSpec('REQ-S-DEGRADEDWINS', 'verified', 'b');
    linkSpec('REQ-S-DEGRADEDWINS', 'broken', 'c');

    // 8. acceptance-child aggregation — requirement implemented, but an
    //    acceptance criterion's link is orphaned ⇒ needs-attention.
    req('REQ-S-ACCEPTAGG', 'Acceptance-aggregation requirement');
    linkSpec('REQ-S-ACCEPTAGG', 'implemented', 'a');
    insertSpec({
      id: 'REQ-S-ACCEPTAGG.A1',
      kind: 'acceptance',
      title: 'A criterion',
      parentId: 'REQ-S-ACCEPTAGG',
    });
    linkSpec('REQ-S-ACCEPTAGG.A1', 'orphaned', 'a');
  }

  // ---- A: each requirement carries exactly one status; every branch asserted

  it('derives exactly one status per requirement across every branch', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));

    expect(statusOf(out, 'REQ-S-AUTHORED')).toBe('authored');
    expect(statusOf(out, 'REQ-S-INPROGRESS')).toBe('in-progress');
    expect(statusOf(out, 'REQ-S-IMPL')).toBe('implemented');
    expect(statusOf(out, 'REQ-S-VERIFIED')).toBe('verified');
    expect(statusOf(out, 'REQ-S-ATTENTION')).toBe('needs-attention');
  });

  it('a mix of implemented + drafted never overstates — reports in-progress', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));
    expect(statusOf(out, 'REQ-S-MIX')).toBe('in-progress');
  });

  it('a single degraded link wins over implemented + verified', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));
    expect(statusOf(out, 'REQ-S-DEGRADEDWINS')).toBe('needs-attention');
  });

  it('aggregates acceptance-child links into the requirement status', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));
    // Requirement itself is implemented; its orphaned acceptance criterion
    // degrades the rolled-up status.
    expect(statusOf(out, 'REQ-S-ACCEPTAGG')).toBe('needs-attention');
    // The acceptance criterion is NOT itself a top-level inventory row.
    expect(statusOf(out, 'REQ-S-ACCEPTAGG.A1')).toBeNull();
  });

  // ---- per-status totals + header

  it('renders a correct per-status totals line and header counts', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));

    expect(out).toContain('# Spec inventory');
    expect(out).toContain('**ideas** 0 · **documents** 1 · **requirements** 8');

    expect(out).toContain('## Totals');
    expect(out).toContain('- authored 1');
    expect(out).toContain('- in-progress 2');
    expect(out).toContain('- implemented 1');
    expect(out).toContain('- verified 1');
    expect(out).toContain('- needs-attention 3');
  });

  it('groups requirements under their document heading', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));
    expect(out).toContain('## Documents');
    expect(out).toContain('### STATUS-DOC — Status doc');
  });

  // ---- unlinked briefs appear as ideas

  it('lists unlinked briefs as ideas', async () => {
    seedStatusDoc();
    insertSpec({
      id: 'BRIEF-IDEA',
      kind: 'brief',
      title: 'A shiny idea',
      sourcePath: 'specs/idea/brief.md',
    });
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));

    expect(out).toContain('## Ideas (unlinked briefs)');
    expect(out).toContain('- BRIEF-IDEA — A shiny idea  [idea]');
    // The idea count in the header reflects the brief.
    expect(out).toContain('**ideas** 1 ·');
  });

  // ---- requirements with no document parent → Ungrouped

  it('places requirements without a document parent under Ungrouped', async () => {
    insertSpec({ id: 'REQ-LOOSE', kind: 'requirement', title: 'A loose requirement' });
    linkSpec('REQ-LOOSE', 'verified', 'a');
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));

    expect(out).toContain('## Ungrouped requirements');
    expect(statusOf(out, 'REQ-LOOSE')).toBe('verified');
    // Counted in the totals despite having no document.
    expect(out).toContain('- verified 1');
    expect(out).toContain('**ideas** 0 · **documents** 0 · **requirements** 1');
  });

  it('renders a document with no requirements without crashing', async () => {
    insertSpec({ id: 'EMPTY-DOC', kind: 'document', title: 'Empty doc' });
    const out = textOf(await handleSpecshipSpec(cg, { list: true }));
    expect(out).toContain('### EMPTY-DOC — Empty doc');
    expect(out).toContain('_No requirements yet._');
  });

  // ---- empty project → clean empty listing, not an error

  it('returns a clean empty inventory on an empty project, not an error', async () => {
    const result = await handleSpecshipSpec(cg, { list: true });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain('# Spec inventory');
    expect(out).toContain('No specs or briefs yet');
  });

  // ---- regression: existing modes are untouched by the new code path

  it('the no-arg funnel is unchanged — never the inventory', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, {}));
    expect(out).toContain('Spec lifecycle funnel');
    expect(out).not.toContain('Spec inventory');
  });

  it('spec_id detail is unchanged — never the inventory', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'STATUS-DOC' }));
    expect(out).toContain('# STATUS-DOC — Status doc');
    expect(out).toContain('## Body');
    expect(out).not.toContain('Spec inventory');
  });

  it('a free-text query takes precedence over list — still runs search', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { query: 'status', list: true }));
    expect(out).toContain('Spec search — "status"');
    expect(out).not.toContain('Spec inventory');
  });

  it('list defaults off — a non-boolean list falls through to the funnel', async () => {
    seedStatusDoc();
    const out = textOf(await handleSpecshipSpec(cg, { list: 'yes' as unknown as boolean }));
    expect(out).toContain('Spec lifecycle funnel');
    expect(out).not.toContain('Spec inventory');
  });
});
