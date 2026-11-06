/**
 * REQ-LINKACC-005 — an orphaned link follows its symbol across a rename or a
 * move, by its body fingerprint.
 *
 * End to end against a real project: real files, a real index, a real sync.
 * The link comes from the spec's own `implementations:` block (the common
 * case), so these tests also pin the write-back ruling: a re-pointed declared
 * link rewrites its bullet, and a full reindex keeps the link resolved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecLink } from '../src/types';
import { formatLink, handleSpecshipSpec } from '../src/mcp/spec-tools';
import { formatRepointNotices } from '../src/resolution/link-repoint';

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

const SPEC_ID = 'REQ-RP-001';

const SPEC = `---
id: RP-DOC
title: Repoint demo
---

<!-- id: RP-DOC -->
# Repoint demo

<!-- id: ${SPEC_ID} -->
## Totals are summed

The total of a list is the sum of its items.

implementations:
  - src/a.ts:total
`;

/** A body distinct enough that nothing else in the fixture shares it. */
const fn = (name: string): string => `export function ${name}(items: number[]): number {
  let sum = 0;
  for (const i of items) sum += i * 2;
  return sum;
}
`;

const KEEP = `export function keep(): number {
  return 42;
}
`;

describe.skipIf(!fts5Available)('REQ-LINKACC-005 link follows a moved or renamed symbol', () => {
  let dir: string;
  let cg: SpecShip;

  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  };
  const specText = () => fs.readFileSync(path.join(dir, 'specs', 'rp.md'), 'utf-8');
  const links = (): SpecLink[] => cg.getSpecQueries().getLinksBySpec(SPEC_ID).filter((l) => l.kind === 'implements');
  const theLink = (): SpecLink => {
    const ls = links();
    expect(ls).toHaveLength(1);
    return ls[0]!;
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-repoint-'));
    write('src/a.ts', fn('total') + '\n' + KEEP);
    write('src/b.ts', KEEP.replace('keep', 'other').replace('42', '7'));
    write('specs/rp.md', SPEC);
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    const l = theLink();
    expect(l.state).toBe('implemented');
    expect(typeof l.metadata?.bodyFpAtLink).toBe('string');
    // A verified link: the state a re-point must keep.
    cg.getSpecQueries().updateSpecLinkState(l.id, 'verified', null, Date.now());
  });
  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Move `total` unchanged from a.ts to b.ts. */
  const moveToB = () => {
    write('src/a.ts', KEEP);
    write('src/b.ts', KEEP.replace('keep', 'other').replace('42', '7') + '\n' + fn('total'));
  };

  async function reqLinkacc005A1(): Promise<void> {
    const id = theLink().id;
    moveToB();
    const res = await cg.sync();

    const l = theLink();
    expect(l.id).toBe(id);
    expect(l.targetFilePath).toBe('src/b.ts');
    expect(l.targetQualifiedName).toBe('total');
    expect(l.state).toBe('verified');
    expect(l.resolvedNodeId).toBeTruthy();
    expect(l.metadata?.repointed).toMatchObject({
      from: { file: 'src/a.ts', name: 'total' },
      to: { file: 'src/b.ts', name: 'total' },
    });
    expect(res.linkRepoints).toHaveLength(1);
  }

  async function reqLinkacc005A2(): Promise<void> {
    write('src/a.ts', fn('sumAll') + '\n' + KEEP);
    await cg.sync();

    const l = theLink();
    expect(l.targetFilePath).toBe('src/a.ts');
    expect(l.targetQualifiedName).toBe('sumAll');
    expect(l.state).toBe('verified');
    expect(l.resolvedNodeId).toBeTruthy();
    expect(specText()).toContain('  - src/a.ts:sumAll');
    expect(specText()).not.toContain('src/a.ts:total');
  }

  /**
   * A3/A4 start from `implemented`: a `verified` link is sticky and is never
   * orphaned today (only unresolved), and these criteria pin today's outcome.
   */
  const makeImplemented = () =>
    cg.getSpecQueries().updateSpecLinkState(theLink().id, 'implemented', null, Date.now());

  async function reqLinkacc005A3(): Promise<void> {
    makeImplemented();
    write('src/a.ts', KEEP);
    write('src/b.ts', fn('bar') + '\n' + fn('baz'));
    const res = await cg.sync();

    const l = theLink();
    expect(l.state).toBe('orphaned');
    expect(l.targetFilePath).toBe('src/a.ts');
    expect(l.targetQualifiedName).toBe('total');
    expect(l.resolvedNodeId).toBeFalsy();
    expect(l.metadata?.repointed).toBeUndefined();
    expect(res.linkRepoints).toBeUndefined();
    expect(specText()).toBe(SPEC);
  }

  async function reqLinkacc005A4(): Promise<void> {
    makeImplemented();
    write('src/a.ts', KEEP);
    await cg.sync();

    const l = theLink();
    expect(l.state).toBe('orphaned');
    expect(l.targetFilePath).toBe('src/a.ts');
    expect(l.metadata?.repointed).toBeUndefined();
    expect(specText()).toBe(SPEC);
  }

  async function reqLinkacc005A5(): Promise<void> {
    moveToB();
    await cg.sync();

    const line = formatLink(theLink());
    expect(line).toContain('src/b.ts:total');
    expect(line).toMatch(/↳ re-pointed from src\/a\.ts:total \(\d{4}-\d{2}-\d{2}\)/);

    const res = await handleSpecshipSpec(cg, { spec_id: SPEC_ID });
    const out = res.content.map((c) => (c as { text?: string }).text ?? '').join('\n');
    expect(out).toContain('re-pointed from src/a.ts:total');
  }

  async function reqLinkacc005SpecWriteBack(): Promise<void> {
    moveToB();
    const res = await cg.sync();

    // The spec file names the new location, and only it.
    expect(specText()).toContain('  - src/b.ts:total');
    expect(specText()).not.toContain('src/a.ts:total');
    expect(specText()).toBe(SPEC.replace('src/a.ts:total', 'src/b.ts:total'));
    // The sync output names the edit.
    const notices = formatRepointNotices(res.linkRepoints ?? []);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('src/a.ts:total → src/b.ts:total');
    expect(notices[0]).toContain('spec updated');
    expect(notices[0]).toContain('specs/rp.md');
    // Our own bullet edit is not a spec change: no spec drift, state kept.
    expect(res.driftedTransitions ?? []).toHaveLength(0);
    expect(theLink().state).toBe('verified');
    // A later sync sees nothing new.
    const again = await cg.sync();
    expect(again.linkRepoints).toBeUndefined();
    expect(theLink().state).toBe('verified');

    // A full reindex from scratch keeps the link resolved, not orphaned.
    cg.close();
    fs.rmSync(path.join(dir, '.specship'), { recursive: true, force: true });
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    const l = theLink();
    expect(l.targetFilePath).toBe('src/b.ts');
    expect(l.state).toBe('implemented');
    expect(l.resolvedNodeId).toBeTruthy();
  }

  async function reqLinkacc005NoRepointWithoutPass(): Promise<void> {
    // A plain resolve with no prior-node snapshot keeps today's behaviour.
    moveToB();
    await cg.sync();
    const l = theLink();
    write('src/b.ts', KEEP.replace('keep', 'other').replace('42', '7'));
    const stats = cg.getSpecLinkResolver().resolveAll();
    expect(stats.repointed ?? 0).toBe(0);
    expect(cg.getSpecQueries().getLinkById(l.id)!.targetFilePath).toBe('src/b.ts');
  }

  it('REQ-LINKACC-005.A1: moving a linked function unchanged to another file re-points the link and keeps its state', reqLinkacc005A1);
  it('REQ-LINKACC-005.A2: renaming a linked function without changing its body re-points the link to the new name', reqLinkacc005A2);
  it('REQ-LINKACC-005.A3: two new symbols with the matching body leave the link orphaned', reqLinkacc005A3);
  it('REQ-LINKACC-005.A4: a deleted symbol with no match stays orphaned', reqLinkacc005A4);
  it('REQ-LINKACC-005.A5: the re-pointed link shows where it came from in specship_spec', reqLinkacc005A5);
  it('REQ-LINKACC-005: a re-pointed declared link rewrites its spec bullet, sync names the edit, and a full reindex keeps it resolved', reqLinkacc005SpecWriteBack);
  it('REQ-LINKACC-005: a resolve pass with no prior-node snapshot never re-points', reqLinkacc005NoRepointWithoutPass);
});
