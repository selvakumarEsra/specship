/**
 * Mutation-score gate (REQ-QGATE-002).
 *
 * A `tests` link proves a test exists and passed — not that it would notice
 * the implementation breaking (agent-written suites average high coverage but
 * low mutant kill rates). This gate closes that: per spec, the kill rate of
 * mutants in its linked implementation files must clear a threshold for the
 * test evidence to count as strong.
 *
 * SpecShip does NOT run the mutation tool. It consumes a checked-in/CI-produced
 * report in the cross-tool mutation-testing-report-schema JSON (StrykerJS and
 * friends emit it natively; mutmut ecosystems convert). That keeps
 * `specship check` deterministic and fast, and keeps the tool choice with the
 * project. Opt-in via `specship.config.json` → `enforce.mutation`; with no
 * config the check does not exist and the gate's output is unchanged (A1).
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from './enforce';

export const DEFAULT_MUTATION_THRESHOLD = 0.8;
export const DEFAULT_MUTATION_REPORT = 'reports/mutation/mutation.json';

/** Per-file mutant stats: killed includes Timeout (the mutant didn't survive). */
export interface MutationFileStats {
  killed: number;
  total: number;
}

export interface MutationConfig {
  /** Project-relative path of the mutation-testing-report-schema JSON. */
  report?: string;
  /** Minimum kill rate (0–1) for a spec's implementation files. */
  threshold?: number;
}

/** Deps snapshot the enforcement evaluation consumes. */
export interface MutationDeps {
  /** Null when the report could not be read — the check reports skipped (A3). */
  stats: Map<string, MutationFileStats> | null;
  reason?: string;
  threshold: number;
  reportPath: string;
}

/** Mutant statuses that count as caught by the suite. */
const CAUGHT = new Set(['Killed', 'Timeout']);
/** Statuses that count toward the denominator (detectable-in-principle). */
const COUNTED = new Set(['Killed', 'Timeout', 'Survived', 'NoCoverage']);

/**
 * Parse a mutation-testing-report-schema JSON into per-file kill stats.
 * File keys are normalized to project-relative forward-slash paths so they
 * compare against link target paths.
 */
export function parseMutationReport(json: string): Map<string, MutationFileStats> {
  const parsed = JSON.parse(json) as { files?: Record<string, { mutants?: Array<{ status?: string }> }> };
  const out = new Map<string, MutationFileStats>();
  for (const [file, data] of Object.entries(parsed.files ?? {})) {
    let killed = 0;
    let total = 0;
    for (const m of data.mutants ?? []) {
      const status = m.status ?? '';
      if (!COUNTED.has(status)) continue;
      total++;
      if (CAUGHT.has(status)) killed++;
    }
    out.set(normalizePath(file), { killed, total });
  }
  return out;
}

/** Assemble the deps snapshot from disk — missing/unreadable report → skipped. */
export function loadMutationDeps(projectRoot: string, cfg: MutationConfig = {}): MutationDeps {
  const reportPath = cfg.report ?? DEFAULT_MUTATION_REPORT;
  const threshold = cfg.threshold ?? DEFAULT_MUTATION_THRESHOLD;
  try {
    const json = fs.readFileSync(path.join(projectRoot, reportPath), 'utf-8');
    return { stats: parseMutationReport(json), threshold, reportPath };
  } catch (err) {
    return {
      stats: null,
      reason: `mutation report not readable: ${reportPath} (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
      threshold,
      reportPath,
    };
  }
}
