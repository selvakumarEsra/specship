/**
 * Git Worktree Awareness
 *
 * A SpecShip index lives in a `.specship/` directory and is resolved by
 * walking up parent directories to the nearest one (see
 * `findNearestSpecShipRoot`). That walk is unaware of git worktrees: when a
 * worktree is created *inside* the main checkout (e.g. some tools place them
 * under `.gitignore`d paths like `.claude/worktrees/<name>/`), a command run
 * from the worktree walks up and silently resolves the MAIN checkout's index.
 *
 * Every query then returns results from the main tree's code — usually a
 * different branch — rather than the worktree the user is actually editing.
 * Symbols added or changed only in the worktree are invisible. This module
 * detects that "borrowed index" situation so callers can warn about it.
 *
 * Detection is best-effort: when git is unavailable or the path isn't a repo,
 * it reports "no mismatch" and callers carry on unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

/**
 * Absolute, symlink-resolved toplevel of the git working tree that `dir`
 * belongs to, or null when `dir` isn't inside a git repo (or git is missing).
 *
 * `git rev-parse --show-toplevel` returns the per-worktree root: the main
 * checkout and each linked worktree report their own distinct directory, which
 * is exactly the distinction this module relies on.
 */
export function gitWorktreeRoot(dir: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return out ? realpath(out) : null;
  } catch {
    return null;
  }
}

export interface WorktreeIndexMismatch {
  /** The git working tree the command was run from. */
  worktreeRoot: string;
  /** The (different) working tree whose `.specship` index is being used. */
  indexRoot: string;
}

/**
 * Detect when `startPath` lives in one git working tree but the resolved
 * SpecShip index (`indexRoot`) belongs to a *different* working tree.
 *
 * Returns null — meaning "nothing to warn about" — when:
 *   - `startPath` isn't in a git repo (or git is unavailable),
 *   - the index already lives in `startPath`'s own working tree, or
 *   - `indexRoot` isn't itself a working-tree root (an unrelated parent dir
 *     that merely happens to contain a `.specship/`), which keeps non-git
 *     and monorepo-subdir layouts from producing false warnings.
 */
export function detectWorktreeIndexMismatch(
  startPath: string,
  indexRoot: string,
): WorktreeIndexMismatch | null {
  const worktreeRoot = gitWorktreeRoot(startPath);
  if (!worktreeRoot) return null;

  const resolvedIndexRoot = realpath(indexRoot);
  if (worktreeRoot === resolvedIndexRoot) return null;

  // Only flag it when the index root is itself a real working-tree root. This
  // distinguishes "borrowed another worktree's index" from "index sits in a
  // plain ancestor directory", and avoids warning outside git entirely.
  if (gitWorktreeRoot(resolvedIndexRoot) !== resolvedIndexRoot) return null;

  return { worktreeRoot, indexRoot: resolvedIndexRoot };
}

/** One-line-per-fact warning describing a detected mismatch. */
export function worktreeMismatchWarning(m: WorktreeIndexMismatch): string {
  return (
    `This SpecShip index belongs to a different git working tree.\n` +
    `  Running in: ${m.worktreeRoot}\n` +
    `  Index from: ${m.indexRoot}\n` +
    `Results reflect that tree's code (often a different branch), not this worktree — ` +
    `symbols changed only here are missing. Run "specship init -i" in this worktree ` +
    `for a worktree-local index.`
  );
}

/**
 * Compact, single-line variant for prefixing a tool's result. Read tools
 * return their answer inline, so the heads-up has to ride on the same payload
 * the agent is already reading — a multi-line block would bury the result.
 */
export function worktreeMismatchNotice(m: WorktreeIndexMismatch): string {
  return (
    `⚠ SpecShip results below come from a different git worktree (${m.indexRoot}), ` +
    `not where you're working (${m.worktreeRoot}) — they may reflect another branch, ` +
    `and symbols changed only here are missing. Run "specship init -i" here for a ` +
    `worktree-local index.`
  );
}

// =============================================================================
// Indexed revision + staleness (REQ-MULTIDEV-004)
// =============================================================================

