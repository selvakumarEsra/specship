/**
 * Automatic set-up for a newly used agent (REQ-AGENTSWITCH-008).
 *
 * When SpecShip notices it is running under a supported agent that the
 * installed-agents record does not list for the current scope, it installs
 * SpecShip's own files for that agent at the scope of the existing install,
 * once, and reports one line: what was written and the command that undoes
 * it. The previously used agent's files are never touched — only the new
 * target's `install()` runs.
 *
 * Agent-agnostic: the agent arrives as an adapter id from `src/agents/detect`
 * (MCP client name, hook event, launcher env); targets come from the
 * installer registry. No host names, events or config paths appear here.
 *
 * Hot path: the CLI calls this on every command, including per-turn hook
 * commands. An unknown agent returns before any file access; a known agent
 * that is already recorded costs exactly one small read (the record). Only a
 * not-yet-recorded agent reads the one-shot guard and, if it migrates, the
 * project config.
 *
 * Fs/path only — must stay importable without native modules (installer rule).
 */
import * as fs from 'fs';
import * as path from 'path';
import { UNKNOWN_AGENT, type DetectedAgent } from '../agents/detect';
import { resolveInstallDir } from '../update/updater';
import {
  currentSpecshipVersion,
  readAgentRecord,
  recordInstall,
  type AgentRecord,
  type AgentRecordEntry,
  type InstallChoices,
} from './agent-record';
import { allTargets } from './targets/registry';
import { beginWriteJournal, endWriteJournal, rollbackJournal } from './targets/shared';
import type { AgentTarget, Location, TargetId } from './targets/types';

export const AUTO_MIGRATE_GUARD_FILE = 'auto-migrate.json';
export const AUTO_MIGRATE_ENV = 'SPECSHIP_AUTO_MIGRATE';

export interface MigrationOutcome {
  /**
   * `none` — nothing to do (unknown agent, already set up, already tried);
   * `installed` — the new agent was set up; `hint` — auto-setup is off and
   * the line says how to do it by hand; `failed` — the attempt failed (now or
   * earlier) and the line reports it.
   */
  kind: 'none' | 'installed' | 'hint' | 'failed';
  /** The one line to show the user. Absent for `none`. */
  line?: string;
}

export interface MigrationScope {
  scope: Location;
  /** Absolute project root for `local`; absent for `global`. */
  projectRoot?: string;
}

interface GuardAttempt {
  agent: string;
  scope: Location;
  projectRoot?: string;
  outcome: 'installed' | 'hint' | 'failed';
  at: string;
}

interface GuardFile {
  schemaVersion: 1;
  attempts: GuardAttempt[];
  /** A failure not yet shown to the user (A5). */
  pendingFailure?: string;
}

function guardPath(env: NodeJS.ProcessEnv): string {
  return path.join(resolveInstallDir(env), AUTO_MIGRATE_GUARD_FILE);
}

function readGuard(env: NodeJS.ProcessEnv): GuardFile {
  try {
    const raw = JSON.parse(fs.readFileSync(guardPath(env), 'utf-8')) as Partial<GuardFile>;
    if (raw && raw.schemaVersion === 1 && Array.isArray(raw.attempts)) {
      const attempts = raw.attempts.filter(
        (a): a is GuardAttempt =>
          !!a && typeof a.agent === 'string' && (a.scope === 'global' || a.scope === 'local'),
      );
      const g: GuardFile = { schemaVersion: 1, attempts };
      if (typeof raw.pendingFailure === 'string') g.pendingFailure = raw.pendingFailure;
      return g;
    }
  } catch { /* missing or unreadable → empty */ }
  return { schemaVersion: 1, attempts: [] };
}

function writeGuard(guard: GuardFile, env: NodeJS.ProcessEnv): void {
  const file = guardPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(guard, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sameScope(a: { scope: Location; projectRoot?: string }, b: MigrationScope): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope === 'global') return true;
  return path.resolve(a.projectRoot ?? '') === path.resolve(b.projectRoot ?? '');
}

/**
 * Auto-setup is on unless `SPECSHIP_AUTO_MIGRATE=0` or the project's
 * `specship.config.json` says `"autoMigrate": false`.
 */
