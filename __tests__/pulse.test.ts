/**
 * PIPETRUST-DOC — pipeline pulse (REQ-PIPETRUST-007): pipeline failures are
 * surfaced, not discovered. Every external command goes through an injected
 * fake runner — no network. The worktree check runs against a real temp git
 * repo with a merged run branch checked out in a `git worktree`.
 *
 * @verifies REQ-PIPETRUST-007
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import {
  computePulse,
  formatPulseLines,
  readCachedPulse,
  defaultCommandRunner,
  type CommandRunner,
  type CommandResult,
  type PulseItem,
} from '../src/pulse/pulse';
import {
  writeLastAutoPublishReport,
  readLastAutoPublishReport,
} from '../src/jira/auto-publish';

let dir: string;
const NOW = Date.parse('2026-10-26T12:00:00Z');

function writeFile(rel: string, body: string): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function setupPackage(version = '0.26.0'): void {
  writeFile('package.json', JSON.stringify({ name: '@acme/tool', version }));
  writeFile('.github/workflows/release.yml', 'name: Release\n');
}

type Handler = (args: string[]) => CommandResult | undefined;

/** Fake runner keyed by `cmd args...` prefix; unmatched → tool missing. */
function fakeRunner(handlers: Record<string, Handler | CommandResult>): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  const runner = (async (cmd: string, args: string[]) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    const keys = Object.keys(handlers).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (line.startsWith(key)) {
        const h = handlers[key];
        const r = typeof h === 'function' ? h(args) : h;
        if (r) return r;
      }
    }
    return { ok: false, stdout: '', missing: true };
  }) as CommandRunner & { calls: string[] };
  runner.calls = calls;
  return runner;
}

const ok = (stdout: string): CommandResult => ({ ok: true, stdout });
const json = (v: unknown): CommandResult => ok(JSON.stringify(v));

/** Healthy GitHub/npm responses for package version `v`. */
function healthyNet(v = '0.26.0'): Record<string, CommandResult> {
  return {
    'gh run list': json([{ conclusion: 'success', createdAt: '2026-10-20T10:00:00Z', displayTitle: `v${v}`, databaseId: 1 }]),
    'gh release list': json([{ tagName: `v${v}` }]),
    'npm view': ok(`${v}\n`),
    'git worktree list': ok(`worktree ${dir}\nHEAD abc\nbranch refs/heads/main\n\n`),
  };
}

function item(items: PulseItem[], id: PulseItem['id']): PulseItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`no ${id} item`);
  return found;
}

function git(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// ---------------------------------------------------------------------------
// Named test functions (linked from specs/pipeline-trust.md `verifies:`)
// ---------------------------------------------------------------------------

async function npmLaggingReleaseIsFlagged(): Promise<void> {
  setupPackage('0.26.1');
  const runner = fakeRunner({
    ...healthyNet('0.26.0'),
    'npm view': ok('0.25.0\n'),
  });
  const { items } = await computePulse({ projectRoot: dir, runner, now: () => NOW });
  const npm = item(items, 'npm');
  expect(npm.status).toBe('fail');
  expect(npm.message).toContain('0.25.0');
  expect(npm.message).toContain('v0.26.0');
  expect(npm.message).toContain('0.26.1');
  const lines = formatPulseLines(items);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^⚠ npm @acme\/tool is at 0\.25\.0 but latest GitHub release is v0\.26\.0/);
}

