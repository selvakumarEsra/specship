/**
 * Pipeline pulse (PIPETRUST-DOC, REQ-PIPETRUST-007) — surface pipeline
 * failures instead of waiting for someone to discover them.
 *
 * Four checks:
 *   - release   — conclusion of the latest release workflow run (`gh`)
 *   - npm       — published npm version vs latest GitHub release / package.json
 *   - jira      — failures recorded by the last JIRA auto-publish
 *   - worktrees — workflow-run worktrees whose branch is already merged
 *
 * Every external command goes through an injectable {@link CommandRunner}
 * with a per-command timeout and a total time budget. A missing tool, a
 * timeout or a network failure turns that check into `skipped` — pulse never
 * throws and never stalls its caller. Results are cached to
 * `.specship/pulse.json` so a session-start summary can read them without
 * touching the network.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { getSpecShipDir } from '../directory';
import { writeJsonAtomic, readJsonSafe } from '../statusline/paths';
import { readLastAutoPublishReport } from '../jira/auto-publish';

export type PulseStatus = 'ok' | 'fail' | 'skipped';
export type PulseCheckId = 'release' | 'npm' | 'jira' | 'worktrees';

export interface PulseItem {
  id: PulseCheckId;
  status: PulseStatus;
  message: string;
  hint?: string;
}

export interface PulseResult {
  /** Epoch ms when the checks ran. */
  checkedAt: number;
  items: PulseItem[];
  /** True when the result was served from `.specship/pulse.json`. */
  fromCache: boolean;
}

export interface CommandResult {
  /** Exit code 0. */
  ok: boolean;
  stdout: string;
  stderr?: string;
  /** The command was killed by its timeout. */
  timedOut?: boolean;
  /** The executable was not found. */
  missing?: boolean;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<CommandResult>;

export interface PulseOptions {
  projectRoot: string;
  /** Command runner seam (tests inject a fake; default spawns the real tool). */
  runner?: CommandRunner;
  /** Clock seam (epoch ms). */
  now?: () => number;
  /** Serve the cache when it is younger than this. Default: always recompute. */
  maxAgeMs?: number;
  /** Ignore the cache and recompute. */
  refresh?: boolean;
  /** Hard per-command timeout (ms). Default 3000. */
  commandTimeoutMs?: number;
  /** Total time budget for all commands (ms). Default 5000. */
  totalBudgetMs?: number;
  /** Persist the computed result to `.specship/pulse.json`. Default true. */
  writeCache?: boolean;
  /**
   * Resolve a run worktree's path to its full workflow run id (for the purge
   * hint). Default: the short run id parsed from the branch/dir name.
   */
  runIdForWorktree?: (workingPath: string, branch: string) => string | undefined;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_TOTAL_BUDGET_MS = 5000;
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled']);

export function pulseCachePath(projectRoot: string): string {
  return path.join(getSpecShipDir(projectRoot), 'pulse.json');
}

/** Read the cached pulse without running anything. Null when absent/corrupt. */
export function readCachedPulse(projectRoot: string): PulseResult | null {
  const raw = readJsonSafe<{ checkedAt?: unknown; items?: unknown }>(pulseCachePath(projectRoot));
  if (!raw || typeof raw.checkedAt !== 'number' || !Array.isArray(raw.items)) return null;
  return { checkedAt: raw.checkedAt, items: raw.items as PulseItem[], fromCache: true };
}

/** Default runner: execFile with a hard timeout; never rejects. */
export const defaultCommandRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        {
          cwd: opts.cwd,
          timeout: Math.max(1, opts.timeoutMs),
          windowsHide: true,
          encoding: 'utf-8',
          maxBuffer: 4 * 1024 * 1024,
          // npm / gh ship as .cmd shims on Windows.
          shell: process.platform === 'win32',
        },
        (err, stdout, stderr) => {
          if (!err) {
            resolve({ ok: true, stdout: String(stdout), stderr: String(stderr) });
            return;
          }
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          resolve({
            ok: false,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            missing: e.code === 'ENOENT',
            timedOut: e.killed === true || e.signal === 'SIGTERM',
          });
        },
      );
    } catch {
      resolve({ ok: false, stdout: '', missing: true });
    }
  });

