/**
 * REQ-IMPACT-SPEC-001: `specship_impact` joins spec links into the blast
 * radius. For each affected symbol that carries a spec link, the output lists
 * the governing spec's id, the link kind, and the link's current state, and
 * closes with drift-handoff guidance when governed symbols are in the radius
 * (A1/A3). A radius with no spec-linked symbols is unchanged (A4).
 *
 * Skipped where the system SQLite lacks FTS5 (findAllSymbols searches by name),
 * mirroring the spec-tools suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { ToolHandler } from '../src/mcp/tools';

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

describe.skipIf(!fts5Available)('specship_impact — governed-by (REQ-IMPACT-SPEC-001)', () => {
  let dir: string;
  let cg: SpecShip;
  let handler: ToolHandler;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-impact-gov-'));
    const src = path.join(dir, 'src');
    fs.mkdirSync(src, { recursive: true });
    // `caller` depends on `target`, so the impact radius of `target` includes
    // `caller` — the symbol we link a spec to.
    fs.writeFileSync(
      path.join(src, 'svc.ts'),
      'export function target(x: number) { return x + 1; }\n' +
        'export function caller() { return target(2); }\n'
    );

    cg = SpecShip.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterEach(() => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function linkSpecToCaller(): void {
    const callerNode = cg
      .searchNodes('caller', { limit: 10 })
      .find((r) => r.node.name === 'caller')!.node;
    const sq = cg.getSpecQueries();
    const now = Date.now();
    sq.insertSpec({
      id: 'REQ-GOV-001',
      kind: 'requirement',
      title: 'Governed caller',
      body: 'The caller is governed.',
      format: 'markdown',
      sourcePath: 'specs/gov.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    sq.upsertSpecLink({
      specId: 'REQ-GOV-001',
      targetFilePath: callerNode.filePath,
      targetQualifiedName: callerNode.qualifiedName,
      targetNodeKind: 'function',
      resolvedNodeId: callerNode.id,
      kind: 'implements',
      state: 'verified',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: 'caller()',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
  }

  it('A1/A3: a governed symbol in the radius shows spec id/kind/state + handoff', async () => {
    linkSpecToCaller();
    const out = textOf(await handler.execute('specship_impact', { symbol: 'target' }));

    expect(out).toContain('## Governed by');
    // spec id · link kind · link state
    expect(out).toContain('REQ-GOV-001 · implements · verified');
    expect(out).toContain('caller');
    // Drift handoff guidance closes the output.
    expect(out).toContain('specship_link_assert');
    expect(out).toContain('/specship:check');
  });

  it('A4: a radius with no spec-linked symbols emits no governed-by section', async () => {
    const out = textOf(await handler.execute('specship_impact', { symbol: 'target' }));

    expect(out).toContain('## Impact:');
    expect(out).not.toContain('## Governed by');
    expect(out).not.toContain('specship_link_assert');
  });
});