async function failedReleaseRunIsFlagged(): Promise<void> {
  setupPackage();
  const runner = fakeRunner({
    ...healthyNet(),
    'gh run list': json([{ conclusion: 'failure', createdAt: '2026-09-28T08:15:00Z', displayTitle: 'v0.26.0', databaseId: 42 }]),
    'gh run view 42': json({
      jobs: [{ name: 'publish', conclusion: 'failure', steps: [
        { name: 'Build', conclusion: 'success' },
        { name: 'Publish to npm', conclusion: 'failure' },
      ] }],
    }),
  });
  const { items } = await computePulse({ projectRoot: dir, runner, now: () => NOW });
  const rel = item(items, 'release');
  expect(rel.status).toBe('fail');
  expect(rel.message).toContain('2026-09-28');
  expect(rel.message).toContain('Publish to npm');

  // Failing step unavailable → still flagged with the date, step omitted.
  const runner2 = fakeRunner({
    ...healthyNet(),
    'gh run list': json([{ conclusion: 'failure', createdAt: '2026-09-28T08:15:00Z', databaseId: 42 }]),
  });
  const rel2 = item((await computePulse({ projectRoot: dir, runner: runner2, now: () => NOW })).items, 'release');
  expect(rel2.status).toBe('fail');
  expect(rel2.message).toContain('2026-09-28');
  expect(rel2.message).not.toContain('step');
}

async function jiraPublishFailuresAreFlagged(): Promise<void> {
  fs.mkdirSync(path.join(dir, '.specship'), { recursive: true });
  const results = [
    ...Array.from({ length: 82 }, (_, i) => ({ specId: `REQ-X-${i}`, status: 'failed' as const, note: 'HTTP 400' })),
    { specId: 'REQ-OK-1', status: 'published' as const },
  ];
  writeLastAutoPublishReport(dir, { results }, NOW);
  const last = readLastAutoPublishReport(dir);
  expect(last?.counts.failed).toBe(82);
  expect(last?.failures[0]).toEqual({ specId: 'REQ-X-0', note: 'HTTP 400' });
  expect(last?.summary).toContain('82 failed');

  const runner = fakeRunner({}); // every external tool missing
  const { items } = await computePulse({ projectRoot: dir, runner, now: () => NOW });
  const jira = item(items, 'jira');
  expect(jira.status).toBe('fail');
  expect(jira.message).toContain('82 failed');
  expect(formatPulseLines(items)).toEqual([expect.stringContaining('JIRA auto-publish: 82 failed')]);
}

async function mergedRunWorktreesAreFlagged(): Promise<void> {
  // A real repo: main + one merged run branch + one unmerged run branch,
  // each checked out in its own worktree under a `.specship/worktrees` dir.
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 't@example.com'], repo);
  git(['config', 'user.name', 'T'], repo);
  git(['config', 'commit.gpgsign', 'false'], repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'init'], repo);

  const wtRoot = path.join(dir, 'home', '.specship', 'worktrees', 'abc123');
  const merged = path.join(wtRoot, 'spec-implement-1a2b3c4d');
  const open = path.join(wtRoot, 'spec-implement-5e6f7a8b');
  git(['worktree', 'add', '-q', '-b', 'specship/wf-spec-implement-1a2b3c4d', merged, 'main'], repo);
  fs.writeFileSync(path.join(merged, 'b.txt'), 'b\n');
  git(['add', '.'], merged);
  git(['commit', '-q', '-m', 'run work'], merged);
  git(['merge', '-q', '--no-ff', '-m', 'merge run', 'specship/wf-spec-implement-1a2b3c4d'], repo);

  git(['worktree', 'add', '-q', '-b', 'specship/wf-spec-implement-5e6f7a8b', open, 'main'], repo);
  fs.writeFileSync(path.join(open, 'c.txt'), 'c\n');
  git(['add', '.'], open);
  git(['commit', '-q', '-m', 'unmerged work'], open);

  // Real git, fake gh/npm (missing).
  const runner: CommandRunner = (cmd, args, opts) =>
    cmd === 'git' ? defaultCommandRunner(cmd, args, opts) : Promise.resolve({ ok: false, stdout: '', missing: true });

  const { items } = await computePulse({
    projectRoot: repo,
    runner,
    now: () => NOW,
    runIdForWorktree: (p) => (p.endsWith('1a2b3c4d') ? '1a2b3c4d-full-run-id' : undefined),
  });
  const wt = item(items, 'worktrees');
  expect(wt.status).toBe('fail');
  expect(wt.message).toContain('spec-implement-1a2b3c4d');
  expect(wt.message).not.toContain('5e6f7a8b');
  expect(wt.hint).toBe('specship workflow purge 1a2b3c4d-full-run-id');

  // Without a resolver the hint falls back to the short run id.
  const fallback = item((await computePulse({ projectRoot: repo, runner, now: () => NOW })).items, 'worktrees');
  expect(fallback.hint).toBe('specship workflow purge 1a2b3c4d');
}