/** Budget-aware wrapper around the runner. Never rejects. */
function makeExec(
  runner: CommandRunner,
  cwd: string,
  commandTimeoutMs: number,
  totalBudgetMs: number,
): (cmd: string, args: string[]) => Promise<CommandResult> {
  const deadline = Date.now() + totalBudgetMs;
  return async (cmd, args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, stdout: '', timedOut: true };
    const timeoutMs = Math.min(commandTimeoutMs, remaining);
    try {
      let timer: NodeJS.Timeout | undefined;
      const guard = new Promise<CommandResult>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, stdout: '', timedOut: true }), timeoutMs + 250);
      });
      const result = await Promise.race([runner(cmd, args, { cwd, timeoutMs }), guard]);
      if (timer) clearTimeout(timer);
      return result;
    } catch {
      return { ok: false, stdout: '', missing: true };
    }
  };
}

type Exec = (cmd: string, args: string[]) => Promise<CommandResult>;

function skipReason(tool: string, r: CommandResult): string {
  if (r.missing) return `${tool} not available`;
  if (r.timedOut) return `${tool} check timed out`;
  return `${tool} check unavailable (offline or not authenticated)`;
}

function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function dateOnly(iso: string | undefined): string {
  if (!iso) return 'unknown date';
  return iso.slice(0, 10);
}

