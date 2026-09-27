/**
 * Link truth & integrity — REVINT-DOC Wave 1 (REQ-REVINT-003/004/005) and the
 * merged debug/health surfaces (REQ-SURF-006/007).
 *
 * Covers the assert-time target validation, the verification evidence that has
 * to outlive the call, and the rule that only file-derived test evidence can
 * underwrite a promotion to `verified`.
 *
 * Skipped without FTS5 in the process's SQLite (same gate as the sibling
 * spec-link suites).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { Node, NodeKind, SpecLinkKind, SpecLinkProvenance } from '../src/types';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';
import {
  handleSpecshipLinkAssert,
  handleSpecshipLinkVerify,
  handleSpecshipSpec,
} from '../src/mcp/spec-tools';
import { tools, ToolHandler } from '../src/mcp/tools';
import { resolveHealthChecks } from '../src/mcp/health-tool';
import { SERVER_INSTRUCTIONS } from '../src/mcp/server-instructions';

const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';

const fts5Available = (() => {
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
    // node:sqlite unavailable — try the dev backend below.
  }
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
    // neither backend has FTS5
  }
  return false;
})();

function makeNode(filePath: string, qualifiedName: string, kind: NodeKind, line: number, signature: string): Node {
  return {
    id: generateNodeId(filePath, kind, qualifiedName, line),
    kind,
    name: qualifiedName.split('.').pop()!,
    qualifiedName,
    filePath,
    language: 'typescript',
    startLine: line,
    endLine: line + 4,
    startColumn: 0,
    endColumn: 0,
    signature,
    updatedAt: Date.now(),
  };
}

describe.skipIf(!fts5Available)('REVINT-DOC — spec link integrity', () => {
  let dir: string;
  let cg: SpecShip;

  /** Insert a node straight into the graph (no extractor run needed). */
  const insertNode = (n: Node) => {
    (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries.insertNode(n);
  };

  const insertSpec = (id: string) => {
    const now = Date.now();
    cg.getSpecQueries().insertSpec({
      id,
      kind: 'requirement',
      title: `Spec ${id}`,
      body: 'body',
      format: 'markdown',
      sourcePath: 'specs/demo.md',
      contentHash: `hash-${id}`,
      createdAt: now,
      updatedAt: now,
    });
  };

  /** A test-evidence link with explicit provenance (file-derived vs asserted). */
  const insertEvidence = (
    specId: string,
    provenance: SpecLinkProvenance,
    kind: SpecLinkKind = 'tests',
    symbol = 'provesTheThing',
  ) => {
    const now = Date.now();
    return cg.getSpecQueries().upsertSpecLink({
      specId,
      targetFilePath: '__tests__/demo.test.ts',
      targetQualifiedName: symbol,
      targetNodeKind: 'function',
      resolvedNodeId: undefined,
      kind,
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: `hash-${specId}`,
      nodeSigAtLink: undefined,
      provenance,
      confidence: provenance === 'agent-asserted' ? 1.0 : 0.7,
      createdAt: now,
      updatedAt: now,
    });
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revint-'));
    cg = await SpecShip.init(dir);
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the target and snapshots its signature as the drift baseline (REQ-REVINT-003.A1)', async () => {
    insertSpec('REQ-R-1');
    const node = makeNode('src/auth.ts', 'authenticate', 'function', 10, 'authenticate(user: User): boolean');
    insertNode(node);

    const out = text(
      await handleSpecshipLinkAssert(cg, {
        spec_id: 'REQ-R-1',
        target_file_path: 'src/auth.ts',
        target_qualified_name: 'authenticate',
      }),
    );
    expect(out).toContain('Asserted implements link');

    const link = cg.getSpecQueries().getLinksBySpec('REQ-R-1')[0]!;
    expect(link.state).toBe('implemented');
    expect(link.resolvedNodeId).toBe(node.id);
    expect(link.nodeSigAtLink).toBe('authenticate(user: User): boolean');
  });

  it('refuses an unresolvable target with near-miss suggestions, recording nothing (REQ-REVINT-003.A2)', async () => {
    insertSpec('REQ-R-2');
    insertNode(makeNode('src/auth.ts', 'authenticate', 'function', 10, 'authenticate()'));

    const r = await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-R-2',
      target_file_path: 'src/auth.ts',
      target_qualified_name: 'authentikate',
    });
    expect(r.isError).toBe(true);
    const out = text(r);
    expect(out).toContain('does not resolve to an indexed symbol');
    expect(out).toContain('authenticate'); // the near miss in the same file
    expect(cg.getSpecQueries().getLinksBySpec('REQ-R-2')).toHaveLength(0);
  });

  it('names the other file when the symbol exists elsewhere (REQ-REVINT-003.A2)', async () => {
    insertSpec('REQ-R-3');
    insertNode(makeNode('src/real/auth.ts', 'authenticate', 'function', 3, 'authenticate()'));

    const out = text(
      await handleSpecshipLinkAssert(cg, {
        spec_id: 'REQ-R-3',
        target_file_path: 'src/wrong/auth.ts',
        target_qualified_name: 'authenticate',
      }),
    );
    expect(out).toContain('src/real/auth.ts:authenticate');
  });

  it('persists reason, timestamp and caller-supplied evidence on verify (REQ-REVINT-004.A1)', async () => {
    insertSpec('REQ-R-4');
    insertNode(makeNode('src/pay.ts', 'charge', 'function', 1, 'charge()'));
    insertEvidence('REQ-R-4', 'spec-declaration');
    await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-R-4',
      target_file_path: 'src/pay.ts',
      target_qualified_name: 'charge',
    });
    const linkId = cg.getSpecQueries().getLinksBySpec('REQ-R-4').find((l) => l.kind === 'implements')!.id;

    await handleSpecshipLinkVerify(cg, {
      link_id: linkId,
      result: 'pass',
      reason: 'suite green',
      evidence: ['__tests__/pay.test.ts:charges a card'],
    });

    const link = cg.getSpecQueries().getLinkById(linkId)!;
    expect(link.state).toBe('verified');
    const v = (link.metadata as { verification: Record<string, unknown> }).verification;
    expect(v.reason).toBe('suite green');
    expect(v.evidence).toEqual(['__tests__/pay.test.ts:charges a card']);
    expect(String(v.verifiedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('renders the persisted evidence wherever the link is shown (REQ-REVINT-004.A2)', async () => {
    insertSpec('REQ-R-5');
    insertNode(makeNode('src/pay.ts', 'refund', 'function', 1, 'refund()'));
    insertEvidence('REQ-R-5', 'code-comment');
    await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-R-5',
      target_file_path: 'src/pay.ts',
      target_qualified_name: 'refund',
    });
    const linkId = cg.getSpecQueries().getLinksBySpec('REQ-R-5').find((l) => l.kind === 'implements')!.id;
    await handleSpecshipLinkVerify(cg, {
      link_id: linkId,
      result: 'pass',
      reason: 'ran refund suite',
      evidence: ['__tests__/pay.test.ts:refunds'],
    });

    const detail = text(await handleSpecshipSpec(cg, { spec_id: 'REQ-R-5' }));
    expect(detail).toContain('__tests__/pay.test.ts:refunds');
    expect(detail).toContain('ran refund suite');
  });

  it('records the timestamp even with no reason (REQ-REVINT-004.A3)', async () => {
    insertSpec('REQ-R-6');
    insertNode(makeNode('src/pay.ts', 'settle', 'function', 1, 'settle()'));
    insertEvidence('REQ-R-6', 'spec-declaration');
    await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-R-6',
      target_file_path: 'src/pay.ts',
      target_qualified_name: 'settle',
    });
    const linkId = cg.getSpecQueries().getLinksBySpec('REQ-R-6').find((l) => l.kind === 'implements')!.id;

    await handleSpecshipLinkVerify(cg, { link_id: linkId, result: 'pass' });

    const v = (cg.getSpecQueries().getLinkById(linkId)!.metadata as {
      verification: Record<string, unknown>;
    }).verification;
    expect(v.reason).toBeUndefined();
    expect(String(v.verifiedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns both reports from one specship_health call (REQ-SURF-007.A1)', async () => {
    const handler = new ToolHandler(cg);
    const both = text(await handler.execute('specship_health', {}));
    expect(both).toContain('# Maintainability');
    expect(both).toContain('# Architecture fitness');

    const onlyFitness = text(await handler.execute('specship_health', { checks: ['fitness'] }));
    expect(onlyFitness).toContain('# Architecture fitness');
    expect(onlyFitness).not.toContain('# Maintainability');

    // The retired names still execute for clients holding a cached list.
    expect(text(await handler.execute('specship_maintainability', {}))).toContain('# Maintainability');
    expect(text(await handler.execute('specship_fitness', {}))).toContain('# Architecture fitness');
  });

  it('counts only file-derived test evidence toward promotion (REQ-REVINT-005.A2)', async () => {
    insertSpec('REQ-R-7');
    insertNode(makeNode('src/pay.ts', 'capture', 'function', 1, 'capture()'));
    // The implementing agent mints its own tests link — must not open the gate.
    insertEvidence('REQ-R-7', 'agent-asserted');
    await handleSpecshipLinkAssert(cg, {
      spec_id: 'REQ-R-7',
      target_file_path: 'src/pay.ts',
      target_qualified_name: 'capture',
    });
    const linkId = cg.getSpecQueries().getLinksBySpec('REQ-R-7').find((l) => l.kind === 'implements')!.id;

    const refused = await handleSpecshipLinkVerify(cg, { link_id: linkId, result: 'pass' });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('no test evidence');
    expect(cg.getSpecQueries().getLinkById(linkId)!.state).toBe('implemented');

    // Same spec, now with a `verifies:`-derived link → the gate opens.
    insertEvidence('REQ-R-7', 'spec-declaration', 'tests', 'declaredProof');
    const passed = await handleSpecshipLinkVerify(cg, { link_id: linkId, result: 'pass' });
    expect(passed.isError).toBeFalsy();
    expect(cg.getSpecQueries().getLinkById(linkId)!.state).toBe('verified');
  });
});

