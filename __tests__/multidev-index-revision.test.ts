/**
 * REQ-MULTIDEV-004 — `specship status` shows the branch and commit the index
 * was built from, and flags a possibly-stale index (report-only).
 *
 * Driven through the library (not dist/) in real temp git repos.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpecShip } from '../src';
import { ToolHandler } from '../src/mcp/tools';
import { indexFreshnessJsonFields, indexStaleNotice } from '../src/sync/worktree';

const dirs: string[] = [];
const open: SpecShip[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const cg of open.splice(0)) {
    try { cg.close(); } catch { /* already closed */ }
  }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

function commitFile(repo: string, file: string, body: string, msg: string): string {
  fs.writeFileSync(path.join(repo, file), body);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD');
}

async function gitRepoWithIndex(): Promise<{ repo: string; cg: SpecShip; first: string }> {
  const repo = tmp('specship-multidev004-');
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.specship/\n');
  git(repo, 'add', '.gitignore');
  const first = commitFile(repo, 'a.ts', 'export const a = 1;\n', 'first');
  const cg = SpecShip.initSync(repo);
  open.push(cg);
  await cg.indexAll();
  return { repo, cg, first };
}

async function reqMultidev004A1(): Promise<void> {
  const { cg, first } = await gitRepoWithIndex();
  await cg.sync();
  const f = cg.getIndexFreshness();
  expect(f).not.toBeNull();
  expect(f!.indexedCommit).toBe(first);
  expect(f!.headCommit).toBe(first);
  expect(f!.indexedBranch).toBe('main');
  expect(f!.headBranch).toBe('main');
  expect(f!.stale).toBe(false);
  expect(f!.reasons).toEqual([]);

  const json = indexFreshnessJsonFields(f);
  expect(json).toMatchObject({
    indexedBranch: 'main',
    indexedCommit: first,
    headCommit: first,
    headBranch: 'main',
    indexStale: false,
    staleReasons: [],
  });
}

async function reqMultidev004A2(): Promise<void> {
  const { repo, cg, first } = await gitRepoWithIndex();
  const second = commitFile(repo, 'b.ts', 'export const b = 2;\n', 'second');
  git(repo, 'checkout', '-q', first);
  git(repo, 'checkout', '-q', 'main'); // HEAD now at `second`, index still at `first`

  let f = cg.getIndexFreshness()!;
  expect(f.headCommit).toBe(second);
  expect(f.stale).toBe(true);
  expect(f.reasons).toContain('commit-moved');
  expect(indexStaleNotice(f)).toContain('specship sync');

  await cg.sync();
  f = cg.getIndexFreshness()!;
  expect(f.indexedCommit).toBe(second);
  expect(f.stale).toBe(false);

  // Edit a tracked file then sync: the index reflects the working tree → fresh.
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 10;\n');
  await cg.sync();
  f = cg.getIndexFreshness()!;
  expect(f.stale).toBe(false);
  expect(f.reasons).toEqual([]);

  // Edit again without syncing: uncommitted changes differ from index time → stale.
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 11;\n');
  f = cg.getIndexFreshness()!;
  expect(f.stale).toBe(true);
  expect(f.reasons).toEqual(['uncommitted-changes']);
  expect(indexStaleNotice(f)).toContain('specship sync');

  // Untracked files never count.
  await cg.sync();
  fs.writeFileSync(path.join(repo, 'new-untracked.ts'), 'export const n = 1;\n');
  expect(cg.getIndexFreshness()!.stale).toBe(false);
}

async function reqMultidev004A3(): Promise<void> {
  const { repo, cg, first } = await gitRepoWithIndex();
  git(repo, 'checkout', '-q', '--detach');
  await cg.sync();
  let f = cg.getIndexFreshness()!;
  expect(f.indexedBranch).toBeNull();
  expect(f.indexedCommit).toBe(first);
  expect(f.headBranch).toBeNull();
  expect(f.stale).toBe(false);

  git(repo, 'checkout', '-q', 'main');
  const second = commitFile(repo, 'b.ts', 'export const b = 2;\n', 'second');
  git(repo, 'checkout', '-q', '--detach', second);
  f = cg.getIndexFreshness()!;
  expect(f.indexedBranch).toBeNull();
  expect(f.headCommit).toBe(second);
  expect(f.stale).toBe(true);
  expect(f.reasons).toContain('commit-moved');
}

async function reqMultidev004A4(): Promise<void> {
  const dir = tmp('specship-multidev004-nogit-');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  const cg = SpecShip.initSync(dir);
  open.push(cg);
  const idx = await cg.indexAll();
  expect(idx.success).toBe(true);
  await expect(cg.sync()).resolves.toBeDefined();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, '.specship', 'specship.db'), { readOnly: true });
  const rows = db
    .prepare("SELECT key FROM project_metadata WHERE key LIKE 'indexed_%'")
    .all() as Array<{ key: string }>;
  db.close();
  expect(rows.map((r) => r.key)).toEqual([]);
  expect(cg.getIndexFreshness()).toBeNull();

  const json = indexFreshnessJsonFields(cg.getIndexFreshness());
  for (const k of ['indexedBranch', 'indexedCommit', 'headCommit', 'headBranch', 'indexStale', 'staleReasons']) {
    expect(json).not.toHaveProperty(k);
  }

  const handler = new ToolHandler(cg);
  const res = await handler.execute('specship_status', {});
  const text = res.content.map((c) => ('text' in c ? c.text : '')).join('\n');
  expect(text).not.toContain('Index may be stale');
  expect(text).not.toContain('**Indexed:**');
}

async function reqMultidev004A5(): Promise<void> {
  const { repo, cg } = await gitRepoWithIndex();
  commitFile(repo, 'b.ts', 'export const b = 2;\n', 'second');

  const syncSpy = vi.spyOn(SpecShip.prototype, 'sync');
  const indexSpy = vi.spyOn(SpecShip.prototype, 'indexAll');

  const f = cg.getIndexFreshness()!;
  expect(f.stale).toBe(true);

  const handler = new ToolHandler(cg);
  const res = await handler.execute('specship_status', {});
  const text = res.content.map((c) => ('text' in c ? c.text : '')).join('\n');
  expect(text).toContain('Index may be stale');
  expect(text).toContain('specship sync');

  expect(syncSpy).toHaveBeenCalledTimes(0);
  expect(indexSpy).toHaveBeenCalledTimes(0);
  // Still stale: nothing re-indexed behind our back.
  expect(cg.getIndexFreshness()!.stale).toBe(true);
}

describe('REQ-MULTIDEV-004 — indexed branch/commit and stale-index notice', () => {
  it('REQ-MULTIDEV-004.A1 records branch and commit; fresh right after sync', reqMultidev004A1);
  it('REQ-MULTIDEV-004.A2 flags a moved HEAD or changed working tree as stale; sync clears it', reqMultidev004A2);
  it('REQ-MULTIDEV-004.A3 detached HEAD records the commit with no branch and still detects staleness', reqMultidev004A3);
  it('REQ-MULTIDEV-004.A4 outside git the fields are absent and nothing fails', reqMultidev004A4);
  it('REQ-MULTIDEV-004.A5 no CLI/MCP status call triggers a sync because HEAD moved', reqMultidev004A5);
});
