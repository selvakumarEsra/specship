/**
 * THROUGHPUT-DOC REQ-THRU-001 — parallel batch runs: disjoint requirements
 * share a wave, overlapping ones are serialized in input order, and no wave
 * exceeds the concurrency limit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { planBatch, runBatch, implementationFilesFor } from '../src/workflows/batch';

function writeSpec(dir: string, reqs: Array<{ id: string; impls: string[] }>): void {
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  const body = reqs
    .map((r) => [
      `<!-- id: ${r.id} -->`,
      `## ${r.id}`,
      '',
      'Some prose.',
      '',
      'implementations:',
      ...r.impls.map((i) => `  - ${i}`),
      '',
      '## Acceptance',
      `<!-- id: ${r.id}.A1 -->`,
      '- a criterion',
      '',
    ].join('\n'))
    .join('\n');
  fs.writeFileSync(path.join(dir, 'specs', 'batch.md'), `---\nid: BATCH-DOC\n---\n\n<!-- id: BATCH-DOC -->\n# Batch\n\n${body}`);
}

/** Records how many runs are in flight at once and in which order they start. */
function trackingStarter() {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const concurrentWith = new Map<string, Set<string>>();
  const live = new Set<string>();
  const startRun = async (specId: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    started.push(specId);
    for (const other of live) {
      concurrentWith.get(other)!.add(specId);
    }
    concurrentWith.set(specId, new Set(live));
    live.add(specId);
    await new Promise((r) => setTimeout(r, 15));
    live.delete(specId);
    inFlight--;
    return { runId: `run-${specId}`, status: 'completed' };
  };
  return { startRun, started, concurrentWith, max: () => maxInFlight };
}

describe('workflow run-batch (REQ-THRU-001)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-batch-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('REQ-THRU-001.A1 — three requirements with disjoint implementation files run in one wave', async function disjointSpecsRunConcurrently() {
    writeSpec(dir, [
      { id: 'REQ-B-001', impls: ['src/a.ts:alpha'] },
      { id: 'REQ-B-002', impls: ['src/b.ts:beta', 'src/b2.ts:beta2'] },
      { id: 'REQ-B-003', impls: ['src/c.ts:gamma'] },
    ]);
    expect(implementationFilesFor(dir, 'REQ-B-002')).toEqual(['src/b.ts', 'src/b2.ts']);

    const t = trackingStarter();
    const result = await runBatch({
      projectRoot: dir,
      specIds: ['REQ-B-001', 'REQ-B-002', 'REQ-B-003'],
      concurrency: 3,
      startRun: t.startRun,
    });
    expect(result.waves).toEqual([['REQ-B-001', 'REQ-B-002', 'REQ-B-003']]);
    expect(t.max()).toBe(3);
    expect(result.runs.map((r) => r.runId)).toEqual(['run-REQ-B-001', 'run-REQ-B-002', 'run-REQ-B-003']);
    expect(result.runs.every((r) => r.wave === 0)).toBe(true);
  });

  it('REQ-THRU-001.A2 — two requirements sharing a file go to different waves, in the order given', async function overlappingSpecsAreSerialized() {
    writeSpec(dir, [
      { id: 'REQ-B-010', impls: ['src/shared.ts:one'] },
      { id: 'REQ-B-011', impls: ['src/shared.ts:two', 'src/other.ts:x'] },
      { id: 'REQ-B-012', impls: ['src/free.ts:y'] },
    ]);
    // Given order 011 before 010: the later (010) waits for the earlier (011).
    expect(
      planBatch(
        [
          { id: 'REQ-B-011', implementationFiles: ['src/shared.ts'] },
          { id: 'REQ-B-010', implementationFiles: ['./src/shared.ts'] },
        ],
        3,
      ),
    ).toEqual([['REQ-B-011'], ['REQ-B-010']]);

    const t = trackingStarter();
    const result = await runBatch({
      projectRoot: dir,
      specIds: ['REQ-B-010', 'REQ-B-011', 'REQ-B-012'],
      concurrency: 3,
      startRun: t.startRun,
    });
    expect(result.waves).toEqual([['REQ-B-010', 'REQ-B-012'], ['REQ-B-011']]);
    // The overlapping pair never ran at the same time; 011 started after 010.
    expect(t.concurrentWith.get('REQ-B-010')!.has('REQ-B-011')).toBe(false);
    expect(t.concurrentWith.get('REQ-B-011')!.has('REQ-B-010')).toBe(false);
    expect(t.started.indexOf('REQ-B-011')).toBeGreaterThan(t.started.indexOf('REQ-B-010'));
  });

  it('REQ-THRU-001.A3 — no wave holds more runs than the concurrency limit', async function concurrencyLimitIsRespected() {
    const specs = Array.from({ length: 5 }, (_, i) => ({ id: `REQ-B-02${i}`, implementationFiles: [`src/f${i}.ts`] }));
    const waves = planBatch(specs, 2);
    expect(waves).toEqual([['REQ-B-020', 'REQ-B-021'], ['REQ-B-022', 'REQ-B-023'], ['REQ-B-024']]);
    for (const w of waves) expect(w.length).toBeLessThanOrEqual(2);

    const t = trackingStarter();
    const files = new Map(specs.map((s) => [s.id, s.implementationFiles]));
    const result = await runBatch({
      projectRoot: dir,
      specIds: specs.map((s) => s.id),
      concurrency: 2,
      startRun: t.startRun,
      resolveFiles: (id) => files.get(id) ?? null,
    });
    expect(result.waves).toEqual(waves);
    expect(t.max()).toBeLessThanOrEqual(2);

    // An unknown requirement is refused before any run starts.
    const t2 = trackingStarter();
    await expect(
      runBatch({ projectRoot: dir, specIds: ['REQ-NOPE-1'], concurrency: 2, startRun: t2.startRun }),
    ).rejects.toThrow(/REQ-NOPE-1/);
    expect(t2.started).toEqual([]);
  });
});
