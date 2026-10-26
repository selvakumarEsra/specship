/**
 * REQ-THRU-002 — merge completed runs through a queue that re-checks each merge.
 *
 * `specship workflow merge-queue <runId…>` merges each completed run's branch
 * into the current branch in the given order, re-running the project's quality
 * command after each merge. It stops at the first merge conflict (aborting the
 * merge so no conflict markers remain) or the first failing check (resetting
 * to the pre-merge HEAD), leaving the tree at the last good merge and naming
 * the run that stopped it. Runs that are not completed are refused before any
 * merge happens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type GitFn = (args: string[], cwd: string) => GitResult;

export const defaultGit: GitFn = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? r.error.message : '') };
};

/**
 * The project's quality command — the same detection the implement
 * workflows' quality gate uses: `npm run lint --if-present` when package.json
 * has a lint script, else `npx --no-install tsc --noEmit` when tsconfig.json
 * exists, else none.
 */
export function detectQualityCommand(projectRoot: string): string | null {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, unknown> };
      if (pkg.scripts && typeof pkg.scripts.lint === 'string') return 'npm run lint --if-present';
    } catch {
      // unreadable package.json — fall through to the tsconfig check
    }
  }
  if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) return 'npx --no-install tsc --noEmit';
  return null;
}

export interface QualityResult {
  ok: boolean;
  /** The command that ran; undefined when the project has none. */
  command?: string;
  output?: string;
}

/** Run the detected quality command in `projectRoot`; no command = ok (skipped). */
export function defaultRunQuality(projectRoot: string): QualityResult {
  const command = detectQualityCommand(projectRoot);
  if (!command) return { ok: true };
  const r = spawnSync(command, { cwd: projectRoot, shell: true, encoding: 'utf-8', windowsHide: true });
  return { ok: r.status === 0, command, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export interface MergeQueueRun {
  id: string;
  status: string;
  /** The run's branch (from its isolation env). */
  branch?: string;
}

export type MergeQueueStopReason = 'not-found' | 'not-completed' | 'no-branch' | 'dirty-tree' | 'conflict' | 'quality-failed' | 'git-error';

export interface MergeQueueOptions {
  projectRoot: string;
  runIds: string[];
  getRun: (runId: string) => MergeQueueRun | null;
  runQuality?: (projectRoot: string) => QualityResult;
  git?: GitFn;
}

export interface MergeQueueResult {
  /** Run ids merged (and checked), in order. */
  merged: string[];
  /** The run that stopped the queue. */
  stoppedAt?: string;
  reason?: MergeQueueStopReason;
  /** Human-readable explanation of the stop. */
  detail?: string;
  /** Runs refused up front (not found / not completed / no branch). */
  refused?: Array<{ runId: string; reason: MergeQueueStopReason; detail: string }>;
}

export function runMergeQueue(opts: MergeQueueOptions): MergeQueueResult {
  const git = opts.git ?? defaultGit;
  const runQuality = opts.runQuality ?? defaultRunQuality;
  const cwd = opts.projectRoot;

  // A4 — refuse incomplete runs before any merge happens.
  const runs: Array<{ id: string; branch: string }> = [];
  const refused: NonNullable<MergeQueueResult['refused']> = [];
  for (const id of opts.runIds) {
    const run = opts.getRun(id);
    if (!run) {
      refused.push({ runId: id, reason: 'not-found', detail: `Run ${id} not found` });
    } else if (run.status !== 'completed') {
      refused.push({ runId: id, reason: 'not-completed', detail: `Run ${id} is ${run.status}, not completed` });
    } else if (!run.branch) {
      refused.push({ runId: id, reason: 'no-branch', detail: `Run ${id} has no branch to merge` });
    } else {
      runs.push({ id, branch: run.branch });
    }
  }
  if (refused.length > 0) {
    const first = refused[0]!;
    return { merged: [], stoppedAt: first.runId, reason: first.reason, detail: refused.map((r) => r.detail).join('; '), refused };
  }

  // A failed check is undone with `git reset --hard`; never let that discard
  // the user's own uncommitted work.
  const status = git(['status', '--porcelain', '--untracked-files=no'], cwd);
  if (!status.ok || status.stdout.trim() !== '') {
    return {
      merged: [],
      stoppedAt: runs[0]?.id,
      reason: 'dirty-tree',
      detail: status.ok ? 'Working tree has uncommitted changes — commit or stash them first' : status.stderr.trim(),
    };
  }

  const merged: string[] = [];
  for (const run of runs) {
    const head = git(['rev-parse', 'HEAD'], cwd);
    if (!head.ok) return { merged, stoppedAt: run.id, reason: 'git-error', detail: head.stderr.trim() };
    const preMerge = head.stdout.trim();

    const merge = git(['merge', '--no-ff', '--no-edit', run.branch], cwd);
    if (!merge.ok) {
      // A2 — leave no conflict markers: abort back to the last good merge.
      const conflicted = git(['diff', '--name-only', '--diff-filter=U'], cwd).stdout.trim();
      git(['merge', '--abort'], cwd);
      git(['reset', '--hard', preMerge], cwd);
      return {
        merged,
        stoppedAt: run.id,
        reason: conflicted ? 'conflict' : 'git-error',
        detail: conflicted
          ? `Merging ${run.branch} conflicts in: ${conflicted.split(/\r?\n/).join(', ')}`
          : `git merge ${run.branch} failed: ${(merge.stderr || merge.stdout).trim()}`,
      };
    }

    // A1/A3 — re-run the quality command after each merge; undo on failure.
    const q = runQuality(cwd);
    if (!q.ok) {
      git(['reset', '--hard', preMerge], cwd);
      return {
        merged,
        stoppedAt: run.id,
        reason: 'quality-failed',
        detail: `Quality command${q.command ? ` (${q.command})` : ''} failed after merging ${run.branch}; merge undone`,
      };
    }
    merged.push(run.id);
  }
  return { merged };
}
