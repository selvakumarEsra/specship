import { describe, it, expect } from 'vitest';
import { ProjectRegistry } from '../packages/server/src/project-registry';

/**
 * Regression: the /api/events cross-project sweep opens many projects
 * through the registry; the LRU then evicted — and CLOSED — the primary
 * instance that routes hold by reference (`app.primaryCg`), turning every
 * subsequent request into a 500 ("database connection is not open").
 * A pinned path must never be evicted.
 */
describe('ProjectRegistry.pin', () => {
  function makeRegistry(maxOpen: number, closed: string[]) {
    return new ProjectRegistry(
      {
        maxOpen,
        openImpl: async (p: string) =>
          ({ close: () => { closed.push(p); } }) as never,
        resolveSlug: (s: string) => s,
      },
      async () => { throw new Error('unused'); },
    );
  }

  it('never evicts (and thus never closes) a pinned instance', async () => {
    const closed: string[] = [];
    const registry = makeRegistry(2, closed);

    await registry.get('/primary');
    registry.pin('/primary');
    await registry.get('/a');
    await registry.get('/b'); // over capacity — evicts the LRU non-pinned entry
    await registry.get('/c');

    expect(closed).not.toContain('/primary');
    expect(registry.has('/primary')).toBe(true);
    expect(closed.length).toBeGreaterThan(0); // eviction still happens for others
  });

  it('evicts the oldest non-pinned entry under pressure', async () => {
    const closed: string[] = [];
    const registry = makeRegistry(1, closed);

    await registry.get('/pinned');
    registry.pin('/pinned');
    await registry.get('/x');
    await registry.get('/y');

    expect(closed).toContain('/x');
    expect(closed).not.toContain('/pinned');
  });
});
