/**
 * Link-lifecycle end-to-end integration test (REQ-TVIZ-003).
 *
 * The acceptance check for the durability contract in VSTATE-DOC: a spec link
 * is a promise about code, and a promise that a re-index can silently delete is
 * worth nothing. Real temp project, real SQLite, real index/sync runs — no
 * mocking, because the failure this guards against (an `ON DELETE CASCADE`
 * firing during re-extraction) only exists at the database layer.
 *
 * Written against the acceptance criteria, not against the implementation:
 * these tests do not care HOW links survive re-extraction, only that they do.
 *
 * Covers both link provenances (A3):
 *   - the `implementations:`-block declaration, re-created from the file on
 *     every pass, and
 *   - the agent-asserted link, which exists ONLY as a database row and is the
 *     one a destructive re-extract loses forever.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../../src/index';
import type { SpecLink } from '../../src/types';

const SPEC_FILE = 'specs/payments.md';

/** The spec under test. `body` varies so we can move its content hash. */
function specSource(prose: string): string {
  return `---
id: PAY-DOC
title: Payments
---
<!-- id: PAY-DOC -->
# Payments

<!-- id: REQ-PAY-001 -->
## Refunds MUST be idempotent

${prose}

implementations:
  - src/refund.ts:refund

## Acceptance
<!-- id: REQ-PAY-001.A1 -->
- A repeated refund of the same charge MUST NOT move money twice.
`;
}

/** The code the spec points at. `signature` varies to move the node signature. */
function refundSource(params: string): string {
  return `export function refund(${params}) {\n  return { ok: true };\n}\n`;
}

function writeProject(root: string, prose: string, params: string): void {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'refund.ts'), refundSource(params));
  fs.writeFileSync(path.join(root, SPEC_FILE), specSource(prose));
}

