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
      specId: 'REQ-DEMO-001.A1', // criterion id → parent requirement's block
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
      specId: 'REQ-DEMO-002.A1',
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
