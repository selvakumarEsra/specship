/**
 * REQ-LINKACC-009 — a bare-path `implementations:` bullet creates a file-level
 * link fingerprinted on the file's content, and a content change drifts it
 * with kind `file-change`.
 *
 * End to end against a real project: real files, a real index, a real sync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecLink } from '../src/types';
import { MarkdownSpecExtractor } from '../src/extraction/specs/markdown-spec-extractor';

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

const SPEC_ID = 'REQ-FL-001';
const SCRIPT = 'scripts/build-gemini-extension.mjs';
const COMMAND = 'commands/thing.md';
const MISSING = 'scripts/not-there.mjs';

const spec = (bullets: string[], extra = ''): string => `---
id: FL-DOC
title: File-level demo
---

<!-- id: FL-DOC -->
# File-level demo

<!-- id: ${SPEC_ID} -->
## The extension is built

The build script packs the extension.${extra}

implementations:
${bullets.map((b) => `  - ${b}`).join('\n')}
`;

const SCRIPT_V1 = `export function build() {\n  return 'v1';\n}\n`;
const SCRIPT_V2 = `export function build() {\n  return 'v2';\n}\n`;

describe('REQ-LINKACC-009 extractor: bare-path implementations bullets', () => {
  function bareImplementationsBulletIsFileLevel(): void {
    const source = spec([SCRIPT, '`commands/thing.md`', 'src/a.ts:run', 'not a path at all']);
    const result = new MarkdownSpecExtractor('specs/fl.md', source).extract();
    const files = result.linkCandidates.filter((c) => c.targetNodeKind === 'file');
    expect(files.map((c) => c.targetFilePath)).toEqual([SCRIPT, COMMAND]);
    expect(files.every((c) => c.targetQualifiedName === '' && c.kind === 'implements')).toBe(true);
    const warnings = result.errors.filter((e) => e.code === 'spec_bare_path_ref');
    expect(warnings).toHaveLength(3);
    expect(warnings[0]!.message).toContain('linked at file level');
    expect(warnings[0]!.message).toContain('drifts on any content change');
    // Prose that is not a path keeps the old no-edge wording.
    expect(warnings[2]!.message).toContain('no link edge created');
  }

  function bareVerifiesBulletStaysNoEdge(): void {
    const source = spec(['src/a.ts:run']).replace('implementations:', 'verifies:\n  - __tests__/a.test.ts\n\nimplementations:');
    const result = new MarkdownSpecExtractor('specs/fl.md', source).extract();
    expect(result.linkCandidates.filter((c) => c.kind === 'tests')).toEqual([]);
    const warning = result.errors.find((e) => e.code === 'spec_bare_path_ref');
    expect(warning?.message).toContain('no link edge created');
  }

  it('REQ-LINKACC-009: a bare implementations: path emits a file-level candidate and the file-level warning', bareImplementationsBulletIsFileLevel);
  it('REQ-LINKACC-009: a bare path under verifies: stays a no-edge bullet', bareVerifiesBulletStaysNoEdge);
});

describe.skipIf(!fts5Available)('REQ-LINKACC-009 bare-path implementations drift on file change', () => {
  let dir: string;
  let cg: SpecShip;

  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  };
  const fileLink = (target: string): SpecLink => {
    const ls = cg
      .getSpecQueries()
      .getLinksBySpec(SPEC_ID)
      .filter((l) => l.kind === 'implements' && l.targetFilePath === target);
    expect(ls).toHaveLength(1);
    return ls[0]!;
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-filelink-'));
    write(SCRIPT, SCRIPT_V1);
    write(COMMAND, '# Thing\n\nDo the thing.\n');
    write('specs/fl.md', spec([SCRIPT, COMMAND, MISSING]));
    cg = await SpecShip.init(dir);
    await cg.indexAll();
  });
  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function reqLinkacc009A1(): Promise<void> {
    await cg.sync();
    const l = fileLink(SCRIPT);
    expect(l.targetNodeKind).toBe('file');
    expect(l.targetQualifiedName).toBe('');
    expect(l.provenance).toBe('spec-declaration');
    expect(l.state).toBe('implemented');
    expect(l.nodeSigAtLink).toMatch(/^sha256:[0-9a-f]{64}$/);
    // A file the indexer does not track still gets a fingerprint.
    expect(fileLink(COMMAND).nodeSigAtLink).toMatch(/^sha256:/);
  }

  async function reqLinkacc009A2(): Promise<void> {
    const before = fileLink(SCRIPT);
    write(SCRIPT, SCRIPT_V2);
    const res = await cg.sync();
    const l = fileLink(SCRIPT);
    expect(l.state).toBe('drifted');
    expect(l.driftAxis).toBe('code');
    expect(l.driftKind).toBe('file-change');
    // The baseline is the content the link was taken against, not the new one.
    expect(l.nodeSigAtLink).toBe(before.nodeSigAtLink);
    expect(res.driftedTransitions?.some((t) => t.kind === 'file-change' && t.symbol === SCRIPT)).toBe(true);
    // A second sync keeps the drift and does not report it again.
    const again = await cg.sync();
    expect(fileLink(SCRIPT).state).toBe('drifted');
    expect(again.driftedTransitions?.some((t) => t.symbol === SCRIPT) ?? false).toBe(false);
  }

  async function reqLinkacc009A3(): Promise<void> {
    const before = fileLink(SCRIPT);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, SCRIPT), later, later);
    await cg.sync();
    write(SCRIPT, SCRIPT_V1); // identical bytes rewritten
    await cg.sync();
    const l = fileLink(SCRIPT);
    expect(l.state).toBe('implemented');
    expect(l.driftKind ?? null).toBeNull();
    expect(l.nodeSigAtLink).toBe(before.nodeSigAtLink);
  }

  async function reqLinkacc009A4(): Promise<void> {
    await cg.sync();
    const l = fileLink(MISSING);
    expect(l.state).toBe('orphaned');
    expect(l.nodeSigAtLink ?? null).toBeNull();
    // The file appearing later re-attaches the link with a baseline.
    write(MISSING, 'export const x = 1;\n');
    await cg.sync();
    const back = fileLink(MISSING);
    expect(back.state).toBe('implemented');
    expect(back.nodeSigAtLink).toMatch(/^sha256:/);
    // Deleting it again orphans it.
    fs.rmSync(path.join(dir, MISSING));
    await cg.sync();
    expect(fileLink(MISSING).state).toBe('orphaned');
  }

  async function verifiedFileLinkFlagsBodyChangeWithoutDrifting(): Promise<void> {
    const l = fileLink(SCRIPT);
    cg.getSpecQueries().updateSpecLinkState(l.id, 'verified', null, Date.now());
    write(SCRIPT, SCRIPT_V2);
    await cg.sync();
    const changed = fileLink(SCRIPT);
    expect(changed.state).toBe('verified');
    expect(changed.driftAxis ?? null).toBeNull();
    expect(changed.metadata?.bodyChanged).toMatchObject({ since: 'verified' });

    // Re-verifying re-baselines the hash and clears the marker.
    const res = cg.recordLinkVerification(changed, { result: 'pass', reason: 'checked the new script' });
    expect(res.ok).toBe(true);
    await cg.sync();
    const reverified = fileLink(SCRIPT);
    expect(reverified.state).toBe('verified');
    expect(reverified.metadata?.bodyChanged).toBeUndefined();
    expect(reverified.nodeSigAtLink).not.toBe(l.nodeSigAtLink);
    expect(reverified.nodeSigAtLink).toBe(cg.getSpecLinkResolver().fileFingerprint(SCRIPT));
  }

  async function untrackedFileEditDriftsWithNoCodeChange(): Promise<void> {
    write(COMMAND, '# Thing\n\nDo the other thing.\n');
    await cg.sync();
    expect(fileLink(COMMAND)).toMatchObject({ state: 'drifted', driftAxis: 'code', driftKind: 'file-change' });
  }

  async function specEditInSameSyncDoesNotHideFileChange(): Promise<void> {
    write(SCRIPT, SCRIPT_V2);
    write('specs/fl.md', spec([SCRIPT, COMMAND, MISSING], ' It runs in CI.'));
    await cg.sync();
    expect(fileLink(SCRIPT)).toMatchObject({ state: 'drifted', driftKind: 'file-change' });
    // A later spec edit keeps the file-change drift rather than resetting it.
    write('specs/fl.md', spec([SCRIPT, COMMAND, MISSING], ' It runs in CI nightly.'));
    await cg.sync();
    expect(fileLink(SCRIPT)).toMatchObject({ state: 'drifted', driftKind: 'file-change' });
  }

  it('REQ-LINKACC-009.A1: a bare-path bullet gets a file-level link after sync', reqLinkacc009A1);
  it('REQ-LINKACC-009.A2: editing the file drifts the link with kind file-change', reqLinkacc009A2);
  it('REQ-LINKACC-009.A3: touching the file without changing its content does not drift it', reqLinkacc009A3);
  it('REQ-LINKACC-009.A4: a bare path to a missing file leaves the link orphaned', reqLinkacc009A4);
  it('REQ-LINKACC-009: a verified file-level link is marked body-changed, not drifted; re-verify clears it', verifiedFileLinkFlagsBodyChangeWithoutDrifting);
  it('REQ-LINKACC-009: an edit to a file the indexer does not track still drifts', untrackedFileEditDriftsWithNoCodeChange);
  it('REQ-LINKACC-009: a spec edit in the same sync does not adopt the changed content', specEditInSameSyncDoesNotHideFileChange);
});
