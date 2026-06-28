/**
 * Behaviour surface (REQ-BEHAVIOUR-001): a requirement's linked code + the
 * surrounding route/component/handler neighbourhood, grouped UI vs backend.
 *
 * Pure-function tests run without a DB; the integration test drives
 * SpecShip.getBehaviourSurface through the specship_spec behaviour_surface mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { computeBehaviourSurface, isUiNode } from '../src/behaviour/behaviour-surface';
import { Node, NodeKind } from '../src/types';
import SpecShip from '../src';
import { handleSpecshipSpec } from '../src/mcp/spec-tools';
import { generateNodeId } from '../src/extraction/tree-sitter-helpers';

function node(filePath: string, name: string, kind: NodeKind, line = 1): Node {
  return {
    id: generateNodeId(filePath, kind, name, line),
    kind,
    name: name.split('.').pop()!,
    qualifiedName: name,
    filePath,
    language: 'typescript',
    startLine: line,
    endLine: line + 3,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

describe('computeBehaviourSurface (REQ-BEHAVIOUR-001)', () => {
  it('returns found:false for a requirement that does not exist (A4)', () => {
    const s = computeBehaviourSurface({
      requirementId: 'REQ-NONE',
      requirementExists: false,
      linkedNodes: [],
      neighbourNodes: [],
    });
    expect(s.found).toBe(false);
    expect(s.ui).toEqual([]);
    expect(s.backend).toEqual([]);
  });

  it('classifies components and front-end files as UI, handlers as backend (A1)', () => {
    const s = computeBehaviourSurface({
      requirementId: 'REQ-X',
      requirementExists: true,
      linkedNodes: [
        node('src/ui/Login.tsx', 'LoginForm', 'component'),
        node('src/api/auth.ts', 'authenticate', 'function'),
      ],
      neighbourNodes: [],
    });
    expect(s.found).toBe(true);
    expect(s.ui.map((e) => e.name)).toContain('LoginForm');
    expect(s.backend.map((e) => e.name)).toContain('authenticate');
  });

  it('treats a route in a front-end file as UI and a route in a server file as backend', () => {
    expect(isUiNode(node('src/routes/+page.svelte', 'page', 'route'))).toBe(true);
    expect(isUiNode(node('src/server/express.ts', 'getUsers', 'route'))).toBe(false);
  });

  it('includes linked nodes regardless of kind, but filters neighbours to flow kinds (A1)', () => {
    const s = computeBehaviourSurface({
      requirementId: 'REQ-X',
      requirementExists: true,
      linkedNodes: [node('src/api/auth.ts', 'authenticate', 'function')],
      neighbourNodes: [
        node('src/api/route.ts', 'loginRoute', 'route'), // flow kind → kept
        node('src/api/auth.ts', 'TOKEN_TTL', 'constant'), // not a flow kind → dropped
      ],
    });
    const all = [...s.ui, ...s.backend].map((e) => e.name);
    expect(all).toContain('authenticate');
    expect(all).toContain('loginRoute');
    expect(all).not.toContain('TOKEN_TTL');
  });

  it('yields an empty UI tier (not an error) when there is no UI surface (A3)', () => {
    const s = computeBehaviourSurface({
      requirementId: 'REQ-X',
      requirementExists: true,
      linkedNodes: [node('src/jobs/nightly.ts', 'runBatch', 'function')],
      neighbourNodes: [],
    });
    expect(s.found).toBe(true);
    expect(s.ui).toEqual([]);
    expect(s.backend.map((e) => e.name)).toContain('runBatch');
  });

  it('dedups a node that is both linked and a neighbour, keeping it as linked', () => {
    const handler = node('src/api/auth.ts', 'authenticate', 'function');
    const s = computeBehaviourSurface({
      requirementId: 'REQ-X',
      requirementExists: true,
      linkedNodes: [handler],
      neighbourNodes: [handler],
    });
    expect(s.backend.filter((e) => e.name === 'authenticate')).toHaveLength(1);
    expect(s.backend.find((e) => e.name === 'authenticate')!.linkedDirectly).toBe(true);
  });

  it('carries symbol, kind, and file location on each element (A2)', () => {
    const s = computeBehaviourSurface({
      requirementId: 'REQ-X',
      requirementExists: true,
      linkedNodes: [node('src/ui/Login.tsx', 'LoginForm', 'component', 12)],
      neighbourNodes: [],
    });
    const el = s.ui[0]!;
    expect(el).toMatchObject({ name: 'LoginForm', kind: 'component', filePath: 'src/ui/Login.tsx', startLine: 12 });
  });
});

describe('specship_spec behaviour_surface mode (REQ-BEHAVIOUR-001 integration)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-behaviour-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(async () => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function textOf(r: { content: Array<{ text: string }> }): string {
    return r.content.map((c) => c.text).join('\n');
  }

  it('groups a requirement\'s linked UI + backend code into tiers', async () => {
    const sq = cg.getSpecQueries();
    const queries = (cg as unknown as { queries: import('../src/db/queries').QueryBuilder }).queries;
    const now = Date.now();

    sq.insertSpec({
      id: 'REQ-LOGIN-001', kind: 'requirement', title: 'Login', body: 'b',
      format: 'markdown', sourcePath: 'specs/login.md', contentHash: 'h',
      createdAt: now, updatedAt: now,
    });

    const ui = node('src/ui/Login.tsx', 'LoginForm', 'component');
    const api = node('src/api/auth.ts', 'authenticate', 'function');
    queries.insertNode(ui);
    queries.insertNode(api);

    for (const n of [ui, api]) {
      sq.upsertSpecLink({
        specId: 'REQ-LOGIN-001', targetFilePath: n.filePath, targetQualifiedName: n.qualifiedName,
        targetNodeKind: n.kind, resolvedNodeId: n.id, kind: 'implements', state: 'implemented',
        driftAxis: null, specHashAtLink: 'h', nodeSigAtLink: undefined,
        provenance: 'agent-asserted', confidence: 1.0, createdAt: now, updatedAt: now,
      });
    }

    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'REQ-LOGIN-001', behaviour_surface: true }));
    expect(out).toContain('Behaviour surface — REQ-LOGIN-001');
    expect(out).toContain('UI tier');
    expect(out).toContain('LoginForm');
    expect(out).toContain('Backend / batch tier');
    expect(out).toContain('authenticate');
  });

  it('reports not-found for an unknown requirement, not an error (A4)', async () => {
    const result = await handleSpecshipSpec(cg, { spec_id: 'REQ-NOPE', behaviour_surface: true });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('not found');
  });
});