export function autoMigrateEnabled(env: NodeJS.ProcessEnv, projectRoot: string): boolean {
  const flag = env[AUTO_MIGRATE_ENV];
  if (flag !== undefined && ['0', 'false', 'off', 'no'].includes(flag.trim().toLowerCase())) return false;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'specship.config.json'), 'utf8'));
    if (cfg && typeof cfg === 'object' && cfg.autoMigrate === false) return false;
  } catch { /* no config → on */ }
  return true;
}

/**
 * The scope of the existing install that covers `projectRoot`: the local
 * entry for this project (or an enclosing one) first, else a global entry.
 * `null` when SpecShip is installed for nothing here — nothing to migrate.
 */
export function migrationScope(record: AgentRecord | null, projectRoot: string): MigrationScope | null {
  if (!record) return null;
  const local = record.entries
    .filter((e) => e.scope === 'local' && e.projectRoot && isWithin(projectRoot, e.projectRoot))
    // The innermost enclosing project wins.
    .sort((a, b) => (b.projectRoot!.length - a.projectRoot!.length))[0];
  if (local) return { scope: 'local', projectRoot: path.resolve(local.projectRoot!) };
  if (record.entries.some((e) => e.scope === 'global')) return { scope: 'global' };
  return null;
}

/** Is `agent` already set up anywhere that covers this scope? */
function alreadyCovered(record: AgentRecord, agent: string, where: MigrationScope): boolean {
  return record.entries.some(
    (e) =>
      e.agent === agent &&
      (e.scope === 'global' || (where.scope === 'local' && sameScope(e, where))),
  );
}

/** The choices of the install being migrated from (same scope, any agent). */
function sourceChoices(record: AgentRecord, where: MigrationScope): InstallChoices | undefined {
  const from: AgentRecordEntry | undefined = record.entries.find((e) => sameScope(e, where));
  return from?.choices;
}

function undoCommand(id: TargetId, scope: Location): string {
  return `specship uninstall --target ${id} --${scope}`;
}

/** Name the written files in one line; a directory with several files is collapsed. */
function describeWritten(paths: string[], base: string | undefined): string {
  const shown = [...new Set(paths.map((p) => path.resolve(p)))].map((p) => {
    if (base && isWithin(p, base)) return path.relative(base, p) || p;
    const home = process.env.HOME;
    return home && isWithin(p, home) ? '~/' + path.relative(home, p) : p;
  });
  const byDir = new Map<string, string[]>();
  for (const s of shown) {
    const d = path.dirname(s);
    byDir.set(d, [...(byDir.get(d) ?? []), s]);
  }
  const parts: string[] = [];
  for (const [dir, files] of byDir) {
    if (files.length > 2) parts.push(`${dir}/ (${files.length} files)`);
    else parts.push(...files);
  }
  return parts.join(', ');
}

/**
 * Set SpecShip up for `agent` if it is a supported agent the record does not
 * yet list for this scope (REQ-AGENTSWITCH-008). At most once per agent and
 * scope: every attempt — installed, hinted or failed — is written to a guard
 * file in the SpecShip home. A failure rolls back what the attempt wrote and
 * is kept as a pending note until {@link takePendingMigrationFailure} hands it
 * to an output.
 */
