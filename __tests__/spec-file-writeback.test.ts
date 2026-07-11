import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SpecShip from '../src';
import { addImplementationToSpecSource } from '../src/extraction/specs/spec-file-writeback';
import { MarkdownSpecExtractor } from '../src/extraction/specs/markdown-spec-extractor';
import { handleSpecshipLinkAssert } from '../src/mcp/spec-tools';

/**
 * REQ-LINKWB-001 (specs/spec-link-writeback.md): `link_assert` persists the
 * assertion into the spec file's `implementations:` block — idempotently,
 * creating the block when absent — so a full reindex rebuilds the link from
 * the file (REQ-LINKWB-002).
 */

const SPEC_WITH_BLOCK = `---
id: AUTH-DOC
---

<!-- id: AUTH-DOC -->
# Authentication

Doc body.

<!-- id: REQ-AUTH-001 -->
## Failed logins MUST be rate-limited

The login endpoint rejects more than 5 failed attempts.

implementations:
  - src/auth/login.ts:authenticate

## Acceptance
<!-- id: REQ-AUTH-001.A1 -->
- A 6th failed attempt returns 429.

<!-- id: REQ-AUTH-002 -->
## Sessions MUST expire

Body of the second requirement.
`;

describe('addImplementationToSpecSource (REQ-LINKWB-001)', () => {
  it('A1: appends a new bullet to an existing implementations: block', () => {
    const res = addImplementationToSpecSource(
      SPEC_WITH_BLOCK, 'REQ-AUTH-001', 'src/auth/rate-limit.ts', 'enforce');
    expect(res.changed).toBe(true);
    expect(res.source).toContain('  - src/auth/login.ts:authenticate\n  - src/auth/rate-limit.ts:enforce');
    // The neighboring requirement is untouched.
    expect(res.source).toContain('Body of the second requirement.');
  });

  it('A2: re-asserting an already-listed target leaves the file byte-identical', () => {
    const res = addImplementationToSpecSource(
      SPEC_WITH_BLOCK, 'REQ-AUTH-001', 'src/auth/login.ts', 'authenticate');
    expect(res.changed).toBe(false);
    expect(res.reason).toBe('already-present');
    expect(res.source).toBe(SPEC_WITH_BLOCK);
  });

  it('A3: creates the block in-place when absent, before the Acceptance heading', () => {
    const res = addImplementationToSpecSource(
      SPEC_WITH_BLOCK, 'REQ-AUTH-002', 'src/auth/session.ts', 'SessionStore.expire');
    expect(res.changed).toBe(true);
    const section = res.source.slice(res.source.indexOf('REQ-AUTH-002'));
    expect(section).toContain('implementations:\n  - src/auth/session.ts:SessionStore.expire');
    // Insertion happened inside REQ-AUTH-002's section, after its body prose.
    expect(section.indexOf('Body of the second requirement.'))
      .toBeLessThan(section.indexOf('implementations:'));
  });

  it('A3: a block created above an Acceptance heading stays inside the right section', () => {
    const withAcceptance = SPEC_WITH_BLOCK.replace(
      'implementations:\n  - src/auth/login.ts:authenticate\n\n',
      ''
    );
    const res = addImplementationToSpecSource(
      withAcceptance, 'REQ-AUTH-001', 'src/auth/login.ts', 'authenticate');
    expect(res.changed).toBe(true);
    const idx = res.source.indexOf('implementations:');
    expect(idx).toBeGreaterThan(res.source.indexOf('rejects more than 5'));
    expect(idx).toBeLessThan(res.source.indexOf('## Acceptance'));
  });

  it('unknown spec id changes nothing and says why', () => {
    const res = addImplementationToSpecSource(SPEC_WITH_BLOCK, 'REQ-NOPE-9', 'a.ts', 'b');
    expect(res.changed).toBe(false);
    expect(res.reason).toBe('spec-id-not-found');
  });

  it('REQ-LINKWB-002.A1: the written block round-trips through the real parser', () => {
    const res = addImplementationToSpecSource(
      SPEC_WITH_BLOCK, 'REQ-AUTH-002', 'src/auth/session.ts', 'SessionStore.expire');
    const { linkCandidates } = new MarkdownSpecExtractor('specs/auth.md', res.source).extract();
    const mine = linkCandidates.filter((i) => i.specId === 'REQ-AUTH-002');
    expect(mine).toHaveLength(1);
    expect(mine[0].targetFilePath).toBe('src/auth/session.ts');
    expect(mine[0].targetQualifiedName).toBe('SessionStore.expire');
    // The pre-existing block still parses too.
    expect(linkCandidates.some((i) => i.specId === 'REQ-AUTH-001' && i.targetQualifiedName === 'authenticate')).toBe(true);
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

describe.skipIf(!fts5Available)('link_assert write-back end-to-end (REQ-LINKWB-001/002)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-writeback-'));
    fs.mkdirSync(path.join(dir, 'specs'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'specs', 'auth.md'), SPEC_WITH_BLOCK, 'utf-8');
    fs.writeFileSync(
      path.join(dir, 'src', 'session.ts'),
      'export class SessionStore {\n  expire(): void {}\n}\n',
      'utf-8'
    );
    cg = await SpecShip.init(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('A1+002.A1: assert writes the file block, and a full reindex rebuilds the link from it', async () => {
    const res = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-AUTH-002',
      target_file_path: 'src/session.ts',
      target_qualified_name: 'SessionStore.expire',
      target_node_kind: 'method',
    });
    expect(JSON.stringify(res)).not.toContain('NOT persisted');

    // The spec FILE gained the bullet (source of truth).
    const onDisk = fs.readFileSync(path.join(dir, 'specs', 'auth.md'), 'utf-8');
    expect(onDisk).toContain('implementations:\n  - src/session.ts:SessionStore.expire');

    // Full reindex — the DB is rebuilt; the link must survive via the file.
    await cg.indexAll();
    const links = cg.getSpecQueries().getLinksBySpec('REQ-AUTH-002');
    expect(
      links.some(
        (l) => l.targetFilePath === 'src/session.ts' && l.targetQualifiedName === 'SessionStore.expire'
      )
    ).toBe(true);
  });

  it('A2: re-asserting leaves the spec file byte-identical', async () => {
    await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-AUTH-002',
      target_file_path: 'src/session.ts',
      target_qualified_name: 'SessionStore.expire',
    });
    const first = fs.readFileSync(path.join(dir, 'specs', 'auth.md'), 'utf-8');
    await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-AUTH-002',
      target_file_path: 'src/session.ts',
      target_qualified_name: 'SessionStore.expire',
    });
    const second = fs.readFileSync(path.join(dir, 'specs', 'auth.md'), 'utf-8');
    expect(second).toBe(first);
  });
});
