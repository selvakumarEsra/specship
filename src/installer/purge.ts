/**
 * Complete-uninstall (purge) planning + execution (UNINSTALL-PURGE-DOC).
 *
 * `planPurge` is PURE — it computes the exact set of SpecShip-owned artifacts to
 * remove (project index, user-level data dirs, PATH symlink, npm-removal flag)
 * from an environment description, touching no filesystem. That keeps the delete
 * set unit-testable and means the executor can never surprise-remove a path the
 * planner didn't name.
 *
 * `executePurge` performs the data + binary removals (the Claude Code wiring
 * sweep is done by the caller, which reuses `uninstallTargets`). Self-affecting
 * removals — the bundle install dir that holds the RUNNING code, or `npm rm -g`
 * of the running global package — run LAST, so nothing needs a not-yet-loaded
 * module after the code is gone. Every removal is best-effort: an OS refusal
 * (e.g. an in-use executable on Windows) is caught and reported, never thrown.
 */

import * as path from 'path';
import type { InstallMethod } from '../update/updater';

export interface PurgeEnv {
  /** The current project root (its `.specship/` index is removed). */
  cwd: string;
  /** The user's home dir (`~/.specship` holds config, JIRA creds, worktrees). */
  homedir: string;
  /** Bundle install root: `SPECSHIP_INSTALL_DIR` || `~/.specship`. */
  installDir: string;
  /** PATH symlink dir: `SPECSHIP_BIN_DIR` || `~/.local/bin`. */
  binDir: string;
  /** How the running binary was installed (from `detectInstallMethod`). */
  method: InstallMethod;
}

export interface PurgePlan {
  method: InstallMethod;
  /** The current project's index dir to remove. */
  projectIndex: string;
  /** User-level dirs to remove (data/config + the bundle install). Deduped. */
  dataDirs: string[];
  /** PATH symlink to remove (bundle only), else null. */
  symlink: string | null;
  /** True when the binary is removed via `npm rm -g`. */
  npmRemove: boolean;
  /** For an unknown method: the manual binary-removal hint, else null. */
  manualBinaryHint: string | null;
}

/** The user-level SpecShip data directory — always `~/.specship`. */
function userDataDir(homedir: string): string {
  return path.join(homedir, '.specship');
}

/**
 * Guard against a catastrophic delete: refuse a filesystem root, the home dir
 * itself, or any top-level directory (fewer than two path segments). Every real
 * purge target — `~/.specship`, `<cwd>/.specship`, a bundle install dir — has at
 * least two segments, so this only ever fires on a misconfigured env. Throws.
 */
export function assertSafeToRemove(p: string, homedir: string): void {
  const r = path.resolve(p);
  const segments = r.split(path.sep).filter(Boolean).length;
  if (r === path.parse(r).root || r === path.resolve(homedir) || segments < 2) {
    throw new Error(`refusing to remove unsafe path: ${r}`);
  }
}

/**
 * Compute every SpecShip-owned artifact to remove (REQ-UNINSTALL-001/002). Pure:
 * no filesystem access. The bundle install lives under `installDir` (default
 * `~/.specship`); when that coincides with the user-data dir (the default) the
 * two dedupe to one removal, otherwise both are removed.
 */
export function planPurge(env: PurgeEnv): PurgePlan {
  const userData = userDataDir(env.homedir);
  const dataDirs = [userData];
  if (env.method === 'bundle') {
    const inst = path.resolve(env.installDir);
    if (!dataDirs.some((d) => path.resolve(d) === inst)) dataDirs.push(env.installDir);
  }
  return {
    method: env.method,
    projectIndex: path.join(env.cwd, '.specship'),
    dataDirs,
    symlink: env.method === 'bundle' ? path.join(env.binDir, 'specship') : null,
    npmRemove: env.method === 'npm',
    manualBinaryHint:
      env.method === 'unknown'
        ? 'Could not tell how specship was installed — remove the binary manually: ' +
          '`npm rm -g @specship/specship`, or delete its install dir + its PATH symlink.'
        : null,
  };
}

export interface PurgeExecDeps {
  /** Remove a directory tree; returns true if it existed and was removed. Throws on OS refusal. */
  rmDir: (p: string) => boolean;
  /** Remove a file/symlink; returns true if it existed and was removed. Throws on OS refusal. */
  rmFile: (p: string) => boolean;
  /** Run `npm rm -g @specship/specship`; returns ok + a short detail line. Never throws. */
  runNpmRemove: () => { ok: boolean; detail: string };
  /** Emit a progress line. */
  log: (msg: string) => void;
}

export interface PurgeResult {
  removed: string[];
  notes: string[];
}

/**
 * Execute a purge plan's data + binary removals (REQ-UNINSTALL-001/002). Order
 * matters: the project index and the PATH symlink go first (never the running
 * code), then `npm rm -g` (npm) and the data/install dirs (bundle) LAST because
 * they remove the running code — after that point no new module may load. Each
 * step is best-effort; a caught OS refusal becomes a note plus, when relevant,
 * the manual fallback (REQ-UNINSTALL-002.A4).
 */
export function executePurge(plan: PurgePlan, deps: PurgeExecDeps): PurgeResult {
  const removed: string[] = [];
  const notes: string[] = [];

  const attempt = (p: string, rm: (p: string) => boolean) => {
    try {
      if (rm(p)) { removed.push(p); deps.log(`removed ${p}`); }
    } catch (err) {
      notes.push(`could not remove ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 1. This project's index (never the running code).
  attempt(plan.projectIndex, deps.rmDir);

  // 2. The PATH symlink (bundle) — safe to unlink while running.
  if (plan.symlink) attempt(plan.symlink, deps.rmFile);

  // 3. npm binary removal — self-affecting (removes the running global package).
  if (plan.npmRemove) {
    const r = deps.runNpmRemove();
    if (r.ok) { removed.push('@specship/specship (npm global)'); deps.log(r.detail); }
    else notes.push(r.detail);
  }

  // 4. User data + bundle install LAST — for a bundle install these hold the
  //    running code, so nothing may load a new module after this.
  for (const d of plan.dataDirs) attempt(d, deps.rmDir);

  if (plan.manualBinaryHint) notes.push(plan.manualBinaryHint);

  return { removed, notes };
}
