/**
 * REQ-DESKTOP-021 — the Graph screen renders the live knowledge graph with a
 * selection detail rail: A1 layout/edge-type toggles re-render with no reload,
 * A2 selecting a node populates the rail (incl. explicit empty states and the
 * workflow-gated Implement affordance), A3 ?focus= centers and highlights,
 * A4 an empty graph renders guidance. Plus determinism for both layouts.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphPage } from '../pages/graph';
import { forceLayout, hierarchicalLayout, type CanvasEdge } from '../components/graph';

const GRAPH_FULL = {
  nodes: [
    { id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts', degree: 9 },
    { id: 'n2', name: 'SpecShip', kind: 'class', filePath: 'src/index.ts', degree: 8 },
    { id: 'n3', name: 'toolsSpecTest', kind: 'function', filePath: '__tests__/tools.test.ts', degree: 3 },
    { id: 'n4', name: 'apiRoute', kind: 'route', filePath: 'src/routes.ts', degree: 1 },
  ],
  edges: [
    { from: 'n1', to: 'n2', kind: 'calls', provenance: 'static' },       // bucket: calls
    { from: 'n3', to: 'n1', kind: 'calls', provenance: 'static' },       // bucket: tests (test endpoint)
    { from: 'n1', to: 'n4', kind: 'references', provenance: 'heuristic' }, // bucket: synth (dashed)
  ],
  total: 4,
  shown: 4,
};

const HEALTH = {
  linkHealth: { verified: 3, drifted: 1 },
  edgeKinds: { calls: 1, implements: 0, tests: 1, synth: 1 },
  hubs: [{ id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts', degree: 9 }],
  anchored: [{ id: 'n2', name: 'SpecShip', kind: 'class', filePath: 'src/index.ts', degree: 8 }],
};

const NODE_DETAIL: Record<string, unknown> = {
  n1: {
    matches: [{
      id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts',
      startLine: 10, endLine: 40, signature: 'toolsHandler(req: Request): Response',
      callers: [{ id: 'n3', name: 'toolsSpecTest', kind: 'function', filePath: '__tests__/tools.test.ts' }],
      callees: [{ id: 'n2', name: 'SpecShip', kind: 'class', filePath: 'src/index.ts' }],
      linkedSpecs: [{ specId: 'REQ-X-001', kind: 'implements', state: 'verified', targetQualifiedName: 'toolsHandler', targetFilePath: 'src/mcp/tools.ts' }],
    }],
  },
  n2: {
    matches: [{
      id: 'n2', name: 'SpecShip', kind: 'class', filePath: 'src/index.ts',
      callers: [{ id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts' }],
      callees: [], linkedSpecs: [],
    }],
  },
  n4: {
    matches: [{
      id: 'n4', name: 'apiRoute', kind: 'route', filePath: 'src/routes.ts',
      callers: [], callees: [], linkedSpecs: [],
    }],
  },
};

const ROUTES: Record<string, unknown> = {
  '/api/graph/full': GRAPH_FULL,
  '/api/graph/health': HEALTH,
  '/api/graph/node': NODE_DETAIL,
};

/** URL-aware fetch mock: /api/graph/node serves per-id bodies. */
function mockFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    let body = routes[u.pathname];
    if (u.pathname === '/api/graph/node') {
      body = (body as Record<string, unknown> | undefined)?.[u.searchParams.get('id') ?? ''];
    }
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    return { ok: true, json: async () => body };
  }));
  return calls;
}

/** The 360px right rail — second child of the page's flex row. */
function railEl(container: HTMLElement): HTMLElement {
  return (container.firstElementChild as HTMLElement).lastElementChild as HTMLElement;
}

/** Select a canvas node the way a user does: press + release without moving. */
function clickNode(container: HTMLElement, id: string): void {
  const el = container.querySelector(`[data-node="${id}"]`) as HTMLElement;
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
}

