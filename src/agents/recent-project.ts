/**
 * The project `specship desktop` opens when none is given (REQ-AGENTSWITCH-011):
 * the most recently active project that still exists and is `specship init`'d,
 * from every source that knows a project path — the installed-agents record
 * (any agent) and each agent's own record of where it was used
 * (REQ-AGENTSWITCH-019.A1).
 */

import * as fs from 'fs';
import * as os from 'os';
import { isInitialized } from '../directory';
import { allTargets } from '../installer/targets/registry';
import { readAgentRecord } from '../installer/agent-record';

/**
 * Auto-pick a default project for `specship desktop` when the user
 * didn't pass `-p` and the cwd isn't initialized either. Asks every agent
 * target where it was used, and returns the most-recently-touched project
 * that's still on disk AND has been `specship init`'d.
 *
 * Returns null when nothing qualifies — the server boots projectless and
 * the desktop UI prompts the user to pick.
 */
export async function pickRecentInitializedProject(): Promise<string | null> {
  type Candidate = { decoded: string; lastTouched: number };
  const candidates: Candidate[] = [];
  try {
    for (const e of readAgentRecord()?.entries ?? []) {
      if (e.scope !== 'local' || !e.projectRoot) continue;
      if (!fs.existsSync(e.projectRoot) || !isInitialized(e.projectRoot)) continue;
      candidates.push({ decoded: e.projectRoot, lastTouched: Date.parse(e.recordedAt) || 0 });
    }
  } catch { /* the record is advisory */ }
  for (const target of allTargets()) {
    let found: Array<{ root: string; lastTouched: number }> = [];
    try { found = target.recentProjects?.(os.homedir()) ?? []; } catch { /* one agent's files never block another's */ }
    for (const { root, lastTouched } of found) {
      try {
        if (!fs.statSync(root).isDirectory()) continue;
      } catch { continue; }
      if (!isInitialized(root)) continue;
      candidates.push({ decoded: root, lastTouched });
    }
  }
  candidates.sort((a, b) => b.lastTouched - a.lastTouched);
  return candidates[0]?.decoded ?? null;
}
