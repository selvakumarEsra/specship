/**
 * Persisted server runtime config — the settings the dashboard can change
 * at runtime and that must survive a restart (REQ-DESKTOP-028.A2). Lives at
 * `~/.specship/server-config.json` (user-level, not per-project: the ingest
 * watcher reads every project's transcripts). `SPECSHIP_SERVER_CONFIG`
 * overrides the path so tests never touch the real home directory.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ServerConfig {
  /** Claude Code JSONL transcript ingest on/off. Absent = enabled. */
  ingestEnabled?: boolean;
}

export function serverConfigPath(): string {
  return process.env.SPECSHIP_SERVER_CONFIG
    ?? path.join(os.homedir(), '.specship', 'server-config.json');
}

export function readServerConfig(): ServerConfig {
  try {
    const raw = fs.readFileSync(serverConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as ServerConfig;
  } catch { /* missing or corrupt → defaults */ }
  return {};
}

/**
 * Merge `patch` into the stored config and write it back atomically:
 * write to a sibling temp file, then rename over the target. A crash
 * mid-write can never leave a truncated JSON file behind.
 */
export function writeServerConfig(patch: Partial<ServerConfig>): ServerConfig {
  const merged = { ...readServerConfig(), ...patch };
  const file = serverConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
  return merged;
}