async function healthyPulseIsSilent(): Promise<void> {
  setupPackage();
  fs.mkdirSync(path.join(dir, '.specship'), { recursive: true });
  writeLastAutoPublishReport(dir, { results: [{ specId: 'REQ-A', status: 'unchanged' }] }, NOW);
  const runner = fakeRunner(healthyNet());
  const result = await computePulse({ projectRoot: dir, runner, now: () => NOW });
  expect(result.items.map((i) => i.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  expect(formatPulseLines(result.items)).toEqual([]);

  // Cached for the session-start summary, which reads it with no runner.
  const cached = readCachedPulse(dir);
  expect(cached?.checkedAt).toBe(NOW);
  expect(formatPulseLines(cached!.items)).toEqual([]);

  // A fresh-enough cache is served without running anything.
  const silentRunner = fakeRunner({});
  const again = await computePulse({ projectRoot: dir, runner: silentRunner, now: () => NOW + 1000, maxAgeMs: 60_000 });
  expect(again.fromCache).toBe(true);
  expect(silentRunner.calls).toEqual([]);
}

async function offlineSkipsNetworkChecks(): Promise<void> {
  setupPackage();
  // gh missing entirely; npm hangs past its timeout (offline).
  const hang: CommandRunner = (cmd, args, opts) => {
    if (cmd === 'npm') return new Promise(() => { /* never resolves */ });
    if (cmd === 'git') return Promise.resolve(ok(`worktree ${opts.cwd}\nbranch refs/heads/main\n`));
    return Promise.resolve({ ok: false, stdout: '', missing: true });
  };
  const started = Date.now();
  const { items } = await computePulse({
    projectRoot: dir,
    runner: hang,
    now: () => NOW,
    commandTimeoutMs: 100,
    totalBudgetMs: 300,
  });
  expect(Date.now() - started).toBeLessThan(2000);
  expect(item(items, 'release').status).toBe('skipped');
  expect(item(items, 'release').message).toContain('gh not available');
  expect(item(items, 'npm').status).toBe('skipped');
  expect(item(items, 'npm').message).toContain('timed out');
  expect(items.some((i) => i.status === 'fail')).toBe(false);
  expect(formatPulseLines(items)).toEqual([]);

  // A runner that throws is also a skip, never an exception.
  const throwing: CommandRunner = () => { throw new Error('boom'); };
  const r2 = await computePulse({ projectRoot: dir, runner: throwing, now: () => NOW });
  expect(r2.items.every((i) => i.status !== 'fail')).toBe(true);
}

describe('pipeline pulse (REQ-PIPETRUST-007)', () => {
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-')));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('npm lagging the latest release or package.json is flagged with both versions (REQ-PIPETRUST-007.A1)', npmLaggingReleaseIsFlagged);
  it('a failed release workflow run is flagged with its date and failing step (REQ-PIPETRUST-007.A2)', failedReleaseRunIsFlagged);
  it('failures in the last JIRA auto-publish are persisted and flagged with the count (REQ-PIPETRUST-007.A3)', jiraPublishFailuresAreFlagged);
  it('merged workflow-run worktrees are flagged with a purge hint (REQ-PIPETRUST-007.A4)', mergedRunWorktreesAreFlagged);
  it('a healthy pulse adds no summary lines (REQ-PIPETRUST-007.A5)', healthyPulseIsSilent);
  it('unavailable tools and timeouts skip network checks without failing or stalling (REQ-PIPETRUST-007.A6)', offlineSkipsNetworkChecks);
});
