/**
 * Projects SpecShip is installed in, from the installed-agents record
 * (REQ-AGENTSWITCH-006) — the agent-neutral source of project paths
 * (REQ-AGENTSWITCH-011). An agent whose session folders cannot be mapped back
 * to a path (Gemini CLI names them by a one-way hash of it) still has its
 * projects found here. SpecShip's own file, read directly: the server never
 * imports the CLI package.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface RecordedProject {
  /** Absolute project root. */
  path: string;
  /** Agents recorded as installed in it, e.g. `['gemini']`. */
  agents: string[];
  /** Epoch ms of the newest record entry for the project. */
  recordedAtMs: number;
}

/** `$SPECSHIP_INSTALL_DIR` or `~/.specship` — the same rule the CLI uses. */
export function installedAgentsRecordPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return path.join(env.SPECSHIP_INSTALL_DIR || path.join(home, '.specship'), 'installed-agents.json');
}

/** Every project-scoped entry in the record, one row per project. Never throws. */
export function recordedProjects(recordPath: string = installedAgentsRecordPath()): RecordedProject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
  } catch {
    return [];
  }
  const entries = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  const byPath = new Map<string, RecordedProject>();
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const { scope, projectRoot, agent, recordedAt } = e as Record<string, unknown>;
    if (scope !== 'local' || typeof projectRoot !== 'string' || !projectRoot) continue;
    const at = typeof recordedAt === 'string' ? Date.parse(recordedAt) || 0 : 0;
    const row = byPath.get(projectRoot) ?? { path: projectRoot, agents: [], recordedAtMs: 0 };
    if (typeof agent === 'string' && !row.agents.includes(agent)) row.agents.push(agent);
    row.recordedAtMs = Math.max(row.recordedAtMs, at);
    byPath.set(projectRoot, row);
  }
  return [...byPath.values()];
}
