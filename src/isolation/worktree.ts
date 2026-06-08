/**
 * Git worktree isolation for workflow runs.
 *
 * Mirrors Archon's `WorktreeProvider` contract (packages/isolation/src/providers/worktree.ts:115-260):
 *   - `envId` IS the filesystem path of the worktree (envId = workingPath).
 *   - `create()` adds a worktree on a deterministic branch.
 *   - `destroy()` removes the worktree (best-effort) and persists the
 *     terminal state to `isolation_environments`.
 *
 * Why the contract: making envId self-describing means a workflow run's
 * working directory is recoverable from the DB row alone — no extra
 * mapping table. The partial unique index on `isolation_environments`
 * with `WHERE status = 'active'` prevents duplicate live worktrees for
 * the same (workflow_name, workflow_run_id).
 *
 * Workflow runs that don't need a fresh checkout (`worktree.enabled: false`
 * on the workflow definition) skip this entirely and run in `cwd`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { IsolationEnvironment } from '../types';
import { SpecQueries } from '../db/spec-queries';

export interface WorktreeCreateRequest {
  /** Project root (the git repo this worktree branches from). */
  repoRoot: string;
  /** Workflow definition's `name` (e.g., "spec-implement"). */
  workflowName: string;
  /** The workflow run ID this worktree belongs to. */
  workflowRunId: string;
  /**
   * Branch to base off. Defaults to the current branch of repoRoot.
   * The new worktree's branch always starts from this.
   */
  baseBranch?: string;
  /**
   * Override the auto-generated branch name. Default: `specship/wf-<workflowName>-<shortRunId>`.
   */
  branchName?: string;
}

/**
 * Compute the worktree root for a repo. Worktrees live under
 * `~/.specship/worktrees/<repo-hash>/` so multiple projects on the same
 * machine never collide.
 */
function getWorktreeRoot(repoRoot: string): string {
  const repoHash = createHash('sha256')
    .update(path.resolve(repoRoot))
    .digest('hex')
    .substring(0, 12);
  return path.join(
    process.env.HOME || process.env.USERPROFILE || '/tmp',
    '.specship',
    'worktrees',
    repoHash
  );
}

/**
 * Sanitize a branch name segment (workflow name, run ID prefix) for git.
 * Strips characters git refuses; collapses runs of separators.
 */
function sanitizeBranchSegment(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9._/-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

/**
 * Run a git command. Returns { ok, stdout, stderr }. Never throws on a
 * non-zero exit — the caller decides whether to bail or log-and-continue.
 */
function git(args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').toString(),
    stderr: (result.stderr ?? '').toString(),
  };
}

export class WorktreeProvider {
  private specQueries: SpecQueries;

  constructor(specQueries: SpecQueries) {
    this.specQueries = specQueries;
  }

  /**
   * Create a git worktree for a workflow run. Returns the IsolationEnvironment
   * record (id = workingPath). Throws on git command failure since a
   * worktree-required workflow can't proceed without it.
   */
  create(req: WorktreeCreateRequest): IsolationEnvironment {
    // Adopt-or-create: if there's already an active env for this
    // (workflowName, workflowRunId), reuse it rather than fail on the
    // partial unique index.
    const existing = this.specQueries.getActiveIsolationEnvByRun(req.workflowRunId);
    if (existing && existing.workflowName === req.workflowName) {
      return existing;
    }

    const worktreeRoot = getWorktreeRoot(req.repoRoot);
    fs.mkdirSync(worktreeRoot, { recursive: true });

    const shortRunId = req.workflowRunId.substring(0, 8);
    const wfSeg = sanitizeBranchSegment(req.workflowName);
    const branchName =
      req.branchName ?? `specship/wf-${wfSeg}-${shortRunId}`;
    const workingPath = path.join(
      worktreeRoot,
      `${wfSeg}-${shortRunId}`
    );

    // If a stale directory exists at workingPath, remove it.
    try {
      if (fs.existsSync(workingPath)) {
        fs.rmSync(workingPath, { recursive: true, force: true });
      }
    } catch {
      // Non-fatal — git worktree add will surface a clearer error if blocked.
    }

    // Resolve baseBranch. If not provided, use whatever HEAD resolves to.
    const base = req.baseBranch ?? this.currentBranch(req.repoRoot) ?? 'HEAD';

    const addResult = git(
      ['worktree', 'add', '-b', branchName, workingPath, base],
      req.repoRoot
    );
    if (!addResult.ok) {
      // Branch may already exist (e.g., from a prior aborted run). Try
      // checking it out instead.
      const checkoutResult = git(
        ['worktree', 'add', workingPath, branchName],
        req.repoRoot
      );
      if (!checkoutResult.ok) {
        throw new Error(
          `git worktree add failed: ${addResult.stderr || checkoutResult.stderr || 'unknown error'}`
        );
      }
    }

    const now = Date.now();
    const env: IsolationEnvironment = {
      id: workingPath,
      workflowRunId: req.workflowRunId,
      workflowName: req.workflowName,
      workingPath,
      branchName,
      status: 'active',
      createdAt: now,
      metadata: {
        repoRoot: req.repoRoot,
        baseBranch: base,
      },
    };
    this.specQueries.insertIsolationEnv(env);
    return env;
  }

  /**
   * Destroy a worktree. Fire-and-forget — logs warnings but never throws.
   * After this returns, the row is marked status='destroyed' so the
   * partial unique index permits a fresh worktree for the same run.
   */
  destroy(envId: string, options: { force?: boolean } = {}): void {
    const env = this.specQueries.getIsolationEnvById(envId);
    if (!env) return; // already gone

    const meta = (env.metadata as Record<string, unknown> | undefined) ?? {};
    const repoRoot = typeof meta.repoRoot === 'string' ? meta.repoRoot : undefined;

    if (repoRoot) {
      const removeArgs = ['worktree', 'remove'];
      if (options.force) removeArgs.push('--force');
      removeArgs.push(env.workingPath);
      const result = git(removeArgs, repoRoot);
      if (!result.ok && this.isVerbose()) {
        // eslint-disable-next-line no-console
        console.error(
          `[WorktreeProvider] git worktree remove returned non-zero: ${result.stderr.trim()}`
        );
      }

      // Best-effort branch cleanup. Safe even if the branch was already deleted.
      git(['branch', '-D', env.branchName], repoRoot);
    }

    // Belt-and-suspenders: if anything is left at workingPath, rm it.
    try {
      if (fs.existsSync(env.workingPath)) {
        fs.rmSync(env.workingPath, { recursive: true, force: true });
      }
    } catch (err) {
      if (this.isVerbose()) {
        // eslint-disable-next-line no-console
        console.error(
          `[WorktreeProvider] cleanup of ${env.workingPath} failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.specQueries.updateIsolationEnv({
      ...env,
      status: 'destroyed',
      destroyedAt: Date.now(),
    });
  }

  /**
   * Tear down every active worktree owned by this specship instance.
   * Useful at process shutdown or `specship workflow gc`.
   */
  destroyAllActive(options: { force?: boolean } = {}): number {
    const active = this.specQueries.getAllActiveIsolationEnvs();
    let destroyed = 0;
    for (const env of active) {
      try {
        this.destroy(env.id, options);
        destroyed++;
      } catch {
        // never let one failure prevent the rest
      }
    }
    return destroyed;
  }

  private currentBranch(repoRoot: string): string | null {
    const result = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
    if (!result.ok) return null;
    const name = result.stdout.trim();
    return name && name !== 'HEAD' ? name : null;
  }

  private isVerbose(): boolean {
    return process.env.SPECSHIP_VERBOSE === '1';
  }
}