/** Compare dotted versions numerically (pre-release suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    (v.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkRelease(projectRoot: string, exec: Exec): Promise<PulseItem> {
  const wf = path.join(projectRoot, '.github', 'workflows', 'release.yml');
  if (!fs.existsSync(wf)) {
    return { id: 'release', status: 'skipped', message: 'Release: no .github/workflows/release.yml' };
  }
  const r = await exec('gh', [
    'run', 'list', '--workflow=release.yml', '--limit', '1',
    '--json', 'conclusion,createdAt,displayTitle,databaseId',
  ]);
  if (!r.ok) {
    return { id: 'release', status: 'skipped', message: `Release: ${skipReason('gh', r)}` };
  }
  const runs = parseJson<Array<{ conclusion?: string; createdAt?: string; displayTitle?: string; databaseId?: number }>>(r.stdout);
  if (!runs) return { id: 'release', status: 'skipped', message: 'Release: unreadable gh output' };
  const run = runs[0];
  if (!run) return { id: 'release', status: 'ok', message: 'Release: no runs yet' };
  const title = run.displayTitle ? ` (${run.displayTitle})` : '';
  const when = dateOnly(run.createdAt);
  if (!run.conclusion) {
    return { id: 'release', status: 'ok', message: `Release: run in progress${title}, started ${when}` };
  }
  if (!FAILED_CONCLUSIONS.has(run.conclusion)) {
    return { id: 'release', status: 'ok', message: `Release: last run ${run.conclusion}${title} on ${when}` };
  }
  // Failing step — one extra cheap call; omitted when unavailable.
  let step = '';
  if (typeof run.databaseId === 'number') {
    const v = await exec('gh', ['run', 'view', String(run.databaseId), '--json', 'jobs']);
    if (v.ok) {
      const data = parseJson<{ jobs?: Array<{ name?: string; conclusion?: string; steps?: Array<{ name?: string; conclusion?: string }> }> }>(v.stdout);
      for (const job of data?.jobs ?? []) {
        const s = (job.steps ?? []).find((x) => x.conclusion && FAILED_CONCLUSIONS.has(x.conclusion));
        if (s?.name) {
          step = ` at step "${s.name}"${job.name ? ` (job ${job.name})` : ''}`;
          break;
        }
      }
    }
  }
  return {
    id: 'release',
    status: 'fail',
    message: `Release workflow ${run.conclusion} on ${when}${title}${step}`,
    hint: 'gh run list --workflow=release.yml',
  };
}

async function checkNpm(projectRoot: string, exec: Exec): Promise<PulseItem> {
  const pkg = readJsonSafe<{ name?: string; version?: string; private?: boolean }>(
    path.join(projectRoot, 'package.json'),
  );
  if (!pkg?.name || pkg.private) {
    return { id: 'npm', status: 'skipped', message: 'npm: no published package.json' };
  }
  const [npmRes, ghRes] = await Promise.all([
    exec('npm', ['view', pkg.name, 'version']),
    exec('gh', ['release', 'list', '--limit', '1', '--json', 'tagName']),
  ]);
  if (!npmRes.ok) {
    return { id: 'npm', status: 'skipped', message: `npm: ${skipReason('npm', npmRes)}` };
  }
  const published = npmRes.stdout.trim().split(/\s+/).pop() ?? '';
  if (!published) return { id: 'npm', status: 'skipped', message: 'npm: no published version' };

  let releaseTag: string | undefined;
  if (ghRes.ok) {
    const rel = parseJson<Array<{ tagName?: string }>>(ghRes.stdout);
    releaseTag = rel?.[0]?.tagName;
  }

  const lags: string[] = [];
  if (releaseTag && compareVersions(releaseTag, published) > 0) {
    lags.push(`latest GitHub release is ${releaseTag}`);
  }
  if (pkg.version && compareVersions(pkg.version, published) > 0) {
    lags.push(`package.json is ${pkg.version}`);
  }
  if (lags.length > 0) {
    return {
      id: 'npm',
      status: 'fail',
      message: `npm ${pkg.name} is at ${published} but ${lags.join(' and ')}`,
      hint: 'check the release workflow\'s publish step',
    };
  }
  const relNote = releaseTag ? `, matches release ${releaseTag}` : ghRes.ok ? '' : ' (GitHub release not checked)';
  return { id: 'npm', status: 'ok', message: `npm ${pkg.name} at ${published}${relNote}` };
}

function checkJira(projectRoot: string): PulseItem {
  const last = readLastAutoPublishReport(projectRoot);
  if (!last) return { id: 'jira', status: 'skipped', message: 'JIRA auto-publish: no report yet' };
  const when = dateOnly(new Date(last.at).toISOString());
  if (last.skipped) {
    return { id: 'jira', status: 'skipped', message: `JIRA auto-publish skipped on ${when}: ${last.note ?? last.skipped}` };
  }
  if (last.counts.failed > 0) {
    const sample = last.failures.slice(0, 3).map((f) => f.specId).join(', ');
    const more = last.failures.length > 3 ? ', …' : '';
    return {
      id: 'jira',
      status: 'fail',
      message: `JIRA auto-publish: ${last.counts.failed} failed on ${when}${sample ? ` (${sample}${more})` : ''}`,
      hint: 'details in .specship/jira-publish-last.json',
    };
  }
  return {
    id: 'jira',
    status: 'ok',
    message: `JIRA auto-publish: ${last.counts.published} published, ${last.counts.unchanged} unchanged on ${when}`,
  };
}

interface WorktreeEntry {
  path: string;
  branch?: string;
  prunable?: boolean;
}

export function parseWorktreePorcelain(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let cur: WorktreeEntry | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = { path: line.slice('worktree '.length) };
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (cur && line.startsWith('prunable')) {
      cur.prunable = true;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

function isRunWorktree(e: WorktreeEntry): boolean {
  if (e.branch?.startsWith('specship/wf-')) return true;
  return /[\\/]\.specship[\\/]worktrees[\\/]/.test(e.path);
}

function shortRunId(e: WorktreeEntry): string {
  const src = e.branch ?? path.basename(e.path);
  const m = /([0-9a-f]{8})$/i.exec(src) ?? /([0-9a-f]{8})$/i.exec(path.basename(e.path));
  return m?.[1] ?? path.basename(e.path);
}

async function defaultBranch(exec: Exec): Promise<string | null> {
  const sym = await exec('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (sym.ok && sym.stdout.trim()) return sym.stdout.trim().replace(/^origin\//, '');
  for (const name of ['main', 'master']) {
    const r = await exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
    if (r.ok) return name;
  }
  return null;
}

async function checkWorktrees(
  exec: Exec,
  runIdFor?: PulseOptions['runIdForWorktree'],
): Promise<PulseItem> {
  const list = await exec('git', ['worktree', 'list', '--porcelain']);
  if (!list.ok) {
    return { id: 'worktrees', status: 'skipped', message: `Worktrees: ${skipReason('git', list)}` };
  }
  const runTrees = parseWorktreePorcelain(list.stdout)
    .slice(1) // the main worktree is never a run worktree
    .filter((e) => !e.prunable && e.branch && isRunWorktree(e));
  if (runTrees.length === 0) {
    return { id: 'worktrees', status: 'ok', message: 'Worktrees: no workflow-run worktrees on disk' };
  }
  const base = await defaultBranch(exec);
  if (!base) return { id: 'worktrees', status: 'skipped', message: 'Worktrees: default branch unknown' };
  const merged = await exec('git', ['branch', '--merged', base, '--format=%(refname:short)']);
  if (!merged.ok) {
    return { id: 'worktrees', status: 'skipped', message: `Worktrees: ${skipReason('git', merged)}` };
  }
  const mergedSet = new Set(merged.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  const stale = runTrees.filter((e) => mergedSet.has(e.branch!));
  if (stale.length === 0) {
    return { id: 'worktrees', status: 'ok', message: `Worktrees: ${runTrees.length} run worktree(s), none merged` };
  }
  const ids = stale.map((e) => runIdFor?.(e.path, e.branch!) ?? shortRunId(e));
  return {
    id: 'worktrees',
    status: 'fail',
    message: `${stale.length} merged workflow-run worktree(s) still on disk: ${stale.map((e) => path.basename(e.path)).join(', ')}`,
    hint: ids.map((id) => `specship workflow purge ${id}`).join('; '),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute (or serve from cache) the pipeline pulse. Never throws: every
 * check that cannot run cleanly degrades to `skipped`.
 */
