/**
 * Runtime settings files (RUNSET-DOC).
 *
 * SpecShip's behavior switches are env-var-shaped; these files let a repo
 * (or a machine) set durable defaults without touching Claude Code's own
 * settings:
 *
 *   explicit env var                     — always wins (ad-hoc override)
 *   <repo>/.specship/settings.json      — travels with the project
 *   ~/.specship/settings.json           — machine-wide install defaults
 *
 * Keys ARE the env-var names ("SPECSHIP_NO_STEERING": "1") so env, files,
 * and the generated reference share one vocabulary. String values only;
 * non-SPECSHIP_ keys ignored. Reads are best-effort — a corrupt file must
 * never break a hook or a tool call (REQ-RUNSET-001.A4).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function readSettingsFile(filePath: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('SPECSHIP_') && typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Paths, exposed for tests and docs. */
export function projectSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.specship', 'settings.json');
}
export function installSettingsPath(homedir: string = os.homedir()): string {
  return path.join(homedir, '.specship', 'settings.json');
}

/**
 * Resolve one switch with env > project file > install file precedence
 * (REQ-RUNSET-001). `projectRoot` null skips the project layer.
 */
export function resolveSetting(
  name: string,
  projectRoot: string | null,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir()
): string | undefined {
  const fromEnv = env[name];
  if (fromEnv !== undefined) return fromEnv;
  if (projectRoot) {
    const project = readSettingsFile(projectSettingsPath(projectRoot));
    if (name in project) return project[name];
  }
  const install = readSettingsFile(installSettingsPath(homedir));
  if (name in install) return install[name];
  return undefined;
}
