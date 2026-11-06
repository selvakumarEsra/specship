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
  it('emits a kind=tests candidate per bullet, alongside implements', function reqVevid001A1() {
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

  it('A1+A3: the verifies: block produces a tests link that survives a full reindex', async function reqVevid001A3() {
    const before = cg.getSpecQueries().getLinksBySpec('REQ-EV-001').filter((l) => l.kind === 'tests');
    expect(before.length).toBeGreaterThanOrEqual(1);
    await cg.indexAll();
    const after = cg.getSpecQueries().getLinksBySpec('REQ-EV-001').filter((l) => l.kind === 'tests');
    expect(after.length).toBeGreaterThanOrEqual(1);
  });

  it('A2: an @verifies comment on the test symbol produces a tests link', function reqVevid001A2() {
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

/**
 * REQ-LINKACC-001 (specs/link-evidence-accuracy.md): the verify gate counts
 * file-derived test evidence on a requirement's own acceptance criteria, not
 * only links on the requirement itself.
 */
const CRIT_SPEC = `---
id: LA-DOC
---

<!-- id: LA-DOC -->
# Criterion evidence demo

<!-- id: REQ-LA-001 -->
## Criterion-evidenced thing MUST be promotable

Body.

implementations:
  - src/la.ts:laOne

## Acceptance
<!-- id: REQ-LA-001.A1 -->
- First criterion.
<!-- id: REQ-LA-001.A2 -->
- Second criterion.

<!-- id: REQ-LA-002 -->
## Unevidenced thing MUST stay refused

Body.

implementations:
  - src/la.ts:laTwo

## Acceptance
<!-- id: REQ-LA-002.A1 -->
- Only criterion.

<!-- id: REQ-LA-003 -->
## Agent-asserted criterion evidence MUST NOT count

Body.

implementations:
  - src/la.ts:laThree

## Acceptance
<!-- id: REQ-LA-003.A1 -->
- Only criterion.
`;

describe.skipIf(!fts5Available)('REQ-LINKACC-001 — criterion-level test evidence', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-linkacc-'));
    fs.mkdirSync(path.join(dir, 'specs'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'specs', 'la.md'), CRIT_SPEC, 'utf-8');
    fs.writeFileSync(
      path.join(dir, 'src', 'la.ts'),
      'export function laOne() { return 1; }\nexport function laTwo() { return 2; }\nexport function laThree() { return 3; }\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(dir, 'tests', 'la.test.ts'),
      "import { it } from 'vitest';\nit('REQ-LA-001.A1: first criterion holds', () => {});\nit('REQ-LA-001.A2: second criterion holds', () => {});\n",
      'utf-8'
    );
    cg = await SpecShip.init(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const implOf = (specId: string) =>
    cg.getSpecQueries().getLinksBySpec(specId).find((l) => l.kind === 'implements');

  it('REQ-LINKACC-001.A1: criterion test-title evidence promotes the requirement to verified', async function reqLinkacc001A1() {
    const sq = cg.getSpecQueries();
    // No tests links on the requirement itself…
    expect(sq.getLinksBySpec('REQ-LA-001').filter((l) => l.kind === 'tests')).toHaveLength(0);
    // …but file-derived ones on its criteria.
    expect(sq.getLinksBySpec('REQ-LA-001.A1').filter((l) => l.kind === 'tests').length).toBeGreaterThanOrEqual(1);
    const impl = implOf('REQ-LA-001');
    expect(impl).toBeDefined();
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).not.toContain('no test evidence');
    expect(sq.getLinkById(impl!.id)!.state).toBe('verified');
  });

  it('REQ-LINKACC-001.A2: no evidence on the requirement or its criteria is still refused', async function reqLinkacc001A2() {
    const impl = implOf('REQ-LA-002');
    expect(impl).toBeDefined();
    const before = cg.getSpecQueries().getLinkById(impl!.id)!.state;
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).toContain('no test evidence is linked to it');
    expect(cg.getSpecQueries().getLinkById(impl!.id)!.state).toBe(before);
    expect(cg.getSpecQueries().getLinkById(impl!.id)!.state).not.toBe('verified');
  });

  it('REQ-LINKACC-001.A3: an agent-asserted tests link on a criterion does not count', async function reqLinkacc001A3() {
    const sq = cg.getSpecQueries();
    const crit = sq.getSpecById('REQ-LA-003.A1');
    expect(crit).toBeDefined();
    const now = Date.now();
    sq.upsertSpecLink({
      specId: 'REQ-LA-003.A1',
      targetFilePath: 'tests/la.test.ts',
      targetQualifiedName: 'tests/la.test.ts',
      targetNodeKind: 'file',
      kind: 'tests',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: crit!.contentHash,
      provenance: 'agent-asserted',
      confidence: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(sq.getLinksBySpec('REQ-LA-003.A1').some((l) => l.kind === 'tests' && l.provenance === 'agent-asserted')).toBe(true);
    const impl = implOf('REQ-LA-003');
    expect(impl).toBeDefined();
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).toContain('no test evidence is linked to it');
    expect(sq.getLinkById(impl!.id)!.state).not.toBe('verified');
  });
});

// A requirement written as an H1 can hold another requirement (H2) as its
// child: the only way a requirement has a child that is not an acceptance
// criterion (the extractor makes every H3+ under an H2 an acceptance).
const NESTED_SPEC = `---
id: LC-DOC
title: Nested requirements
---

<!-- id: REQ-LB-001 -->
# Parent requirement MUST be gated on its own criteria

implementations:
  - src/lb.ts:lbOne

<!-- id: REQ-LB-SUB-001 -->
## Nested requirement MUST keep its evidence to itself

implementations:
  - src/lb.ts:lbSub
`;

const LOOKALIKE_SPEC = `---
id: LB-DOC
title: Look-alike ids
---

<!-- id: LB-DOC -->
# Look-alike ids

<!-- id: REQ-LB-002 -->
## Short-id requirement MUST NOT borrow a look-alike's evidence

implementations:
  - src/lb.ts:lbTwo

## Acceptance
<!-- id: REQ-LB-002.A1 -->
- Short criterion.

<!-- id: REQ-LB-0020 -->
## Look-alike requirement with evidence

implementations:
  - src/lb.ts:lbTwenty

## Acceptance
<!-- id: REQ-LB-0020.A1 -->
- Look-alike criterion.
`;

describe.skipIf(!fts5Available)('REQ-LINKACC-001 — evidence gathering is scoped to the requirement’s own criteria', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-linkacc-edge-'));
    for (const d of ['specs', 'src', 'tests']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'specs', 'lc.md'), NESTED_SPEC, 'utf-8');
    fs.writeFileSync(path.join(dir, 'specs', 'lb.md'), LOOKALIKE_SPEC, 'utf-8');
    fs.writeFileSync(
      path.join(dir, 'src', 'lb.ts'),
      ['lbOne', 'lbSub', 'lbTwo', 'lbTwenty'].map((f) => `export function ${f}() { return 1; }`).join('\n') + '\n',
      'utf-8'
    );
    // Evidence exists only for the nested requirement and for the look-alike.
    fs.writeFileSync(
      path.join(dir, 'tests', 'lb.test.ts'),
      "import { it } from 'vitest';\nit('REQ-LB-SUB-001: nested requirement holds', () => {});\nit('REQ-LB-0020.A1: look-alike criterion holds', () => {});\n",
      'utf-8'
    );
    cg = await SpecShip.init(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const implOf = (specId: string) =>
    cg.getSpecQueries().getLinksBySpec(specId).find((l) => l.kind === 'implements');
  const hasTitleEvidence = (specId: string) =>
    cg.getSpecQueries().getLinksBySpec(specId).some((l) => l.kind === 'tests' && l.metadata?.evidenceSource === 'test-title');

  it('REQ-LINKACC-001.A2: a nested requirement’s evidence does not count for its parent', async function reqLinkacc001NestedRequirementExcluded() {
    const sq = cg.getSpecQueries();
    // Setup is what it claims: the nested spec is a child of REQ-LB-001, is a
    // requirement (not an acceptance criterion), and carries title evidence.
    const nested = sq.getSpecById('REQ-LB-SUB-001');
    expect(nested?.parentId).toBe('REQ-LB-001');
    expect(nested?.kind).toBe('requirement');
    expect(hasTitleEvidence('REQ-LB-SUB-001')).toBe(true);
    expect(sq.getLinksBySpec('REQ-LB-001').some((l) => l.kind === 'tests')).toBe(false);

    const impl = implOf('REQ-LB-001');
    expect(impl).toBeDefined();
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).toContain('no test evidence is linked to it');
    expect(sq.getLinkById(impl!.id)!.state).not.toBe('verified');
  });

  it('REQ-LINKACC-001.A2: a look-alike id’s evidence does not count', async function reqLinkacc001LookalikeIdExcluded() {
    const sq = cg.getSpecQueries();
    expect(hasTitleEvidence('REQ-LB-0020.A1')).toBe(true);
    expect(hasTitleEvidence('REQ-LB-002.A1')).toBe(false);

    const impl = implOf('REQ-LB-002');
    expect(impl).toBeDefined();
    const res = await handleSpecshipLinkVerify(cg, { link_id: impl!.id, result: 'pass' });
    expect(JSON.stringify(res)).toContain('no test evidence is linked to it');
    expect(sq.getLinkById(impl!.id)!.state).not.toBe('verified');

    // The look-alike itself does promote — the fixture's evidence is real.
    const twenty = implOf('REQ-LB-0020');
    const ok = await handleSpecshipLinkVerify(cg, { link_id: twenty!.id, result: 'pass' });
    expect(JSON.stringify(ok)).not.toContain('no test evidence');
    expect(sq.getLinkById(twenty!.id)!.state).toBe('verified');
  });
});
