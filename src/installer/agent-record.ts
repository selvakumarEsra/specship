/**
 * Installed-agents record (REQ-AGENTSWITCH-006).
 *
 * One small JSON file in the user's SpecShip home that lists every agent
 * SpecShip is wired into, at which scope, and for which project. Install and
 * uninstall keep it current; `specship update` and the bundle installer read
 * it to reinstall for every recorded agent, not just the default one.
 *
 * Agent-agnostic by construction: entries are keyed by the registry's
 * `TargetId`, detection goes through each target's own `detect()`, and no
 * host config path or event name appears here.
 *
 * Credentials never enter the file (A4): entries are built from a fixed
 * whitelist of fields — agent id, scope, project root, version, time — and
 * nothing read from an agent config (its `env` block, tokens, …) is copied.
 *
 * Fs/path only — must stay importable without native modules (installer rule).
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveInstallDir } from '../update/updater';
import { ALL_TARGETS } from './targets/registry';
import type { AgentTarget, Location, TargetId } from './targets/types';

export const AGENT_RECORD_FILE = 'installed-agents.json';

export interface AgentRecordEntry {
  agent: TargetId;
  scope: Location;
  /** Absolute project root — present only when `scope === 'local'`. */
  projectRoot?: string;
  /** SpecShip version that wrote the entry. */
  version: string;
  /** ISO-8601 time the entry was written. */
  recordedAt: string;
  /**
   * The opt-in choices that install was made with, so a reinstall (update,
   * bundle) repeats them instead of re-enabling what the user turned off.
   * Booleans only — never config contents (A4). Absent for entries rebuilt
   * from config files, where the original choices are unknown.
   */
  choices?: InstallChoices;
}

export interface InstallChoices {
  sdd?: boolean;
  autoAllow?: boolean;
  statusLine?: boolean;
}

export interface AgentRecord {
  schemaVersion: 1;
  entries: AgentRecordEntry[];
}

export function agentRecordPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveInstallDir(env), AGENT_RECORD_FILE);
}

/** The running SpecShip version (package.json two levels above this module). */
export function currentSpecshipVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const KNOWN_AGENTS = new Set<string>(ALL_TARGETS.map((t) => t.id));

/**
 * Whitelist one entry (A4): only the five known fields survive, each
 * type-checked. Anything else — including fields a future or tampered file
 * carries — is dropped. Returns null for an entry that is not well-formed.
 */
function sanitizeEntry(raw: unknown): AgentRecordEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.agent !== 'string' || !KNOWN_AGENTS.has(r.agent)) return null;
  if (r.scope !== 'global' && r.scope !== 'local') return null;
  if (typeof r.version !== 'string' || typeof r.recordedAt !== 'string') return null;
  const entry: AgentRecordEntry = {
    agent: r.agent as TargetId,
    scope: r.scope,
    version: r.version,
    recordedAt: r.recordedAt,
  };
  if (r.scope === 'local') {
    if (typeof r.projectRoot !== 'string' || r.projectRoot.length === 0) return null;
    entry.projectRoot = r.projectRoot;
  }
  if (r.choices && typeof r.choices === 'object') {
    const c = r.choices as Record<string, unknown>;
    const choices: InstallChoices = {};
    for (const k of ['sdd', 'autoAllow', 'statusLine'] as const) {
      if (typeof c[k] === 'boolean') choices[k] = c[k] as boolean;
    }
    if (Object.keys(choices).length > 0) entry.choices = choices;
  }
  return entry;
}

