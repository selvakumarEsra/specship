/**
 * REQ-DASHSIMPLE-005 — the Graph screen's split spec/code view. One search box
 * over specs and symbols; `?req=` shows a requirement's text beside its linked
 * code, `?sym=` shows a symbol's code beside its linked requirements; stepping
 * to a callee is a history entry; a reload restores the pair; an unlinked
 * symbol reads "no linked requirement", not an error. Rendered against fixture
 * API responses through the real router.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearApiCache } from '../hooks';
import { GraphPage } from '../pages/graph';
import { usePathRoute } from '../router';

const CREATE_SRC = 'export function createOrder(items) {\n  return { total: normalizeTotal(items) };\n}';
const NORM_SRC = 'export function normalizeTotal(items) {\n  return items.reduce((a, b) => a + b.price, 0);\n}';

const CREATE = { id: 'fn-create', name: 'createOrder', kind: 'function', filePath: 'src/orders.ts', startLine: 3, endLine: 5 };
const NORM = { id: 'fn-norm', name: 'normalizeTotal', kind: 'function', filePath: 'src/money.ts', startLine: 1, endLine: 3 };

const LINK = { id: 1, specId: 'REQ-ORDERS-001', kind: 'implements', state: 'verified', targetFilePath: 'src/orders.ts', targetQualifiedName: 'createOrder', resolvedNodeId: 'fn-create' };

const NODES: Record<string, unknown> = {
  'fn-create': { matches: [{ ...CREATE, code: CREATE_SRC, callers: [], callees: [NORM], linkedSpecs: [LINK] }] },
  'fn-norm': { matches: [{ ...NORM, code: NORM_SRC, callers: [CREATE], callees: [], linkedSpecs: [] }] },
};

const SPEC = {
  spec: { id: 'REQ-ORDERS-001', kind: 'requirement', title: 'Orders MUST total their items', body: 'Creating an order MUST compute its total from the line items.', sourcePath: 'specs/orders.md' },
  parent: null, siblings: [], children: [], links: [LINK], childLinks: {}, source: null,
};

const SEARCH: Record<string, unknown> = {
  'REQ-ORDERS-001': { specs: [{ id: 'REQ-ORDERS-001', title: SPEC.spec.title, kind: 'requirement', snippet: '' }], symbols: [] },
  createOrder: { specs: [], symbols: [{ id: 'fn-create', name: 'createOrder', kind: 'function', filePath: 'src/orders.ts', startLine: 3 }] },
};

const GRAPH_FULL = { nodes: [{ id: 'fn-create', name: 'createOrder', kind: 'function', filePath: 'src/orders.ts', degree: 1 }], edges: [], total: 1, shown: 1 };
const HEALTH = { linkHealth: {}, edgeKinds: {}, hubs: [], anchored: [] };

function mockFetch(): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    let body: unknown;
    if (u.pathname === '/api/graph/node') body = NODES[u.searchParams.get('id') ?? ''];
    else if (u.pathname === '/api/graph/split-search') body = SEARCH[u.searchParams.get('q') ?? ''] ?? { specs: [], symbols: [] };
    else if (u.pathname === '/api/spec/REQ-ORDERS-001') body = SPEC;
    else if (u.pathname === '/api/graph/full') body = GRAPH_FULL;
    else if (u.pathname === '/api/graph/health') body = HEALTH;
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    return { ok: true, json: async () => body };
  }));
  return calls;
}

/** GraphPage fed by the real History-API router, the way App mounts it. */
function Routed() {
  const r = usePathRoute();
  return <GraphPage project={null} query={r.query} />;
}

const left = () => screen.getByTestId('split-left');
const right = () => screen.getByTestId('split-right');

async function searchAndPick(text: string, optionKey: string): Promise<void> {
  const box = screen.getByRole('combobox', { name: 'Search specs and code' });
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  const opt = await screen.findByTestId('split-option-' + optionKey);
  fireEvent.mouseDown(opt);
}

/** Wait for a popstate-driven re-render after history.back(). */
async function back(): Promise<void> {
  await act(async () => {
    const popped = new Promise<void>((res) => window.addEventListener('popstate', () => res(), { once: true }));
    history.back();
    await popped;
  });
}

