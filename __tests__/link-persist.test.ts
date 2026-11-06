import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { persistLinkToSpecFile } from '../src/spec-quality/link-persist';

/**
 * REQ-THRU-005 (specs/throughput.md): a link asserted through link_assert is
 * written into the requirement's `implementations:` / `verifies:` block, once,
 * so it survives a full reindex; an unresolvable target never edits the file.
 */

const SPEC = `---
id: DEMO-DOC
title: Demo
---

<!-- id: DEMO-DOC -->
# Demo

<!-- id: REQ-DEMO-001 -->
## Sessions expire

Sessions MUST expire after the idle window.

## Acceptance
<!-- id: REQ-DEMO-001.A1 -->
- An idle session is rejected.

<!-- id: REQ-DEMO-002 -->
## Tokens rotate

Tokens MUST rotate.

implementations:
  - src/token.ts:rotate

## Acceptance
<!-- id: REQ-DEMO-002.A1 -->
- A used token is replaced.
`;

let root: string;
let specPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-persist-'));
  fs.mkdirSync(path.join(root, 'specs'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '__tests__'));
  specPath = path.join(root, 'specs', 'demo.md');
  fs.writeFileSync(specPath, SPEC);
  fs.writeFileSync(
    path.join(root, 'src', 'session.ts'),
    'export class SessionStore {\n  async expire(): Promise<void> {}\n}\n',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'token.ts'),
    'export function rotate() {}\nexport const mint = () => 1;\n',
  );
  fs.writeFileSync(
    path.join(root, '__tests__', 'session.test.ts'),
    "it('REQ-DEMO-001.A1: idle rejected', function idleSessionIsRejected() {});\n",
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('persistLinkToSpecFile — REQ-THRU-005', () => {
  it('REQ-THRU-005.A1: an asserted implements link adds one bullet, creating the block before ## Acceptance', function assertedLinkIsWrittenToSpecBlock() {
    const res = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-001', // a criterion id now writes under the criterion (REQ-LINKACC-011.A3)
      kind: 'implements',
      filePath: 'src/session.ts',
      symbol: 'SessionStore.expire',
    });
    expect(res.status).toBe('persisted');
    expect(res.requirementId).toBe('REQ-DEMO-001');
    expect(res.specFile).toBe('specs/demo.md');
    const after = fs.readFileSync(specPath, 'utf8');
    expect(after).toContain(
      'Sessions MUST expire after the idle window.\n\nimplementations:\n  - src/session.ts:SessionStore.expire\n\n## Acceptance\n<!-- id: REQ-DEMO-001.A1 -->',
    );
    expect(after.split('src/session.ts:SessionStore.expire').length - 1).toBe(1);

    // Existing block: appended as one more bullet, not a second block.
    const r2 = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-002',
      kind: 'implements',
      filePath: 'src/token.ts',
      symbol: 'mint',
    });
    expect(r2.status).toBe('persisted');
    const after2 = fs.readFileSync(specPath, 'utf8');
    expect(after2).toContain(
      'implementations:\n  - src/token.ts:rotate\n  - src/token.ts:mint\n\n## Acceptance',
    );
    expect(after2.match(/^implementations:/gm)).toHaveLength(2);

    // A tests link goes to `verifies:`.
    const r3 = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-001',
      kind: 'tests',
      filePath: '__tests__/session.test.ts',
      symbol: 'idleSessionIsRejected',
    });
    expect(r3.status).toBe('persisted');
    expect(fs.readFileSync(specPath, 'utf8')).toContain(
      'implementations:\n  - src/session.ts:SessionStore.expire\n\nverifies:\n  - __tests__/session.test.ts:idleSessionIsRejected\n\n## Acceptance',
    );
  });

  it('REQ-THRU-005.A2: asserting the same link again leaves the file byte-identical', function repeatAssertIsIdempotent() {
    const opts = {
      projectRoot: root,
      specId: 'REQ-DEMO-001',
      kind: 'implements' as const,
      filePath: 'src/session.ts',
      symbol: 'SessionStore.expire',
    };
    expect(persistLinkToSpecFile(opts).status).toBe('persisted');
    const first = fs.readFileSync(specPath);
    const again = persistLinkToSpecFile(opts);
    expect(again.status).toBe('unchanged');
    expect(fs.readFileSync(specPath).equals(first)).toBe(true);

    // A target the authored file already lists is also a no-op.
    const pre = fs.readFileSync(specPath);
    const listed = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-002',
      kind: 'implements',
      filePath: 'src/token.ts',
      symbol: 'rotate',
    });
    expect(listed.status).toBe('unchanged');
    expect(fs.readFileSync(specPath).equals(pre)).toBe(true);
  });

  it('REQ-THRU-005.A3: a target with no symbol, or a symbol absent from the file, is refused without touching the spec', function unresolvableTargetIsRefused() {
    const before = fs.readFileSync(specPath);
    const noSymbol = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-001',
      kind: 'implements',
      filePath: 'src/session.ts',
      symbol: '',
    });
    expect(noSymbol.status).toBe('refused');
    expect(noSymbol.detail).toMatch(/no symbol/);

    const absent = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-001',
      kind: 'implements',
      filePath: 'src/session.ts',
      symbol: 'SessionStore.revoke',
    });
    expect(absent.status).toBe('refused');
    expect(absent.detail).toMatch(/not defined in src\/session\.ts/);

    const missingFile = persistLinkToSpecFile({
      projectRoot: root,
      specId: 'REQ-DEMO-001',
      kind: 'tests',
      filePath: '__tests__/nope.test.ts',
      symbol: 'whatever',
    });
    expect(missingFile.status).toBe('refused');

    expect(fs.readFileSync(specPath).equals(before)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REQ-LINKACC-005 — a re-point rewrites the spec's bullet. These pin the file
// byte for byte, since a wrong edit lands in the user's spec.
// ---------------------------------------------------------------------------

describe('persistLinkToSpecFile replaces — REQ-LINKACC-005', () => {
  const repoint = (replaces: string, filePath: string, symbol: string) =>
    persistLinkToSpecFile({
      projectRoot: root, specId: 'REQ-DEMO-002', kind: 'implements',
      filePath, symbol, replaces, symbolResolved: true,
    });

  it('REQ-LINKACC-005.A1: the old bullet is rewritten in place; nothing else in the file changes', function repointRewritesBulletInPlace() {
    const res = repoint('src/token.ts:rotate', 'src/keys.ts', 'rotate');
    expect(res.status).toBe('persisted');
    expect(fs.readFileSync(specPath, 'utf8')).toBe(SPEC.replace('  - src/token.ts:rotate', '  - src/keys.ts:rotate'));
  });

  it('REQ-LINKACC-005.A1: when the new location is already listed, the old bullet is dropped, never duplicated', function repointDropsOldWhenNewListed() {
    const withBoth = SPEC.replace('  - src/token.ts:rotate', '  - src/token.ts:rotate\n  - src/keys.ts:rotate');
    fs.writeFileSync(specPath, withBoth);
    expect(repoint('src/token.ts:rotate', 'src/keys.ts', 'rotate').status).toBe('persisted');
    const after = fs.readFileSync(specPath, 'utf8');
    expect(after).toBe(SPEC.replace('  - src/token.ts:rotate', '  - src/keys.ts:rotate'));
    expect(after.match(/src\/keys\.ts:rotate/g)).toHaveLength(1);
  });

  it('REQ-LINKACC-005.A1: old bullet gone and new one present is unchanged, and the file is untouched', function repointUnchangedWhenAlreadyMoved() {
    const moved = SPEC.replace('  - src/token.ts:rotate', '  - src/keys.ts:rotate');
    fs.writeFileSync(specPath, moved);
    expect(repoint('src/token.ts:rotate', 'src/keys.ts', 'rotate').status).toBe('unchanged');
    expect(fs.readFileSync(specPath, 'utf8')).toBe(moved);
  });

  it('REQ-LINKACC-005.A1: old bullet gone and new one absent adds the new bullet once', function repointAppendsWhenNeitherListed() {
    const none = SPEC.replace('  - src/token.ts:rotate\n', '  - src/token.ts:mint\n');
    fs.writeFileSync(specPath, none);
    expect(repoint('src/token.ts:rotate', 'src/keys.ts', 'rotate').status).toBe('persisted');
    const after = fs.readFileSync(specPath, 'utf8');
    expect(after.match(/src\/keys\.ts:rotate/g)).toHaveLength(1);
    expect(after).toContain('  - src/token.ts:mint');
  });

  it('REQ-LINKACC-005.A1: a `::`-qualified old name matches its dotted bullet', function repointMatchesDoubleColonName() {
    const cls = SPEC.replace('  - src/token.ts:rotate', '  - src/token.ts:Tokens.rotate');
    fs.writeFileSync(specPath, cls);
    expect(repoint('src/token.ts:Tokens::rotate', 'src/keys.ts', 'Tokens.rotate').status).toBe('persisted');
    expect(fs.readFileSync(specPath, 'utf8')).toBe(cls.replace('src/token.ts:Tokens.rotate', 'src/keys.ts:Tokens.rotate'));
  });

  it('REQ-LINKACC-005.A1: CRLF line endings are kept', function repointKeepsCrlf() {
    fs.writeFileSync(specPath, SPEC.replace(/\n/g, '\r\n'));
    expect(repoint('src/token.ts:rotate', 'src/keys.ts', 'rotate').status).toBe('persisted');
    const after = fs.readFileSync(specPath, 'utf8');
    expect(after).toBe(SPEC.replace('  - src/token.ts:rotate', '  - src/keys.ts:rotate').replace(/\n/g, '\r\n'));
  });

  it('REQ-LINKACC-005.A3: a requirement the spec file does not declare is refused and the file is untouched', function repointRefusedForUnknownRequirement() {
    const res = persistLinkToSpecFile({
      projectRoot: root, specId: 'REQ-DEMO-999', kind: 'implements', filePath: 'src/keys.ts', symbol: 'rotate',
      replaces: 'src/token.ts:rotate', symbolResolved: true, specSourcePath: 'specs/demo.md',
    });
    expect(res.status).toBe('refused');
    expect(fs.readFileSync(specPath, 'utf8')).toBe(SPEC);
  });
});
