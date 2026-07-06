/**
 * REQ-DESKTOP-031 — performance budgets. A1 (gzip bundle budget) and the real
 * dist check live in the root __tests__/ui-build-guard suite. Here: A3 the
 * session cache means a screen revisit issues no duplicate fetch (and reload
 * still forces a fresh one), and A4 the graph force layout is bounded so a
 * large node set can't spin an O(n²) main-thread stall.
 */
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi, __clearApiCache } from '../hooks';
import { forceLayout } from '../components/graph';

function Probe({ fetcher, cacheKey }: { fetcher: () => Promise<string>; cacheKey?: string }) {
  const s = useApi(fetcher, [], cacheKey ? { cacheKey } : {});
  return <div>{s.loading ? 'loading' : (s.data ?? 'empty')}</div>;
}

beforeEach(() => { __clearApiCache(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('session cache — no duplicate fetches (REQ-DESKTOP-031.A3)', () => {
  it('a second mount under the same cacheKey issues zero additional fetches', async () => {
    const fetcher = vi.fn(async () => 'PAYLOAD');

    const first = render(<Probe fetcher={fetcher} cacheKey="k1" />);
    expect(await screen.findByText('PAYLOAD')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    first.unmount();

    // Revisit the "screen": data paints from cache, no new fetch.
    render(<Probe fetcher={fetcher} cacheKey="k1" />);
    expect(screen.getByText('PAYLOAD')).toBeTruthy(); // instant, no loading flash
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('without a cacheKey every mount fetches (opt-in only)', async () => {
    const fetcher = vi.fn(async () => 'X');
    const a = render(<Probe fetcher={fetcher} />);
    expect(await screen.findByText('X')).toBeTruthy();
    a.unmount();
    render(<Probe fetcher={fetcher} />);
    expect(await screen.findByText('X')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reload() forces a fresh fetch past the cache', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => `v${++n}`);
    function WithReload() {
      const s = useApi(fetcher, [], { cacheKey: 'k2' });
      return <button onClick={s.reload}>{s.data ?? 'none'}</button>;
    }
    render(<WithReload />);
    expect(await screen.findByText('v1')).toBeTruthy();
    await act(async () => { screen.getByRole('button').click(); });
    expect(await screen.findByText('v2')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('graph force layout is bounded (REQ-DESKTOP-031.A4)', () => {
  const mkNodes = (n: number, kind = 'code') =>
    Array.from({ length: n }, (_, i) => ({ id: `n${i}`, name: `n${i}`, kind, filePath: `f${i}.ts` }));

  it('lays out every node and skips O(n^2) repulsion past the cap', () => {
    // 1200 nodes — above FORCE_REPULSION_CAP (600). Must still return one
    // position per node and finish without hanging (the repulsion pass is
    // skipped, so this is linear, not quadratic).
    const n = 1200;
    const nodes = mkNodes(n);
    const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    const out = forceLayout(nodes, edges);
    expect(out.length).toBe(n);
    for (const id of ['n0', 'n599', 'n1199']) {
      const p = out.find((q) => q.id === id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('is deterministic — same input, same positions (no Math.random)', () => {
    const nodes = mkNodes(40, 'spec');
    const edges = [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }];
    expect(forceLayout(nodes, edges)).toEqual(forceLayout(nodes, edges));
  });
});
