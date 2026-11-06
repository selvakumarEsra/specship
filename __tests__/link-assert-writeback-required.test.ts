/**
 * REQ-LINKACC-011 (specs/link-evidence-accuracy.md): an asserted link MUST NOT
 * exist only in the index. `specship_link_assert` — and the dashboard's
 * POST /api/spec/link-assert, which shares the rule through
 * `SpecShip.assertSpecLink` — records a link only after writing it into the
 * spec file. A refused write-back records nothing and names the bullet to add.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src';
import { handleSpecshipLinkAssert } from '../src/mcp/spec-tools';
import { registerSpecRoutes } from '../server/src/routes/spec';

const fts5Available = (() => {
  for (const load of [
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(':memory:');
    },
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      return new Database(':memory:');
    },
  ]) {
    try {
      const db = load();
      try {
        db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
        return true;
      } finally {
        db.close();
      }
    } catch {
      // try the next backend
    }
  }
  return false;
})();

const SPEC = `---
id: WB-DOC
---

<!-- id: WB-DOC -->
# Write-back

<!-- id: REQ-WB-001 -->
## Totals MUST add up

Body one.

## Acceptance
<!-- id: REQ-WB-001.A1 -->
- Sums two numbers.

<!-- id: REQ-WB-002 -->
## Totals MUST be rounded

Body two.
`;

const CODE = `export function total(a: number, b: number): number {
  return a + b;
}

export function rounded(n: number): number {
  return Math.round(n);
}

export function clamp(n: number): number {
  return Math.max(0, n);
}
`;

const text = (r: { content?: Array<{ text?: string }> }): string => r.content?.[0]?.text ?? '';

describe.skipIf(!fts5Available)('REQ-LINKACC-011 — asserted links are written to the spec or not recorded', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;

  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  };
  const specOnDisk = (): string => fs.readFileSync(path.join(dir, 'specs', 'wb.md'), 'utf-8');
  const linkFor = (specId: string, symbol: string) =>
    cg
      .getSpecQueries()
      .getLinksBySpec(specId)
      .find((l) => l.targetFilePath === 'src/total.ts' && l.targetQualifiedName === symbol);

  /**
   * Make REQ-WB-002's write-back fail: the spec stays indexed under its id,
   * but the file no longer carries its `<!-- id: -->` marker, so there is no
   * block to write into.
   */
  const breakWriteBackFor = (id: string): void => {
    write('specs/wb.md', specOnDisk().replace(`<!-- id: ${id} -->\n`, ''));
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-linkacc011-'));
    write('specs/wb.md', SPEC);
    write('src/total.ts', CODE);
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    app = Fastify({ logger: false });
    app.decorate('activeCg', async (_req: FastifyRequest) => cg);
    await registerSpecRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function reqLinkacc011A1(): Promise<void> {
    const res = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-WB-001',
      target_file_path: 'src/total.ts',
      target_qualified_name: 'total',
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('persisted to specs/wb.md');
    expect(specOnDisk()).toContain('implementations:\n  - src/total.ts:total');
    const link = linkFor('REQ-WB-001', 'total');
    expect(link?.state).toBe('implemented');
    expect(link?.provenance).toBe('agent-asserted');

    // A criterion id writes into its parent requirement's block, as today.
    const crit = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-WB-001.A1',
      target_file_path: 'src/total.ts',
      target_qualified_name: 'clamp',
    });
    expect(crit.isError).toBeFalsy();
    expect(specOnDisk()).toContain('  - src/total.ts:clamp');

    // The dashboard route follows the same path.
    const reply = await app.inject({
      method: 'POST',
      url: '/api/spec/link-assert',
      payload: { spec_id: 'REQ-WB-002', target_file_path: 'src/total.ts', target_qualified_name: 'rounded' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, state: 'implemented', writeBack: 'persisted' });
    expect(specOnDisk()).toContain('  - src/total.ts:rounded');
    expect(linkFor('REQ-WB-002', 'rounded')).toBeDefined();
  }
  it('REQ-LINKACC-011.A1: an assert that writes into the spec records the link', reqLinkacc011A1);

  async function reqLinkacc011A2(): Promise<void> {
    breakWriteBackFor('REQ-WB-002');
    const before = specOnDisk();

    const res = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-WB-002',
      target_file_path: 'src/total.ts',
      target_qualified_name: 'rounded',
    });
    expect(res.isError).toBe(true);
    const out = text(res);
    expect(out).toContain('no link was recorded');
    expect(out).toContain('`- src/total.ts:rounded`');
    expect(out).toContain('`implementations:`');
    expect(out).toContain('REQ-WB-002');
    expect(out).toContain('specs/wb.md');
    expect(linkFor('REQ-WB-002', 'rounded')).toBeUndefined();
    expect(specOnDisk()).toBe(before);

    // The dashboard route refuses the same way and records nothing.
    const reply = await app.inject({
      method: 'POST',
      url: '/api/spec/link-assert',
      payload: { spec_id: 'REQ-WB-002', target_file_path: 'src/total.ts', target_qualified_name: 'rounded' },
    });
    expect(reply.statusCode).toBe(409);
    expect(reply.json()).toMatchObject({
      code: 'write_back_failed',
      bullet: '- src/total.ts:rounded',
      blockName: 'implementations',
      specFile: 'specs/wb.md',
      requirementId: 'REQ-WB-002',
    });
    expect(linkFor('REQ-WB-002', 'rounded')).toBeUndefined();

    // A kind with no spec-file block is refused too, naming the supported kinds.
    const other = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-WB-001',
      target_file_path: 'src/total.ts',
      target_qualified_name: 'total',
      kind: 'documents',
    });
    expect(other.isError).toBe(true);
    expect(text(other)).toContain('Supported kinds: implements, tests');
    expect(linkFor('REQ-WB-001', 'total')).toBeUndefined();
  }
  it('REQ-LINKACC-011.A2: a failed write-back records no link and names the bullet and spec file', reqLinkacc011A2);

  async function reqLinkacc011A3(): Promise<void> {
    const recorded: string[] = [];
    for (const [specId, symbol] of [
      ['REQ-WB-001', 'total'],
      ['REQ-WB-001', 'clamp'],
    ] as const) {
      const res = await handleSpecshipLinkAssert(cg, {
        spec_id: specId,
        target_file_path: 'src/total.ts',
        target_qualified_name: symbol,
      });
      expect(res.isError).toBeFalsy();
      recorded.push(`${specId}|${symbol}`);
    }
    breakWriteBackFor('REQ-WB-002');
    const refused = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-WB-002',
      target_file_path: 'src/total.ts',
      target_qualified_name: 'rounded',
    });
    expect(refused.isError).toBe(true);

    await cg.indexAll();

    for (const key of recorded) {
      const [specId, symbol] = key.split('|') as [string, string];
      expect(linkFor(specId, symbol), `${key} survives a full reindex`).toBeDefined();
    }
    expect(linkFor('REQ-WB-002', 'rounded')).toBeUndefined();
  }
  it('REQ-LINKACC-011.A3: every link reported as recorded survives a full reindex', reqLinkacc011A3);
});
