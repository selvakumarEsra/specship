/**
 * THROUGHPUT-DOC REQ-THRU-007 — `workflow gc` purges the worktrees of runs
 * whose branch is merged into the default branch, keeps run records, leaves
 * unmerged runs alone, and `--dry-run` removes nothing. Real temp git repo
 * with real `git worktree add` worktrees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { collectMergedRuns, type GcRun } from '../src/workflows/gc';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(cwd: string, file: string, content: string, msg: string): void {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
}

describe('workflow gc (REQ-THRU-007)', () => {
  let tmp: string;
  let repo: string;
  let records: Map<string, GcRun>;
  let purged: string[];

  /** The purge seam: what `workflow purge` does — remove the worktree, keep the record. */
  const purge = (runId: string) => {
    const run = records.get(runId)!;
    git(repo, 'worktree', 'remove', run.workingPath!);
    purged.push(runId);
  };

  function addRun(id: string, branch: string, merge: boolean): GcRun {
    const wt = path.join(tmp, 'worktrees', id);
    git(repo, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
    git(wt, 'config', 'user.email', 't@example.com');
    git(wt, 'config', 'user.name', 'T');
    commitFile(wt, `${id}.txt`, `${id}\n`, `run ${id}`);
    if (merge) git(repo, 'merge', '-q', '--no-ff', '--no-edit', branch);
    const run: GcRun = { id, status: 'completed', branch, workingPath: wt };
    records.set(id, run);
    return run;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gc-'));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@example.com');
    git(repo, 'config', 'user.name', 'T');
    git(repo, 'config', 'commit.gpgsign', 'false');
    commitFile(repo, 'base.txt', 'base\n', 'base');
    records = new Map();
    purged = [];
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('REQ-THRU-007.A1 — a run merged into the default branch has its worktree removed and its record kept', function mergedRunWorktreeIsPurged() {
    const run = addRun('run-merged', 'specship/wf-impl-aaaa1111', true);

    const result = collectMergedRuns({ projectRoot: repo, listRuns: () => [...records.values()], purge });

    expect(result.defaultBranch).toBe('main');
    expect(result.candidates.map((c) => c.runId)).toEqual(['run-merged']);
    expect(result.purged).toEqual(['run-merged']);
    expect(purged).toEqual(['run-merged']);
    expect(fs.existsSync(run.workingPath!)).toBe(false);
    expect(git(repo, 'worktree', 'list')).not.toContain('run-merged');
    expect(records.has('run-merged')).toBe(true);
  });

  it('REQ-THRU-007.A2 — a run whose branch is not merged keeps its worktree', function unmergedRunIsKept() {
    addRun('run-merged', 'specship/wf-impl-aaaa1111', true);
    const open = addRun('run-open', 'specship/wf-impl-bbbb2222', false);

    const result = collectMergedRuns({ projectRoot: repo, listRuns: () => [...records.values()], purge });

    expect(result.purged).toEqual(['run-merged']);
    expect(result.candidates.map((c) => c.runId)).not.toContain('run-open');
    expect(fs.existsSync(open.workingPath!)).toBe(true);
    expect(fs.existsSync(path.join(open.workingPath!, 'run-open.txt'))).toBe(true);
    expect(git(repo, 'branch', '--list', 'specship/wf-impl-bbbb2222')).toContain('specship/wf-impl-bbbb2222');
  });

  it('REQ-THRU-007.A3 — --dry-run lists the candidates and removes nothing', function dryRunRemovesNothing() {
    const merged = addRun('run-merged', 'specship/wf-impl-aaaa1111', true);
    const open = addRun('run-open', 'specship/wf-impl-bbbb2222', false);

    const result = collectMergedRuns({ projectRoot: repo, dryRun: true, listRuns: () => [...records.values()], purge });

    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((c) => c.runId)).toEqual(['run-merged']);
    expect(result.purged).toEqual([]);
    expect(purged).toEqual([]);
    expect(fs.existsSync(merged.workingPath!)).toBe(true);
    expect(fs.existsSync(open.workingPath!)).toBe(true);
  });
});
