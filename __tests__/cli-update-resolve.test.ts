/**
 * Tests for resolving the latest published version per install method
 * (REQ-CLI-UPDATE-002 / 004). `fetch` is injected so the parsing logic is
 * exercised without hitting the network.
 */
import { describe, it, expect } from 'vitest';
import { resolveLatestVersion } from '../src/update/resolve-latest';

function fakeFetch(impl: (url: string) => Partial<Response> & { url?: string }) {
  return (async (url: string) => impl(url) as Response) as unknown as typeof fetch;
}

describe('resolveLatestVersion — bundle (GitHub Releases)', () => {
  it('parses the version from the releases/latest redirect target', async () => {
    const f = fakeFetch(() => ({
      ok: true,
      status: 200,
      url: 'https://github.com/selvakumarEsra/specship/releases/tag/v0.11.8',
    }));
    expect(await resolveLatestVersion('bundle', f)).toBe('0.11.8');
  });

  it('throws when GitHub is unreachable (so runUpdate can fail cleanly)', async () => {
    const f = fakeFetch(() => { throw new Error('ENOTFOUND'); });
    await expect(resolveLatestVersion('bundle', f)).rejects.toThrow();
  });
});

describe('resolveLatestVersion — npm (registry dist-tags)', () => {
  it('reads dist-tags.latest from the npm registry', async () => {
    const f = fakeFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ 'dist-tags': { latest: '0.11.8' } }),
    }));
    expect(await resolveLatestVersion('npm', f)).toBe('0.11.8');
  });

  it('throws on a non-OK registry response', async () => {
    const f = fakeFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(resolveLatestVersion('npm', f)).rejects.toThrow();
  });
});
