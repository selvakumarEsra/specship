/**
 * REQ-THRU-001 — parallel batch runs.
 *
 * `specship workflow run-batch <workflow> --specs <ID,…>` starts one run per
 * requirement, each in its own worktree. Requirements whose `implementations:`
 * files overlap never run concurrently: the later one is placed in a later
 * wave and waits for the earlier wave to finish. No wave holds more runs than
 * the concurrency limit.
 */

import * as fs from 'fs';
import { findSpecFile, requirementBlock, linkBullets } from '../spec-quality/postcheck';

export const DEFAULT_BATCH_CONCURRENCY = 3;

export interface BatchSpec {
  id: string;
  implementationFiles: string[];
}

/** Statuses after which a run is finished (no longer holding its files). */
export const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'rejected']);

/**
 * Plan the waves. Specs are visited in input order; each goes into the
 * earliest wave that (a) comes after every wave holding a spec it shares an
 * implementation file with, and (b) still has room under `concurrency`.
 */
export function planBatch(specs: BatchSpec[], concurrency: number): string[][] {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const waves: string[][] = [];
  const waveOf = new Map<string, number>();
  const filesOf = new Map<string, Set<string>>();

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    if (waveOf.has(spec.id)) continue; // duplicate id — schedule once
    const files = new Set(spec.implementationFiles.map(normalizeFile));
    let minWave = 0;
    for (let j = 0; j < i; j++) {
      const earlier = specs[j]!;
      const w = waveOf.get(earlier.id);
      if (w === undefined) continue;
      const ef = filesOf.get(earlier.id)!;
      for (const f of files) {
        if (ef.has(f)) {
          minWave = Math.max(minWave, w + 1);
          break;
        }
      }
    }
    let wave = minWave;
    while (waves[wave] && waves[wave]!.length >= limit) wave++;
    while (waves.length <= wave) waves.push([]);
    waves[wave]!.push(spec.id);
    waveOf.set(spec.id, wave);
    filesOf.set(spec.id, files);
  }
  return waves.filter((w) => w.length > 0);
}

function normalizeFile(f: string): string {
  return f.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Implementation files of a requirement, read from its spec file's
 * `implementations:` block (`path:Symbol` bullets → `path`). Null when the
 * requirement is not found under specs/.
 */
export function implementationFilesFor(projectRoot: string, requirementId: string): string[] | null {
  const specFile = findSpecFile(projectRoot, requirementId);
  if (!specFile) return null;
  const block = requirementBlock(fs.readFileSync(specFile, 'utf8'), requirementId);
  if (block === null) return null;
  const files = new Set<string>();
  for (const bullet of linkBullets(block, 'implementations')) {
    const target = bullet.replace(/^`|`$/g, '').trim();
    const colon = target.indexOf(':');
    const file = normalizeFile(colon > 0 ? target.slice(0, colon) : target);
    if (file) files.add(file);
  }
  return [...files];
}

export interface BatchRunResult {
  specId: string;
  runId: string;
  status: string;
  wave: number;
}

export interface RunBatchOptions {
  projectRoot: string;
  specIds: string[];
  concurrency?: number;
  /** Start one run for a requirement; resolves once the run is started/settled. */
  startRun: (specId: string) => Promise<{ runId: string; status: string }>;
  /**
   * Wait until a started run is finished. Default: the run is finished when
   * `startRun` resolves. The CLI waits for a terminal status so a run paused
   * at an approval still holds its files.
   */
  waitForRun?: (runId: string, status: string) => Promise<string>;
  /** Resolve a requirement's implementation files (default: its spec file). */
  resolveFiles?: (specId: string) => string[] | null;
  /** Called with the full plan before any run starts. */
  onPlan?: (waves: string[][]) => void;
  /** Called as each run is started. */
  onRunStarted?: (run: BatchRunResult) => void;
}

export interface RunBatchResult {
  waves: string[][];
  runs: BatchRunResult[];
}

/** Start the runs wave by wave; a wave finishes before the next one starts. */
export async function runBatch(opts: RunBatchOptions): Promise<RunBatchResult> {
  const resolve = opts.resolveFiles ?? ((id: string) => implementationFilesFor(opts.projectRoot, id));
  const specs: BatchSpec[] = [];
  const missing: string[] = [];
  for (const id of opts.specIds) {
    const files = resolve(id);
    if (files === null) missing.push(id);
    else specs.push({ id, implementationFiles: files });
  }
  if (missing.length > 0) {
    throw new Error(`Requirement(s) not found under specs/: ${missing.join(', ')}`);
  }
  const waves = planBatch(specs, opts.concurrency ?? DEFAULT_BATCH_CONCURRENCY);
  opts.onPlan?.(waves);

  const runs: BatchRunResult[] = [];
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w]!;
    const settled = await Promise.all(
      wave.map(async (specId) => {
        const started = await opts.startRun(specId);
        const run: BatchRunResult = { specId, runId: started.runId, status: started.status, wave: w };
        opts.onRunStarted?.(run);
        if (opts.waitForRun) run.status = await opts.waitForRun(started.runId, started.status);
        return run;
      }),
    );
    runs.push(...settled);
  }
  return { waves, runs };
}