export function maybeAutoMigrate(
  agent: DetectedAgent,
  opts: { projectRoot?: string; env?: NodeJS.ProcessEnv; targets?: readonly AgentTarget[] } = {},
): MigrationOutcome {
  // Unknown evidence never triggers a change — and costs no file access.
  if (!agent || agent === UNKNOWN_AGENT) return { kind: 'none' };
  const pool = opts.targets ?? allTargets();
  // Only targets the registry allows are ever installed.
  const target = pool.find((t) => t.id === agent);
  if (!target) return { kind: 'none' };

  const env = opts.env ?? process.env;
  const projectRoot = path.resolve(opts.projectRoot ?? process.cwd());

  // One small read: the record. No rebuild, no detect pass.
  const record = readAgentRecord(env);
  const where = migrationScope(record, projectRoot);
  if (!record || !where) return { kind: 'none' };
  if (alreadyCovered(record, target.id, where)) return { kind: 'none' };
  if (!target.supportsLocation(where.scope)) return { kind: 'none' };

  const guard = readGuard(env);
  const prior = guard.attempts.find((a) => a.agent === target.id && sameScope(a, where));
  if (prior) {
    return guard.pendingFailure ? { kind: 'failed', line: guard.pendingFailure } : { kind: 'none' };
  }

  const remember = (outcome: GuardAttempt['outcome']): void => {
    const attempt: GuardAttempt = { agent: target.id, scope: where.scope, outcome, at: new Date().toISOString() };
    if (where.projectRoot) attempt.projectRoot = where.projectRoot;
    guard.attempts.push(attempt);
  };

  if (!autoMigrateEnabled(env, where.projectRoot ?? projectRoot)) {
    remember('hint');
    try { writeGuard(guard, env); } catch { /* advisory */ }
    return {
      kind: 'hint',
      line: `SpecShip: auto-setup for ${target.displayName} is off — run \`specship install --target ${target.id} --location ${where.scope}\` to set it up.`,
    };
  }

  // Repeat the choices the existing install was made with; unknown ones get
  // a non-interactive install's defaults (on). Each target ignores the
  // choices it has no surface for, so no host is named here.
  const c = sourceChoices(record, where);
  const choices: InstallChoices = {
    autoAllow: c?.autoAllow ?? true,
    sdd: c?.sdd ?? true,
    statusLine: c?.statusLine ?? true,
  };
  const prevCwd = process.cwd();
  beginWriteJournal();
  try {
    if (where.projectRoot && where.projectRoot !== prevCwd) process.chdir(where.projectRoot);
    const result = target.install(where.scope, {
      autoAllow: choices.autoAllow ?? false,
      installStatusLine: choices.statusLine ?? false,
      sdd: choices.sdd,
    });
    // The record update stays inside the journal: if it fails, the catch
    // rolls back the target's files too, so "nothing was changed" is true.
    recordInstall(target.id, where.scope, where.projectRoot, currentSpecshipVersion(), env, choices);
    endWriteJournal();
    remember('installed');
    try { writeGuard(guard, env); } catch { /* advisory */ }
    const written = result.files
      .filter((f) => f.action === 'created' || f.action === 'updated')
      .map((f) => f.path);
    const what = written.length > 0 ? `wrote ${describeWritten(written, where.projectRoot)}` : 'nothing needed writing';
    const scopeText = where.scope === 'local' ? 'this project' : 'all projects';
    return {
      kind: 'installed',
      line: `SpecShip: set up ${target.displayName} for ${scopeText} — ${what}. Undo: \`${undoCommand(target.id, where.scope)}\``,
    };
  } catch (err) {
    rollbackJournal(endWriteJournal());
    const msg = err instanceof Error ? err.message : String(err);
    const line = `SpecShip: automatic setup for ${target.displayName} failed (${msg}); nothing was changed. Run \`specship install --target ${target.id} --location ${where.scope}\` to retry.`;
    remember('failed');
    guard.pendingFailure = line;
    try { writeGuard(guard, env); } catch { /* advisory */ }
    return { kind: 'failed', line };
  } finally {
    if (process.cwd() !== prevCwd) process.chdir(prevCwd);
  }
}

/**
 * Hand a pending migration failure to the output that shows it, once: the
 * note is cleared as it is read. `null` when nothing is pending.
 */
export function takePendingMigrationFailure(env: NodeJS.ProcessEnv = process.env): string | null {
  let guard: GuardFile;
  try {
    if (!fs.existsSync(guardPath(env))) return null;
    guard = readGuard(env);
  } catch {
    return null;
  }
  const line = guard.pendingFailure ?? null;
  if (line) {
    delete guard.pendingFailure;
    try { writeGuard(guard, env); } catch { /* advisory */ }
  }
  return line;
}

/**
 * The line an output should show for an outcome. A failure is taken from the
 * pending note so it is reported exactly once, by whichever output shows it.
 */
export function migrationLine(outcome: MigrationOutcome, env: NodeJS.ProcessEnv = process.env): string | null {
  // The note may be unsaved (an unwritable SpecShip home): report the
  // failure from the outcome itself rather than not at all.
  if (outcome.kind === 'failed') return takePendingMigrationFailure(env) ?? outcome.line ?? null;
  return outcome.line ?? null;
}