export async function computePulse(opts: PulseOptions): Promise<PulseResult> {
  const now = opts.now ?? Date.now;
  const root = opts.projectRoot;

  if (!opts.refresh && typeof opts.maxAgeMs === 'number') {
    const cached = readCachedPulse(root);
    if (cached && now() - cached.checkedAt <= opts.maxAgeMs) return cached;
  }

  const exec = makeExec(
    opts.runner ?? defaultCommandRunner,
    root,
    opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    opts.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS,
  );

  const safe = async (id: PulseCheckId, label: string, fn: () => Promise<PulseItem> | PulseItem): Promise<PulseItem> => {
    try {
      return await fn();
    } catch (err) {
      return { id, status: 'skipped', message: `${label}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  // Network checks run concurrently so the total stays within budget.
  const items = await Promise.all([
    safe('release', 'Release', () => checkRelease(root, exec)),
    safe('npm', 'npm', () => checkNpm(root, exec)),
    safe('jira', 'JIRA auto-publish', () => checkJira(root)),
    safe('worktrees', 'Worktrees', () => checkWorktrees(exec, opts.runIdForWorktree)),
  ]);

  const result: PulseResult = { checkedAt: now(), items, fromCache: false };
  if (opts.writeCache !== false) {
    try {
      writeJsonAtomic(pulseCachePath(root), { checkedAt: result.checkedAt, items });
    } catch {
      /* the cache is best-effort */
    }
  }
  return result;
}

/**
 * One human line per failing item; an empty array when everything is
 * healthy or skipped (so a session-start summary stays silent).
 */
export function formatPulseLines(items: PulseItem[]): string[] {
  return items
    .filter((i) => i.status === 'fail')
    .map((i) => `⚠ ${i.message}${i.hint ? ` — ${i.hint}` : ''}`);
}
