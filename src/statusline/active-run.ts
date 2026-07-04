/**
 * Active workflow run marker (REQ-STATUSLINE-005.A4).
 *
 * The workflow executor writes the in-flight run's spec ID + status here on
 * each status change so the status-line reader can surface it without opening
 * the `workflow_runs` table (which would mean a DB connection on the render
 * path). `clearActiveRun` removes the marker when no run is active.
 */

import * as fs from 'fs';
import { ActiveRun, ActiveRunEta } from './types';
import { activeRunPath, writeJsonAtomic, readJsonSafe } from './paths';

/** Atomically record the active run. Best-effort; never throws. */
export function writeActiveRun(
  projectRoot: string,
  specId: string | null,
  status: string,
  eta?: ActiveRunEta,
): void {
  const data: ActiveRun = { v: 1, specId, status, updatedAt: Date.now(), ...(eta ? { eta } : {}) };
  try {
    writeJsonAtomic(activeRunPath(projectRoot), data);
  } catch {
    /* best-effort */
  }
}

/** Remove the active-run marker (e.g. once a run is merged/cancelled). */
export function clearActiveRun(projectRoot: string): void {
  try {
    fs.unlinkSync(activeRunPath(projectRoot));
  } catch {
    /* already absent */
  }
}

/** Read the active-run marker, or null when none. */
export function readActiveRun(projectRoot: string): ActiveRun | null {
  const r = readJsonSafe<ActiveRun>(activeRunPath(projectRoot));
  return r && r.v === 1 ? r : null;
}