/** Read the record; null when missing, not JSON, or the wrong shape. */
export function readAgentRecord(env: NodeJS.ProcessEnv = process.env): AgentRecord | null {
  let text: string;
  try {
    text = fs.readFileSync(agentRecordPath(env), 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (p.schemaVersion !== 1 || !Array.isArray(p.entries)) return null;
  const entries: AgentRecordEntry[] = [];
  // A malformed entry (or one naming an agent this version doesn't know,
  // e.g. written by a newer SpecShip) is skipped, never a reason to discard
  // and rebuild the whole record — a rebuild only sees the current project,
  // so it would drop every other project's local entries.
  for (const e of p.entries) {
    const clean = sanitizeEntry(e);
    if (clean) entries.push(clean);
  }
  return { schemaVersion: 1, entries };
}

function serialize(record: AgentRecord): string {
  const entries = record.entries
    .map((e) => sanitizeEntry(e))
    .filter((e): e is AgentRecordEntry => e !== null);
  return JSON.stringify({ schemaVersion: 1, entries }, null, 2) + '\n';
}

/**
 * Write the record atomically (temp file + rename). Skips the write when the
 * file already holds exactly these bytes, so read-mostly commands never
 * rewrite the SpecShip home. Returns whether it wrote.
 */
export function writeAgentRecord(record: AgentRecord, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = agentRecordPath(env);
  const next = serialize(record);
  try {
    if (fs.readFileSync(file, 'utf-8') === next) return false;
  } catch {
    // missing / unreadable → write
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return true;
}

function sameKey(e: AgentRecordEntry, agent: TargetId, scope: Location, projectRoot?: string): boolean {
  if (e.agent !== agent || e.scope !== scope) return false;
  if (scope === 'global') return true;
  return path.resolve(e.projectRoot ?? '') === path.resolve(projectRoot ?? '');
}

function makeEntry(
  agent: TargetId,
  scope: Location,
  projectRoot: string | undefined,
  version: string,
  choices?: InstallChoices,
): AgentRecordEntry {
  const entry: AgentRecordEntry = { agent, scope, version, recordedAt: new Date().toISOString() };
  if (scope === 'local') entry.projectRoot = path.resolve(projectRoot ?? process.cwd());
  if (choices) {
    const clean: InstallChoices = {};
    for (const k of ['sdd', 'autoAllow', 'statusLine'] as const) {
      if (typeof choices[k] === 'boolean') clean[k] = choices[k];
    }
    if (Object.keys(clean).length > 0) entry.choices = clean;
  }
  return entry;
}

/** Add or replace the entry keyed by (agent, scope, projectRoot). */
export function recordInstall(
  agent: TargetId,
  scope: Location,
  projectRoot: string | undefined,
  version: string = currentSpecshipVersion(),
  env: NodeJS.ProcessEnv = process.env,
  choices?: InstallChoices,
): AgentRecord {
  // A missing/unreadable record is rebuilt first, so other agents' entries
  // are not lost when this install is the first write.
  const current = readAgentRecord(env) ?? rebuildAgentRecord(projectRoot ?? process.cwd(), ALL_TARGETS, version);
  const entries = current.entries.filter((e) => !sameKey(e, agent, scope, projectRoot));
  entries.push(makeEntry(agent, scope, projectRoot, version, choices));
  const record: AgentRecord = { schemaVersion: 1, entries };
  writeAgentRecord(record, env);
  return record;
}

/** Remove the entry keyed by (agent, scope, projectRoot); no write when absent. */
export function recordUninstall(
  agent: TargetId,
  scope: Location,
  projectRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentRecord | null {
  const current = readAgentRecord(env);
  if (!current) return null;
  const root = scope === 'local' ? (projectRoot ?? process.cwd()) : undefined;
  const entries = current.entries.filter((e) => !sameKey(e, agent, scope, root));
  if (entries.length === current.entries.length) return current;
  const record: AgentRecord = { schemaVersion: 1, entries };
  writeAgentRecord(record, env);
  return record;
}

/**
 * Rebuild the record from the agents' own config files (A2): every target ×
 * scope whose config carries a SpecShip MCP entry. Local scope is the given
 * project root (default: cwd) — the only project whose config is reachable
 * without a registry. Reads files only; never spawns.
 */
export function rebuildAgentRecord(
  projectRoot: string = process.cwd(),
  targets: readonly AgentTarget[] = ALL_TARGETS,
  version: string = currentSpecshipVersion(),
): AgentRecord {
  const entries: AgentRecordEntry[] = [];
  const prevCwd = process.cwd();
  const root = path.resolve(projectRoot);
  const switchCwd = root !== prevCwd;
  try {
    if (switchCwd) process.chdir(root);
    for (const target of targets) {
      for (const scope of ['global', 'local'] as Location[]) {
        if (!target.supportsLocation(scope)) continue;
        let configured = false;
        try {
          configured = target.detect(scope).alreadyConfigured;
        } catch {
          configured = false;
        }
        if (configured) entries.push(makeEntry(target.id, scope, root, version));
      }
    }
  } finally {
    if (switchCwd) process.chdir(prevCwd);
  }
  return { schemaVersion: 1, entries };
}

/**
 * Read the record; when it is missing or unreadable, rebuild it from the
 * agents' configs and write it. A present record is returned as-is — no
 * detect pass, no write — so callers on a warm machine pay one file read.
 */
export function ensureAgentRecord(
  projectRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): AgentRecord {
  const existing = readAgentRecord(env);
  if (existing) return existing;
  const rebuilt = rebuildAgentRecord(projectRoot);
  writeAgentRecord(rebuilt, env);
  return rebuilt;
}