beforeEach(() => {
  history.replaceState(null, '', '/graph');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GraphPage (REQ-DESKTOP-021)', () => {
  it('A1: layout and edge-type toggles re-render live nodes/edges without a reload', async () => {
    const calls = mockFetch(ROUTES);
    const { container } = render(<GraphPage project={null} query={{}} />);
    await screen.findAllByText('toolsHandler');

    const n2 = () => container.querySelector('[data-node="n2"]') as HTMLElement;
    const edgePaths = () => container.querySelectorAll('g[transform] > path').length;
    expect(edgePaths()).toBe(3);
    const before = n2().style.left + '/' + n2().style.top;

    // Layout toggle recomputes positions client-side.
    fireEvent.click(screen.getByText('Force'));
    expect(n2().style.left + '/' + n2().style.top).not.toBe(before);

    // Edge-type toggle drops just that bucket's edges.
    const callsChip = screen.getAllByText('calls').find((e) => e.closest('button'))!;
    fireEvent.click(callsChip);
    expect(edgePaths()).toBe(2);

    // Neither toggle refetched the graph (no reload).
    expect(calls.filter((u) => u.startsWith('/api/graph/full')).length).toBe(1);
  });

  it('A2: selecting a node populates the rail — callers, callees, linked specs, gated Implement, and explicit empties', async () => {
    mockFetch(ROUTES);
    const { container } = render(<GraphPage project={null} query={{}} />);
    await screen.findAllByText('toolsHandler');
    const rail = () => within(railEl(container));

    // Overview rail first: hubs + anchored from /api/graph/health.
    expect(rail().getByText('Most connected')).toBeTruthy();
    await rail().findByText('Anchored');

    clickNode(container, 'n1');
    await rail().findByText('REQ-X-001');
    expect(rail().getByText('toolsSpecTest')).toBeTruthy(); // caller
    expect(rail().getByText('SpecShip')).toBeTruthy();      // callee
    expect(rail().getByText('Verified')).toBeTruthy();      // linked-spec state pill

    // Implement is workflow-owned: disabled, tooltip names the owning workflow,
    // activation is a no-op (REQ-DESKTOP-005.A1).
    const implement = rail().getByText('Implement').closest('button') as HTMLButtonElement;
    expect(implement.disabled).toBe(true);
    expect(implement.title).toContain('implementation workflow');
    fireEvent.click(implement);
    expect(rail().getByText('REQ-X-001')).toBeTruthy(); // rail unchanged

    // Empty lists render their explicit states.
    clickNode(container, 'n4');
    await rail().findByText('No callers');
    expect(rail().getByText('No callees')).toBeTruthy();
  });

  it('A3: a focus query parameter selects and centers that node', async () => {
    mockFetch(ROUTES);
    const { container } = render(<GraphPage project={null} query={{ focus: 'n2' }} />);

    // Deep-link selects: the rail shows the focused node's detail.
    await within(railEl(container)).findByText('SpecShip');

    // And the canvas centered on it: the view translated to the node with the
    // clamped focus zoom (jsdom's 0-size wrapper clamps k to the 0.6 floor).
    await waitFor(() => {
      const g = container.querySelector('svg g[transform]')!;
      const t = g.getAttribute('transform')!;
      expect(t).toContain('scale(0.6)');
      expect(t).not.toContain('translate(0 0)');
    });
  });

  it('A4: an empty graph renders the run-specship-index guidance, not a blank canvas', async () => {
    mockFetch({ ...ROUTES, '/api/graph/full': { nodes: [], edges: [], total: 0, shown: 0 } });
    render(<GraphPage project={null} query={{}} />);
    await screen.findByText('Nothing indexed yet');
    expect(screen.getByText(/Run specship index/)).toBeTruthy();
  });
});

describe('graph layouts', () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: 'k' + i, name: 'sym' + i, kind: 'function', filePath: 'src/f' + i + '.ts',
  }));
  // a simple call chain k0 → k1 → … → k29
  const edges: CanvasEdge[] = nodes.slice(1).map((n, i) => ({ from: 'k' + i, to: n.id, kind: 'calls' }));

  it('forceLayout is deterministic — same input, same positions', () => {
    expect(forceLayout(nodes, edges)).toEqual(forceLayout(nodes, edges));
  });

  it('hierarchicalLayout is deterministic and layers roots left of their callees', () => {
    const a = hierarchicalLayout(nodes, edges);
    expect(a).toEqual(hierarchicalLayout(nodes, edges));
    const x = (id: string) => a.find((n) => n.id === id)!.x;
    expect(x('k0')).toBeLessThan(x('k1'));
    expect(x('k1')).toBeLessThan(x('k2'));
  });
});