describe('Integration: spec-link lifecycle (REQ-TVIZ-003)', () => {
  let dir: string;
  let cg: SpecShip;

  /** Every link on the requirement, newest lookup each time (no stale rows). */
  const links = (): SpecLink[] => cg.getSpecQueries().getLinksBySpec('REQ-PAY-001');
  const declared = (): SpecLink | undefined =>
    links().find((l) => l.provenance === 'spec-declaration' && l.kind === 'implements');
  const asserted = (): SpecLink | undefined =>
    links().find((l) => l.provenance === 'agent-asserted');

  /**
   * The agent path: a `tests`-kind link recorded straight into the database
   * with no declaration anywhere in the spec file (A3's second variant). Kind
   * `tests` on purpose — an `implements` assertion gets written back into the
   * file by the MCP tool, which would make the file able to re-create it and
   * defeat the point of the check.
   */
  function assertAgentLink(state: SpecLink['state'] = 'implemented'): number {
    const sq = cg.getSpecQueries();
    const spec = sq.getSpecById('REQ-PAY-001')!;
    const node = cg
      .getSpecLinkResolver()
      .findLogicalTarget('src/refund.ts', 'refund', 'function');
    expect(node, 'the target symbol must be indexed before asserting').not.toBeNull();
    const now = Date.now();
    return sq.upsertSpecLink({
      specId: 'REQ-PAY-001',
      targetFilePath: 'src/refund.ts',
      targetQualifiedName: 'refund',
      targetNodeKind: 'function',
      resolvedNodeId: node!.id,
      kind: 'tests',
      state,
      driftAxis: null,
      specHashAtLink: spec.contentHash,
      nodeSigAtLink: node!.signature,
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-linklife-'));
    writeProject(dir, 'Refunds are idempotent by charge id.', 'chargeId: string');
    cg = await SpecShip.init(dir, {});
    await cg.indexAll();
  });

  afterEach(() => {
    try {
      cg?.destroy();
    } catch {
      /* a destroy fault must not mask the assertion failure */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ───────────────────────────── A1 ─────────────────────────────

  it('both link variants exist after the first index (REQ-TVIZ-003.A3)', () => {
    expect(declared(), 'the implementations: block must create a link').toBeDefined();
    expect(declared()!.state).toBe('implemented');
    expect(declared()!.resolvedNodeId).toBeTruthy();

    assertAgentLink();
    expect(asserted(), 'the agent-asserted link must be recorded').toBeDefined();
    expect(asserted()!.kind).toBe('tests');
  });

  it('an agent-asserted link survives a full re-index of an unchanged spec (REQ-TVIZ-003.A1, REQ-VSTATE-001.A4)', async () => {
    const linkId = assertAgentLink('verified');
    expect(asserted()!.state).toBe('verified');

    await cg.indexAll();

    const after = asserted();
    expect(after, 'the agent-asserted link must survive a full index').toBeDefined();
    expect(after!.id).toBe(linkId);
    expect(after!.state).toBe('verified');
    expect(after!.provenance).toBe('agent-asserted');
  });

  it('an agent-asserted link survives a full index that RE-EXTRACTS the spec (REQ-TVIZ-003.A1)', async () => {
    // The test above is satisfied by the content-hash guard skipping the file
    // (REQ-VSTATE-001.A4 — legitimate, but it never enters the destructive
    // path). Moving the file's content forces the re-extract that used to
    // cascade the links away, and does it under a FULL index rather than sync.
    const linkId = assertAgentLink('verified');
    const bodyBefore = cg.getSpecQueries().getSpecById('REQ-PAY-001')!.body;

    fs.writeFileSync(
      path.join(dir, SPEC_FILE),
      specSource('Refunds are idempotent by charge id. Replays are safe.')
    );
    await cg.indexAll();

    // Prove the re-extraction actually happened before trusting the survival.
    expect(cg.getSpecQueries().getSpecById('REQ-PAY-001')!.body).not.toBe(bodyBefore);

    const after = asserted();
    expect(after, 'a re-extracted spec must not lose its agent-asserted link').toBeDefined();
    expect(after!.id).toBe(linkId);
    expect(after!.provenance).toBe('agent-asserted');
  });

  it('a declared link survives a full re-index with its state preserved (REQ-TVIZ-003.A1/A3)', async () => {
    const before = declared()!;
    await cg.indexAll();
    const after = declared();
    expect(after).toBeDefined();
    expect(after!.id).toBe(before.id);
    expect(after!.state).toBe('implemented');
  });

  it('editing the spec prose leaves both links alive after a sync (REQ-TVIZ-003.A1)', async () => {
    const assertedId = assertAgentLink();
    const declaredId = declared()!.id;

    // Same ids, different prose — the ordinary authoring edit.
    fs.writeFileSync(
      path.join(dir, SPEC_FILE),
      specSource('Refunds are idempotent by charge id. Retries are safe to replay.')
    );
    await cg.sync();

    expect(asserted(), 'a prose edit must not delete the agent-asserted link').toBeDefined();
    expect(asserted()!.id).toBe(assertedId);
    expect(declared(), 'a prose edit must not delete the declared link').toBeDefined();
    expect(declared()!.id).toBe(declaredId);
  });

  it('a verified link on an edited spec becomes drifted(spec), not a fresh implemented (REQ-TVIZ-003.A1, REQ-VSTATE-001.A2)', async () => {
    assertAgentLink('verified');

    fs.writeFileSync(
      path.join(dir, SPEC_FILE),
      specSource('Refunds are idempotent by charge id AND by idempotency key.')
    );
    await cg.sync();

    const after = asserted();
    expect(after, 'the link must still exist to be able to drift').toBeDefined();
    expect(after!.state).toBe('drifted');
    expect(after!.driftAxis).toBe('spec');
  });

  it('removing a spec id from the file removes that spec and its links (REQ-VSTATE-001.A3)', async () => {
    assertAgentLink();
    expect(links().length).toBeGreaterThan(0);

    // The requirement is gone; only the document heading remains.
    fs.writeFileSync(
      path.join(dir, SPEC_FILE),
      `---\nid: PAY-DOC\ntitle: Payments\n---\n<!-- id: PAY-DOC -->\n# Payments\n\nNothing here now.\n`
    );
    await cg.sync();

    expect(cg.getSpecQueries().getSpecById('REQ-PAY-001')).toBeNull();
    expect(links(), 'a deleted requirement must not leave orphan link rows').toHaveLength(0);
  });

  // ───────────────────────────── A2 ─────────────────────────────

  it('mutating the target signature drifts the link to drifted(code) (REQ-TVIZ-003.A2)', async () => {
    const declaredBefore = declared()!;
    expect(declaredBefore.state).toBe('implemented');
    assertAgentLink();

    fs.writeFileSync(
      path.join(dir, 'src', 'refund.ts'),
      refundSource('chargeId: string, idempotencyKey: string')
    );
    await cg.sync();

    const after = declared();
    expect(after, 'the link must survive the code edit to be able to drift').toBeDefined();
    expect(after!.state).toBe('drifted');
    expect(after!.driftAxis).toBe('code');
  });

  it('re-verifying a drifted(code) link restores it to verified (REQ-TVIZ-003.A2)', async () => {
    fs.writeFileSync(
      path.join(dir, 'src', 'refund.ts'),
      refundSource('chargeId: string, idempotencyKey: string')
    );
    await cg.sync();

    const drifted = declared()!;
    expect(drifted.state).toBe('drifted');
    expect(drifted.driftAxis).toBe('code');

    // The repair an agent performs after re-reading the spec: adopt the current
    // signature as the new baseline and record the verdict.
    const sq = cg.getSpecQueries();
    const node = cg.getSpecLinkResolver().findLogicalTarget('src/refund.ts', 'refund', 'function');
    sq.updateSpecLinkState(drifted.id, 'verified', null);
    sq.updateSpecLinkResolution(drifted.id, node!.id);
    sq.upsertSpecLink({
      ...drifted,
      state: 'verified',
      driftAxis: null,
      nodeSigAtLink: node!.signature,
      updatedAt: Date.now(),
    });

    const repaired = declared()!;
    expect(repaired.state).toBe('verified');
    expect(repaired.driftAxis).toBeFalsy();

    // And the repair holds: a further re-resolve must not re-drift it.
    cg.getSpecLinkResolver().resolveAll();
    const settled = declared()!;
    expect(settled.state).toBe('verified');
  });

  it('a repaired link still survives a subsequent full index (REQ-TVIZ-003.A1/A2)', async () => {
    const id = assertAgentLink('verified');

    await cg.indexAll();
    await cg.indexAll();

    const after = asserted();
    expect(after).toBeDefined();
    expect(after!.id).toBe(id);
    expect(after!.state).toBe('verified');
  });
});