beforeEach(() => {
  history.replaceState(null, '', '/graph');
  __clearApiCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---- A1 ----

async function reqDashsimple005A1(): Promise<void> {
  const calls = mockFetch();
  render(<Routed />);
  await searchAndPick('REQ-ORDERS-001', 'spec:REQ-ORDERS-001');

  expect(new URLSearchParams(location.search).get('req')).toBe('REQ-ORDERS-001');
  expect(await within(left()).findByText(/compute its total from the line items/)).toBeTruthy();
  expect(within(left()).getByText('Orders MUST total their items')).toBeTruthy();
  const code = await within(right()).findByTestId('split-code-fn-create');
  expect(within(code).getByTestId('split-source').textContent).toBe(CREATE_SRC);
  // The code was fetched verbatim from the server, not reconstructed.
  expect(calls.some((c) => c.startsWith('/api/graph/node?id=fn-create') && c.includes('includeCode=1'))).toBe(true);
}

// ---- A2 ----

async function reqDashsimple005A2(): Promise<void> {
  mockFetch();
  render(<Routed />);
  await searchAndPick('createOrder', 'sym:fn-create');

  expect(new URLSearchParams(location.search).get('sym')).toBe('fn-create');
  const code = await within(right()).findByTestId('split-code-fn-create');
  expect(within(code).getByTestId('split-source').textContent).toBe(CREATE_SRC);
  expect(within(left()).getByTestId('split-linked-REQ-ORDERS-001')).toBeTruthy();
}

// ---- A3 ----

async function reqDashsimple005A3(): Promise<void> {
  mockFetch();
  history.replaceState(null, '', '/graph?sym=fn-create');
  render(<Routed />);
  await within(right()).findByTestId('split-code-fn-create');
  expect(within(left()).getByTestId('split-linked-REQ-ORDERS-001')).toBeTruthy();

  // Step to the callee: right side moves, left side updates to its (no) specs.
  fireEvent.click(within(right()).getByTestId('split-callee-normalizeTotal'));
  const normCode = await within(right()).findByTestId('split-code-fn-norm');
  expect(within(normCode).getByTestId('split-source').textContent).toBe(NORM_SRC);
  expect(new URLSearchParams(location.search).get('sym')).toBe('fn-norm');
  await waitFor(() => expect(within(left()).getByTestId('split-no-linked')).toBeTruthy());
  expect(within(left()).queryByTestId('split-linked-REQ-ORDERS-001')).toBeNull();

  // Back returns to the previous pair.
  await back();
  expect(new URLSearchParams(location.search).get('sym')).toBe('fn-create');
  await within(right()).findByTestId('split-code-fn-create');
  await waitFor(() => expect(within(left()).getByTestId('split-linked-REQ-ORDERS-001')).toBeTruthy());
}

// ---- A4 ----

async function reqDashsimple005A4(): Promise<void> {
  mockFetch();
  history.replaceState(null, '', '/graph?sym=fn-create');
  const first = render(<Routed />);
  await within(right()).findByTestId('split-code-fn-create');
  first.unmount();
  __clearApiCache();

  // A fresh mount at the same URL — what a reload does — restores the pair.
  render(<Routed />);
  const code = await within(right()).findByTestId('split-code-fn-create');
  expect(within(code).getByTestId('split-source').textContent).toBe(CREATE_SRC);
  expect(within(left()).getByTestId('split-linked-REQ-ORDERS-001')).toBeTruthy();

  // Same for a requirement URL.
  cleanup();
  history.replaceState(null, '', '/graph?req=REQ-ORDERS-001');
  render(<Routed />);
  expect(await within(left()).findByText(/compute its total/)).toBeTruthy();
  await within(right()).findByTestId('split-code-fn-create');
}

// ---- A5 ----

async function reqDashsimple005A5(): Promise<void> {
  mockFetch();
  history.replaceState(null, '', '/graph?sym=fn-norm');
  render(<Routed />);
  const code = await within(right()).findByTestId('split-code-fn-norm');
  expect(within(code).getByTestId('split-source').textContent).toBe(NORM_SRC);
  expect(within(left()).getByText('no linked requirement')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
}

describe('Graph split spec/code view (REQ-DASHSIMPLE-005)', () => {
  it('REQ-DASHSIMPLE-005.A1: searching a requirement ID shows its text left and each linked symbol source right', reqDashsimple005A1);
  it('REQ-DASHSIMPLE-005.A2: searching a function name shows its source right and its linked requirements left', reqDashsimple005A2);
  it('REQ-DASHSIMPLE-005.A3: clicking a callee moves both sides and Back returns to the previous pair', reqDashsimple005A3);
  it('REQ-DASHSIMPLE-005.A4: reloading at a split-view URL restores the same pair', reqDashsimple005A4);
  it('REQ-DASHSIMPLE-005.A5: an unlinked symbol shows its source and "no linked requirement", not an error', reqDashsimple005A5);
});