/** Run git in `dir`; returns trimmed stdout, or null on any failure. Never throws. */
function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Pathspec limiting git output to `dir`, excluding SpecShip's own `.specship/`. */
const NON_SPECSHIP_PATHSPEC = ['--', '.', ':(exclude).specship'];

/**
 * The checkout's current HEAD: commit sha plus branch name (`null` on a
 * detached HEAD). Returns null outside a git repo, when git is missing, or
 * when the repo has no commit yet. Never throws.
 */
export function readGitHead(dir: string): { branch: string | null; commit: string } | null {
  const commit = git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])?.trim();
  if (!commit) return null;
  // `symbolic-ref -q` exits non-zero with no output on a detached HEAD.
  const branch = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() || null;
  return { branch, commit };
}

/**
 * Fingerprint of the uncommitted tracked state under `dir` (outside
 * `.specship/`): a hash over `git status --porcelain --untracked-files=no`
 * plus `git diff HEAD`. Two calls return the same value exactly when the
 * working tree's tracked changes are identical — so an index synced after an
 * edit is fresh until the edits change again. Null when git can't answer.
 */
export function uncommittedTrackedFingerprint(dir: string): string | null {
  const status = git(dir, ['status', '--porcelain', '--untracked-files=no', ...NON_SPECSHIP_PATHSPEC]);
  if (status === null) return null;
  if (status.trim().length === 0) return 'clean';
  const diff = git(dir, ['diff', 'HEAD', '--no-ext-diff', '--binary', ...NON_SPECSHIP_PATHSPEC]);
  if (diff === null) return null;
  return createHash('sha256').update(status).update('\0').update(diff).digest('hex');
}

export type IndexStaleReason = 'commit-moved' | 'uncommitted-changes';

export interface IndexFreshness {
  /** Branch the index was built on; null when built on a detached HEAD. */
  indexedBranch: string | null;
  indexedCommit: string;
  /** Branch currently checked out; null on a detached HEAD. */
  headBranch: string | null;
  headCommit: string;
  stale: boolean;
  reasons: IndexStaleReason[];
}

/**
 * Pure staleness verdict. `worktreeChanged` is true when the checkout's
 * uncommitted tracked changes differ from those present at index time.
 */
export function computeIndexFreshness(
  recorded: { branch: string | null; commit: string },
  head: { branch: string | null; commit: string },
  worktreeChanged: boolean,
): IndexFreshness {
  const reasons: IndexStaleReason[] = [];
  if (recorded.commit !== head.commit) reasons.push('commit-moved');
  if (worktreeChanged) reasons.push('uncommitted-changes');
  return {
    indexedBranch: recorded.branch,
    indexedCommit: recorded.commit,
    headBranch: head.branch,
    headCommit: head.commit,
    stale: reasons.length > 0,
    reasons,
  };
}

/** One-line staleness notice naming `specship sync` as the fix. */
export function indexStaleNotice(f: IndexFreshness): string {
  const short = (c: string) => c.slice(0, 7);
  const parts: string[] = [];
  if (f.reasons.includes('commit-moved')) {
    parts.push(`indexed at ${short(f.indexedCommit)}, HEAD ${short(f.headCommit)}`);
  }
  if (f.reasons.includes('uncommitted-changes')) {
    parts.push('uncommitted changes differ from when it was indexed');
  }
  return `Index may be stale (${parts.join('; ')}) — run \`specship sync\``;
}

/** `ref (branch)` / `ref (detached)` label for human output. */
export function formatRevision(branch: string | null, commit: string): string {
  return `${commit.slice(0, 7)} (${branch ?? 'detached'})`;
}

/**
 * The `specship status --json` fields for a freshness verdict. Empty when
 * freshness is null (no git / nothing recorded), so the keys are absent.
 */
export function indexFreshnessJsonFields(f: IndexFreshness | null): Record<string, unknown> {
  if (!f) return {};
  return {
    indexedBranch: f.indexedBranch,
    indexedCommit: f.indexedCommit,
    headBranch: f.headBranch,
    headCommit: f.headCommit,
    indexStale: f.stale,
    staleReasons: f.reasons,
  };
}

/** Resolve symlinks where possible so tmp/realpath quirks don't break equality. */
function realpath(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}
