/**
 * `specship_spec` rendering of a domain fact's inherited code / gap section
 * (REQ-DOMAIN-002.A1 / A3). A domain fact carries no direct code links; the
 * tool surfaces the code it inherits transitively through the specs it depends
 * on, or a Gap note when nothing resolves.
 *
 * Skipped where the system SQLite lacks FTS5 (same pattern as the resolver suite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { handleSpecshipSpec } from '../src/mcp/spec-tools';
import { ToolHandler } from '../src/mcp/tools';
import { Node, NodeKind, Spec } from '../src/types';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';

function makeNode(
  filePath: string,
  qualifiedName: string,
  kind: NodeKind,
  line: number,
  signature?: string
): Node {
  return {
    id: generateNodeId(filePath, kind, qualifiedName, line),
    kind,
    name: qualifiedName.split('.').pop()!,
    qualifiedName,
    filePath,
    language: 'typescript',
    startLine: line,
    endLine: line + 5,
    startColumn: 0,
    endColumn: 0,
    signature,
    updatedAt: Date.now(),
  };
}

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

describe.skipIf(!fts5Available)('specship_spec — domain fact inherited code (REQ-DOMAIN-002)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-tools-domain-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(async () => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function insertDomainFact(id: string, dependsOn?: string[], parentId?: string): Spec {
    const now = Date.now();
    const spec: Spec = {
      id,
      kind: 'domain',
      title: `${id} title`,
      body: 'A domain fact.',
      format: 'markdown',
      sourcePath: 'specs/domain/fact.md',
      contentHash: 'dh',
      parentId,
      metadata: dependsOn ? { type: 'rule', depends_on: dependsOn } : { type: 'rule' },
      createdAt: now,
      updatedAt: now,
    };
    cg.getSpecQueries().insertSpec(spec);
    return spec;
  }

  it('renders an "## Inherited code" section grouped by the dependency spec (A1)', async () => {
    const sq = cg.getSpecQueries();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    sq.insertSpec({
      id: 'REQ-PAY-004',
      kind: 'requirement',
      title: 'Settlement',
      body: 'b',
      format: 'markdown',
      sourcePath: 'specs/pay.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    const v = makeNode('src/pay.ts', 'settle', 'function', 1, 'settle(x)');
    queries.insertNode(v);
    sq.upsertSpecLink({
      specId: 'REQ-PAY-004',
      targetFilePath: 'src/pay.ts',
      targetQualifiedName: 'settle',
      targetNodeKind: 'function',
      resolvedNodeId: v.id,
      kind: 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: 'h',
      nodeSigAtLink: 'settle(x)',
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    insertDomainFact('DOM-PAY-001', ['REQ-PAY-004']);

    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'DOM-PAY-001' }));
    expect(out).toContain('## Inherited code');
    expect(out).toContain('### via REQ-PAY-004');
    expect(out).toContain('src/pay.ts:settle');
    expect(out).not.toContain('## Gap');
  });

  it('renders a "## Gap" note for a domain fact with no linkable spec (A3)', async () => {
    insertDomainFact('DOM-NONE-001');
    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'DOM-NONE-001' }));
    expect(out).toContain('## Gap');
    expect(out).toContain('Unlinked fact (proposed)');
  });

  it('surfaces declared-but-missing dependency ids as a gap line, not an error', async () => {
    insertDomainFact('DOM-DANGLING-001', ['REQ-MISSING']);
    const result = await handleSpecshipSpec(cg, { spec_id: 'DOM-DANGLING-001' });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain('REQ-MISSING');
    expect(out).toContain('not found in the index');
  });
});

/**
 * REQ-DOMAIN-005: domain facts surface through the EXISTING `specship_spec` and
 * `specship_explore` tools — no new MCP tool. A1 = the requirement-side view (a
 * fact's `depends_on` is rendered back on the requirement); A2 = explore naming
 * the documented term returns the fact body. A3 (tool-count unchanged) lives in
 * mcp-initialize.test.ts where the tool list is imported.
 */
describe.skipIf(!fts5Available)('REQ-DOMAIN-005 — domain facts surface through existing tools', () => {
  let dir: string;
  let cg: SpecShip;
  let handler: ToolHandler;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dom005-'));
    const src = path.join(dir, 'src');
    fs.mkdirSync(src, { recursive: true });
    // A code symbol named after the domain term, so explore finds code to lead
    // with — the domain fact body is then appended alongside it.
    fs.writeFileSync(
      path.join(src, 'settlement.ts'),
      'export function Settlement(x: number) { return x; }\n'
    );

    cg = SpecShip.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);

    const sq = cg.getSpecQueries();
    const now = Date.now();
    sq.insertSpec({
      id: 'REQ-PAY-004',
      kind: 'requirement',
      title: 'Settlement requirement',
      body: 'The settlement path.',
      format: 'markdown',
      sourcePath: 'specs/pay.md',
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    });
    // A `term` domain fact that depends_on the requirement.
    sq.insertSpec({
      id: 'DOM-PAY-001',
      kind: 'domain',
      title: 'Settlement',
      body: 'Settlement is the final transfer of funds between parties.',
      format: 'markdown',
      sourcePath: 'specs/domain/fact.md',
      contentHash: 'dh',
      metadata: { type: 'term', depends_on: ['REQ-PAY-004'] },
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    cg?.destroy();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('A1: specship_spec on the requirement returns its linked domain facts', async () => {
    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'REQ-PAY-004' }));
    expect(out).toContain('## Domain facts');
    expect(out).toContain('DOM-PAY-001');
    expect(out).toContain('final transfer of funds');
  });

  it('A2: specship_explore naming the domain term includes the fact body', async () => {
    const res = await handler.execute('specship_explore', { query: 'Settlement' });
    const out = res.content.map((c) => c.text).join('\n');
    expect(out).toContain('Domain facts');
    expect(out).toContain('final transfer of funds');
  });

  it('A2: explore surfaces a pure domain term even when no code matches', async () => {
    // A rule fact with no co-named code symbol — explore must still surface it.
    cg.getSpecQueries().insertSpec({
      id: 'DOM-RULE-001',
      kind: 'domain',
      title: 'Reconciliation window',
      body: 'Reconciliation must complete within two business days.',
      format: 'markdown',
      sourcePath: 'specs/domain/rule.md',
      contentHash: 'rh',
      metadata: { type: 'rule' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const res = await handler.execute('specship_explore', { query: 'Reconciliation' });
    const out = res.content.map((c) => c.text).join('\n');
    expect(out).toContain('Reconciliation must complete within two business days');
  });
});
