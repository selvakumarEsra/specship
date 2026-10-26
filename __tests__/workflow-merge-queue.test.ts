/**
 * THROUGHPUT-DOC REQ-THRU-002 — completed runs merge through a queue that
 * re-checks each merge, stopping at the first conflict or failing check.
 * Uses a real temporary git repository with run branches.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { runMergeQueue, detectQualityCommand, type MergeQueueRun, type QualityResult } from '../src/workflows/merge-queue';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(cwd: string, file: string, content: string, msg: string): void {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
}

/** Create a run branch off main with one commit writing `file`. */
function runBranch(cwd: string, branch: string, file: string, content: string): void {
  git(cwd, 'checkout', '-q', '-b', branch, 'main');
  commitFile(cwd, file, content, `run ${branch}`);
  git(cwd, 'checkout', '-q', 'main');
}

describe('workflow merge-queue (REQ-THRU-002)', () => {
  let dir: string;
  let runs: Map<string, MergeQueueRun>;
  const getRun = (id: string) => runs.get(id) ?? null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mq-'));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'config', 'commit.gpgsign', 'false');
    commitFile(dir, 'base.txt', 'base\n', 'base');
    runs = new Map();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('REQ-THRU-002.A1 — two non-conflicting branches merge in order with the quality command after each', function cleanRunsMergeInOrder() {
    runBranch(dir, 'specship/wf-impl-aaaa1111', 'a.txt', 'a\n');
    runBranch(dir, 'specship/wf-impl-bbbb2222', 'b.txt', 'b\n');
    runs.set('run-a', { id: 'run-a', status: 'completed', branch: 'specship/wf-impl-aaaa1111' });
    runs.set('run-b', { id: 'run-b', status: 'completed', branch: 'specship/wf-impl-bbbb2222' });

    const checks: string[][] = [];
    const runQuality = (root: string): QualityResult => {
      checks.push(fs.readdirSync(root).filter((f) => f.endsWith('.txt')).sort());
      return { ok: true, command: 'fake-lint' };
    };
    const result = runMergeQueue({ projectRoot: dir, runIds: ['run-a', 'run-b'], getRun, runQuality });

    expect(result).toEqual({ merged: ['run-a', 'run-b'] });
    // The check ran after each merge, seeing exactly the merged state so far.
    expect(checks).toEqual([['a.txt', 'base.txt'], ['a.txt', 'b.txt', 'base.txt']]);
    const subjects = git(dir, 'log', '--first-parent', '--format=%s', '-2').split('\n');
    expect(subjects[0]).toContain('specship/wf-impl-bbbb2222');
    expect(subjects[1]).toContain('specship/wf-impl-aaaa1111');
  });

  it('REQ-THRU-002.A2 — a conflicting second branch stops the queue, keeping the first merge and no conflict markers', function conflictStopsAtLastGoodMerge() {
    runBranch(dir, 'specship/wf-impl-aaaa1111', 'shared.txt', 'from a\n');
    runBranch(dir, 'specship/wf-impl-cccc3333', 'shared.txt', 'from c\n');
    runs.set('run-a', { id: 'run-a', status: 'completed', branch: 'specship/wf-impl-aaaa1111' });
    runs.set('run-c', { id: 'run-c', status: 'completed', branch: 'specship/wf-impl-cccc3333' });

    let checks = 0;
    const result = runMergeQueue({
      projectRoot: dir,
      runIds: ['run-a', 'run-c'],
      getRun,
      runQuality: () => {
        checks++;
        return { ok: true };
      },
    });

    expect(result.merged).toEqual(['run-a']);
    expect(result.stoppedAt).toBe('run-c');
    expect(result.reason).toBe('conflict');
    expect(checks).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8')).toBe('from a\n');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(dir, 'log', '-1', '--format=%s')).toContain('specship/wf-impl-aaaa1111');
  });

  it('REQ-THRU-002.A3 — a merge after which the quality command fails stops the queue and is undone', function failingCheckStopsTheQueue() {
    runBranch(dir, 'specship/wf-impl-aaaa1111', 'a.txt', 'a\n');
    runBranch(dir, 'specship/wf-impl-dddd4444', 'broken.txt', 'broken\n');
    runBranch(dir, 'specship/wf-impl-eeee5555', 'e.txt', 'e\n');
    runs.set('run-a', { id: 'run-a', status: 'completed', branch: 'specship/wf-impl-aaaa1111' });
    runs.set('run-d', { id: 'run-d', status: 'completed', branch: 'specship/wf-impl-dddd4444' });
    runs.set('run-e', { id: 'run-e', status: 'completed', branch: 'specship/wf-impl-eeee5555' });

    const result = runMergeQueue({
      projectRoot: dir,
      runIds: ['run-a', 'run-d', 'run-e'],
      getRun,
      runQuality: (root) => ({ ok: !fs.existsSync(path.join(root, 'broken.txt')), command: 'fake-lint' }),
    });
    const afterA = git(dir, 'rev-parse', 'HEAD');

    expect(result.merged).toEqual(['run-a']);
    expect(result.stoppedAt).toBe('run-d');
    expect(result.reason).toBe('quality-failed');
    expect(fs.existsSync(path.join(dir, 'broken.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'e.txt'))).toBe(false);
    expect(git(dir, 'log', '-1', '--format=%s')).toContain('specship/wf-impl-aaaa1111');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(afterA);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('REQ-THRU-002.A4 — a run that is not completed is refused before any merge happens', function incompleteRunIsRefused() {
    runBranch(dir, 'specship/wf-impl-aaaa1111', 'a.txt', 'a\n');
    runBranch(dir, 'specship/wf-impl-ffff6666', 'f.txt', 'f\n');
    runs.set('run-a', { id: 'run-a', status: 'completed', branch: 'specship/wf-impl-aaaa1111' });
    runs.set('run-f', { id: 'run-f', status: 'paused', branch: 'specship/wf-impl-ffff6666' });
    const before = git(dir, 'rev-parse', 'HEAD');

    let checks = 0;
    const result = runMergeQueue({
      projectRoot: dir,
      runIds: ['run-a', 'run-f'],
      getRun,
      runQuality: () => {
        checks++;
        return { ok: true };
      },
    });

    expect(result.merged).toEqual([]);
    expect(result.stoppedAt).toBe('run-f');
    expect(result.reason).toBe('not-completed');
    expect(result.refused?.map((r) => r.runId)).toEqual(['run-f']);
    expect(checks).toBe(0);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(false);
  });

  it('detects the quality command the implement workflows use', () => {
    expect(detectQualityCommand(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    expect(detectQualityCommand(dir)).toBe('npx --no-install tsc --noEmit');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));
    expect(detectQualityCommand(dir)).toBe('npm run lint --if-present');
  });
});
