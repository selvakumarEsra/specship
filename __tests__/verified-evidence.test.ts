import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SpecShip from '../src';
import { MarkdownSpecExtractor } from '../src/extraction/specs/markdown-spec-extractor';
import { handleSpecshipLinkVerify, handleSpecshipSpec } from '../src/mcp/spec-tools';

/**
 * VERIFY-EVID-DOC (specs/verified-evidence.md): `verified` requires declared,
 * passing test evidence. Evidence is a kind='tests' link from a `verifies:`
 * block or an `@verifies REQ-X` comment on the test symbol.
 */

const SPEC = `---
id: EV-DOC
---

<!-- id: EV-DOC -->
# Evidence demo

<!-- id: REQ-EV-001 -->
## Thing MUST work

Body.

implementations:
  - src/thing.ts:doThing

verifies:
  - tests/thing.test.ts:testDoThing

<!-- id: REQ-EV-002 -->
## Other thing MUST also work

No verifies block here — evidence comes from the @verifies comment.

implementations:
  - src/thing.ts:doOther

<!-- id: REQ-EV-003 -->
## Unevidenced thing MUST NOT be promotable

Body.

implementations:
  - src/thing.ts:doThird
`;

describe('verifies: block extraction (REQ-VEVID-001.A1)', () => {
  it('emits a kind=tests candidate per bullet, alongside implements', () => {
    const { linkCandidates } = new MarkdownSpecExtractor('specs/ev.md', SPEC).extract();
    const ev = linkCandidates.filter((c) => c.kind === 'tests');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      specId: 'REQ-EV-001',
      targetFilePath: 'tests/thing.test.ts',
      targetQualifiedName: 'testDoThing',
    });
    // implementations still parse for all three REQs.
    expect(linkCandidates.filter((c) => c.kind === 'implements')).toHaveLength(3);
  });
});

/** FTS5 availability probe (same pattern as the other DB suites). */
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
  } catch { /* Node < 22.5 */ }
  return false;
})();

describe.skipIf(!fts5Available)('evidence gate end-to-end (REQ-VEVID-001/002)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-evidence-'));
    fs.mkdirSync(path.join(dir, 'specs'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'specs', 'ev.md'), SPEC, 'utf-8');
    fs.writeFileSync(
      path.join(dir, 'src', 'thing.ts'),
      'export function doThing() { return 1; }\nexport function doOther() { return 2; }\nexport function doThird() { return 3; }\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(dir, 'tests', 'thing.test.ts'),
      '/** @verifies REQ-EV-002 */\nexport function testDoOther() { return true; }\n\nexport function testDoThing() { return true; }\n',
      'utf-8'
    );
    cg = await SpecShip.init(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('A1+A3: the verifies: block produces a tests link that survives a full reindex', async () => {
    const before = cg.getSpecQueries().getLinksBySpec('REQ-EV-001').filter((l) => l.kind === 'tests');
    expect(before.length).toBeGreaterThanOrEqual(1);
    await cg.indexAll();
    const after = cg.getSpecQueries().getLinksBySpec('REQ-EV-001').filter((l) => l.kind === 'tests');
    expect(after.length).toBeGreaterThanOrEqual(1);
  });

  it('A2: an @verifies comment on the test symbol produces a tests link', () => {
    const ev = cg.getSpecQueries().getLinksBySpec('REQ-EV-002').filter((l) => l.kind === 'tests');
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev[0].targetFilePath).toContain('thing.test.ts');
  });

  it('002.A2: pass on an evidence-less spec is refused with the missing-evidence reason', async () => {
    const impl = cg.getSpecQueries().getLinksBySpec('REQ-EV-003').find((l) => l.kind === 'implements');
    expect(impl).toBeDefined();
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).toContain('no test evidence');
    // State unchanged — still implemented, not verified.
    expect(cg.getSpecQueries().getLinkById(impl!.id)!.state).not.toBe('verified');
  });

  it('002.A1: pass on an evidenced spec promotes to verified', async () => {
    const impl = cg.getSpecQueries().getLinksBySpec('REQ-EV-001').find((l) => l.kind === 'implements');
    expect(impl).toBeDefined();
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).toContain('verified');
    expect(cg.getSpecQueries().getLinkById(impl!.id)!.state).toBe('verified');
  });

  it('003.A1: the spec detail flags an unevidenced implemented spec', async () => {
    const res = await handleSpecshipSpec(cg, { spec_id: 'REQ-EV-003' });
    expect(JSON.stringify(res)).toContain('No test evidence');
    const evidenced = await handleSpecshipSpec(cg, { spec_id: 'REQ-EV-001' });
    expect(JSON.stringify(evidenced)).not.toContain('No test evidence');
  });
});
