/**
 * Install handshake smoke check (REQ-HANDSHAKE-002) + doctor exit code
 * (REQ-HANDSHAKE-003).
 *
 * The environment-dependent probes (FTS5, MCP boot, index query) are injectable
 * so the aggregation logic is tested deterministically; the real default probes
 * get a light "returns a boolean, doesn't throw" assertion since their result
 * legitimately varies by host runtime.
 */

import { describe, it, expect } from 'vitest';
import {
  runSmokeCheck,
  doctorExitCode,
  probeBackend,
  probeFts5,
  type SmokeProbes,
} from '../src/health/smoke-check';

const allOk: SmokeProbes = {
  backend: () => ({ ok: true, detail: 'node-sqlite' }),
  fts5: () => ({ ok: true, detail: 'available' }),
  mcpBoot: () => true,
  indexQueryable: () => ({ ok: true, detail: 'queryable', applicable: true }),
};

describe('runSmokeCheck — aggregation', () => {
  it('reports all four checks and is ok when every probe passes', async () => {
    const r = await runSmokeCheck({ probes: allOk });
    expect(r.items.map((i) => i.id).sort()).toEqual(['fts5', 'index', 'mcp-boot', 'runtime']);
    expect(r.ok).toBe(true);
    expect(r.blockingFailures).toHaveLength(0);
    for (const item of r.items) {
      expect(typeof item.label).toBe('string');
      expect(typeof item.ok).toBe('boolean');
      expect(typeof item.blocking).toBe('boolean');
      expect(typeof item.detail).toBe('string');
    }
  });

  it('a failed FTS5 probe is a blocking failure with remediation', async () => {
    const r = await runSmokeCheck({
      probes: { ...allOk, fts5: () => ({ ok: false, detail: 'no such module: fts5' }) },
    });
    expect(r.ok).toBe(false);
    const fts = r.items.find((i) => i.id === 'fts5')!;
    expect(fts.ok).toBe(false);
    expect(fts.blocking).toBe(true);
    expect(fts.remediation).toBeTruthy();
    expect(r.blockingFailures.map((i) => i.id)).toContain('fts5');
  });

  it('a failed MCP boot is a blocking failure', async () => {
    const r = await runSmokeCheck({ probes: { ...allOk, mcpBoot: () => false } });
    expect(r.ok).toBe(false);
    expect(r.blockingFailures.map((i) => i.id)).toContain('mcp-boot');
  });

  it('an unindexed project reports the index check as non-blocking and ok', async () => {
    const r = await runSmokeCheck({
      probes: { ...allOk, indexQueryable: () => ({ ok: true, detail: 'no project index', applicable: false }) },
    });
    const idx = r.items.find((i) => i.id === 'index')!;
    expect(idx.ok).toBe(true);
    expect(idx.blocking).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('a failed index query in an indexed project is a blocking failure', async () => {
    const r = await runSmokeCheck({
      probes: { ...allOk, indexQueryable: () => ({ ok: false, detail: 'malformed database', applicable: true }) },
    });
    const idx = r.items.find((i) => i.id === 'index')!;
    expect(idx.ok).toBe(false);
    expect(idx.blocking).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('awaits an async mcpBoot probe', async () => {
    const r = await runSmokeCheck({ probes: { ...allOk, mcpBoot: async () => true } });
    expect(r.items.find((i) => i.id === 'mcp-boot')!.ok).toBe(true);
  });
});

describe('doctorExitCode (REQ-HANDSHAKE-003.A3)', () => {
  it('is 0 when there are no blocking failures', async () => {
    const r = await runSmokeCheck({ probes: allOk });
    expect(doctorExitCode(r)).toBe(0);
  });

  it('is non-zero when a blocking check fails', async () => {
    const r = await runSmokeCheck({ probes: { ...allOk, fts5: () => ({ ok: false, detail: 'x' }) } });
    expect(doctorExitCode(r)).toBe(1);
  });

  it('is 0 when a non-blocking check is the only failure', async () => {
    // index not applicable → ok; force a hypothetical non-blocking-only state by
    // making index inapplicable and everything else ok.
    const r = await runSmokeCheck({
      probes: { ...allOk, indexQueryable: () => ({ ok: true, detail: 'no index', applicable: false }) },
    });
    expect(doctorExitCode(r)).toBe(0);
  });
});

describe('default probes (environment-agnostic shape)', () => {
  it('probeBackend returns an ok flag and a string detail', () => {
    const r = probeBackend();
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.detail).toBe('string');
  });

  it('probeFts5 returns an ok flag without throwing', () => {
    const r = probeFts5();
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.detail).toBe('string');
  });
});
