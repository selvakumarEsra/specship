/**
 * REQ-THRU-007 — collect the worktrees of merged runs.
 *
 * `specship workflow gc` purges the worktree of every run whose branch is
 * merged into the default branch — the same way `specship workflow purge`
 * does, so run records and artifacts are kept — and leaves unmerged runs
 * untouched. `--dry-run` lists the candidates and removes nothing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorktreePorcelain } from '../pulse/pulse';
import { defaultGit, type GitFn } from './merge-queue';

export interface GcRun {
  id: string;
  status: string;
  /** The run's branch (from its isolation env). */
  branch?: string;
  /** The run's worktree path (from its isolation env). */
  workingPath?: string;
}

export interface GcCandidate {
  runId: string;
  branch: string;
  workingPath: string;
}

export interface CollectMergedRunsOptions {
  projectRoot: string;
  dryRun?: boolean;
  /** Runs that own (or owned) a worktree. */
  listRuns: () => GcRun[];
  /** Purge one run's worktree, keeping its record and artifacts (`workflow purge`). */
  purge: (runId: string) => void;
  git?: GitFn;
  /** Override default-branch detection. */
  defaultBranch?: string;
}

export interface CollectMergedRunsResult {
  defaultBranch: string | null;
  /** Merged runs whose worktree is (or, on a dry run, would be) removed. */
  candidates: GcCandidate[];
  /** Run ids actually purged (empty on a dry run). */
  purged: string[];
  /** Merged runs left alone, with why. */
  skipped: Array<{ runId: string; reason: string }>;
  dryRun: boolean;
}

/** The default branch: origin's HEAD, else a local `main`, else `master`. */
export function detectDefaultBranch(projectRoot: string, git: GitFn = defaultGit): string | null {
  const sym = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], projectRoot);
  if (sym.ok && sym.stdout.trim()) {
    const name = sym.stdout.trim().replace(/^origin\//, '');
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], projectRoot).ok) return name;
    return `origin/${name}`;
  }
  for (const name of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], projectRoot).ok) return name;
  }
  return null;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return norm(a) === norm(b);
}

export function collectMergedRuns(opts: CollectMergedRunsOptions): CollectMergedRunsResult {
  const git = opts.git ?? defaultGit;
  const dryRun = opts.dryRun === true;
  const base = opts.defaultBranch ?? detectDefaultBranch(opts.projectRoot, git);
  const result: CollectMergedRunsResult = { defaultBranch: base, candidates: [], purged: [], skipped: [], dryRun };
  if (!base) return result;

  const mergedOut = git(['branch', '--merged', base, '--format=%(refname:short)'], opts.projectRoot);
  if (!mergedOut.ok) throw new Error(`git branch --merged ${base} failed: ${mergedOut.stderr.trim()}`);
  const merged = new Set(mergedOut.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

  // Only worktrees still registered with git are on disk to collect.
  const list = git(['worktree', 'list', '--porcelain'], opts.projectRoot);
  const live = list.ok ? parseWorktreePorcelain(list.stdout).slice(1).filter((e) => !e.prunable) : [];

  for (const run of opts.listRuns()) {
    if (!run.branch || !run.workingPath) continue;
    if (!merged.has(run.branch)) continue; // A2 — unmerged runs are untouched
    if (run.branch === base) continue;
    const onDisk = live.find((e) => samePath(e.path, run.workingPath!));
    if (!onDisk) continue;
    if (run.status === 'running' || run.status === 'paused') {
      result.skipped.push({ runId: run.id, reason: `run is ${run.status}` });
      continue;
    }
    // Never discard uncommitted work sitting in a worktree.
    const dirty = git(['status', '--porcelain'], run.workingPath);
    if (!dirty.ok || dirty.stdout.trim() !== '') {
      result.skipped.push({ runId: run.id, reason: 'worktree has uncommitted changes' });
      continue;
    }
    result.candidates.push({ runId: run.id, branch: run.branch, workingPath: run.workingPath });
  }

  if (dryRun) return result; // A3 — list only
  for (const c of result.candidates) {
    opts.purge(c.runId); // A1 — worktree removed, record + artifacts kept
    result.purged.push(c.runId);
  }
  return result;
}