describe('Merged debug + health surfaces', () => {
  const names = tools.map((t) => t.name);

  it('folds specship_version into specship_status (REQ-SURF-006.A1)', async () => {
    expect(names).not.toContain('specship_version');
    expect(names).toContain('specship_status');
    const status = tools.find((t) => t.name === 'specship_status')!;
    expect(status.description).toMatch(/version/i);

    // With no project open, status still answers the identity question.
    const out = text(await new ToolHandler(null).execute('specship_status', {}));
    expect(out).toContain('**version:**');
    expect(out).toContain('**installMethod:**');
    expect(out).toContain(`**node:** ${process.version}`);
  });

  it('keeps answering the retired tool names for cached clients (REQ-SURF-006.A1/007.A1)', async () => {
    const out = text(await new ToolHandler(null).execute('specship_version', {}));
    expect(out).toContain('**version:**');
  });

  it('exposes one specship_health tool with a checks filter (REQ-SURF-007.A1)', () => {
    expect(names).toContain('specship_health');
    expect(names).not.toContain('specship_maintainability');
    expect(names).not.toContain('specship_fitness');
    expect(tools.find((t) => t.name === 'specship_health')!.inputSchema.properties.checks).toBeDefined();
  });

  it('defaults an absent or unrecognized checks filter to both reports (REQ-SURF-007.A1)', () => {
    expect(resolveHealthChecks(undefined)).toEqual(['maintainability', 'fitness']);
    expect(resolveHealthChecks(['nonsense'])).toEqual(['maintainability', 'fitness']);
    expect(resolveHealthChecks(['fitness'])).toEqual(['fitness']);
    expect(resolveHealthChecks('maintainability')).toEqual(['maintainability']);
  });

  it('names the merged tools in the server instructions (REQ-SURF-006.A3/007.A2)', () => {
    expect(SERVER_INSTRUCTIONS).toContain('specship_health');
    expect(SERVER_INSTRUCTIONS).not.toContain('specship_version');
    expect(SERVER_INSTRUCTIONS).not.toContain('specship_maintainability');
  });
});
