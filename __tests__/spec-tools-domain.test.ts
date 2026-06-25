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
