import { describe, it, expect, vi } from 'vitest';
import {
  raisePullRequest,
  buildPrTitle,
  buildPrBody,
  type ShellRunner,
  type ShellResult,
} from '../../src/jira/pull-request';
import {
  handleJiraRunCompletion,
  type JiraCompletionDeps,
  type IsolationEnvLike,
} from '../../src/mcp/jira-tools';

/**
 * REQ-JIRA-006 — raise a PR for a completed, verified JIRA run.
 *
 * CRITICAL: the gh/git shell layer is ALWAYS stubbed — the suite NEVER runs a
 * real `git push` or `gh pr create` (which would push branches / open real
 * PRs). We assert the COMMAND SHAPES, not real execution. No network.
 */

const OK: ShellResult = { status: 0, stdout: '', stderr: '' };
const FAIL: ShellResult = { status: 1, stdout: '', stderr: 'boom' };

interface ShellCall {
  command: string;
  args: string[];
  cwd?: string;
}

/**
 * A recording shell stub. `responses` maps a matcher (first arg keyword) to a
 * result; anything unmatched returns OK. Records every invocation so we can
 * assert command shapes AND that nothing destructive ran.
 */
function recordingShell(
  responses: Array<{ match: (c: ShellCall) => boolean; result: ShellResult }> = [],
): { shell: ShellRunner; calls: ShellCall[] } {
  const calls: ShellCall[] = [];
  const shell: ShellRunner = (command, args, cwd) => {
    const call: ShellCall = { command, args, cwd };
    calls.push(call);
    for (const r of responses) if (r.match(call)) return r.result;
    return OK;
  };
  return { shell, calls };
}

const BASE = {
  repoRoot: '/repo',
  branchName: 'specship/PROJ-7-abc12345',
  worktreePath: '/wt',
  issueKey: 'PROJ-7',
  title: buildPrTitle('PROJ-7', 'Add a logout button'),
  body: buildPrBody('PROJ-7', 'Add a logout button'),
};

/** No destructive git ran — the branch/worktree stay intact on every path (A3). */
function assertNoTeardown(calls: ShellCall[]): void {
  for (const c of calls) {
    const joined = `${c.command} ${c.args.join(' ')}`;
    expect(joined).not.toMatch(/worktree\s+remove/);
    expect(joined).not.toMatch(/branch\s+-D/);
    expect(joined).not.toMatch(/push.*--delete|:.*--delete/);
  }
}

describe('buildPrTitle / buildPrBody (A1/A2 — key embedded)', () => {
  it('A1: the title leads with the issue key', () => {
    expect(buildPrTitle('PROJ-7', 'Add a logout button')).toBe(
      'PROJ-7: Add a logout button',
    );
    expect(buildPrTitle('PROJ-7', '  ')).toBe('PROJ-7: PROJ-7');
  });

  it('A2: the body embeds the key on its own line for JIRA to match', () => {
    const body = buildPrBody('PROJ-7', 'Add a logout button');
    // The key appears on a line by itself (dev-panel match).
    expect(body.split(/\n/)).toContain('Closes PROJ-7');
    expect(body).toMatch(/^JIRA: PROJ-7$/m);
  });

  it('never embeds anything but the public key (no token/secret)', () => {
    const body = buildPrBody('PROJ-7', 'Add a logout button');
    expect(body).not.toMatch(/tok-|secret|api[_-]?token/i);
  });
});

describe('raisePullRequest', () => {
  it('gh-missing when `gh --version` fails, and touches nothing destructive', async () => {
    const { shell, calls } = recordingShell([
      { match: (c) => c.command === 'gh' && c.args[0] === '--version', result: FAIL },
    ]);
    const out = await raisePullRequest({ ...BASE, shell });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('gh-missing');
    // Bailed before push/create.
    expect(calls.some((c) => c.args.includes('push'))).toBe(false);
    expect(calls.some((c) => c.args.includes('create'))).toBe(false);
    assertNoTeardown(calls);
  });

  it('gh-unauthenticated when `gh auth status` fails', async () => {
    const { shell, calls } = recordingShell([
      {
        match: (c) => c.command === 'gh' && c.args[0] === 'auth' && c.args[1] === 'status',
        result: FAIL,
      },
    ]);
    const out = await raisePullRequest({ ...BASE, shell });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('gh-unauthenticated');
    expect(calls.some((c) => c.args.includes('push'))).toBe(false);
    assertNoTeardown(calls);
  });

  it('push-failed when `git push` fails, and leaves branch/worktree intact', async () => {
    const { shell, calls } = recordingShell([
      { match: (c) => c.command === 'git' && c.args[0] === 'push', result: FAIL },
    ]);
    const out = await raisePullRequest({ ...BASE, shell });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('push-failed');
    // Never got to pr create.
    expect(calls.some((c) => c.args.includes('create'))).toBe(false);
    assertNoTeardown(calls);
  });

  it('create-failed when `gh pr create` fails', async () => {
    const { shell, calls } = recordingShell([
      {
        match: (c) => c.command === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create',
        result: FAIL,
      },
    ]);
    const out = await raisePullRequest({ ...BASE, shell });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('create-failed');
    assertNoTeardown(calls);
  });

  it('success: pushes the branch, creates the PR with key-bearing title/body, returns the URL', async () => {
    const url = 'https://github.com/acme/repo/pull/42';
    const { shell, calls } = recordingShell([
      {
        match: (c) => c.command === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create',
        result: { status: 0, stdout: `${url}\n`, stderr: '' },
      },
    ]);
    const out = await raisePullRequest({ ...BASE, shell });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.url).toBe(url);

    // Command shapes: push -u origin <branch> from the worktree.
    const push = calls.find((c) => c.command === 'git' && c.args[0] === 'push');
    expect(push).toBeDefined();
    expect(push!.args).toEqual(['push', '-u', 'origin', BASE.branchName]);
    expect(push!.cwd).toBe(BASE.worktreePath);

    // gh pr create carries the key in title + body + --head branch.
    const create = calls.find(
      (c) => c.command === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create',
    )!;
    expect(create.args).toContain('--head');
    expect(create.args[create.args.indexOf('--head') + 1]).toBe(BASE.branchName);
    const title = create.args[create.args.indexOf('--title') + 1]!;
    const body = create.args[create.args.indexOf('--body') + 1]!;
    expect(title).toContain('PROJ-7'); // A1
    expect(body).toMatch(/^JIRA: PROJ-7$/m); // A2
    assertNoTeardown(calls);
  });
});

describe('handleJiraRunCompletion', () => {
  const ENV: IsolationEnvLike = {
    branchName: 'specship/PROJ-7-abc12345',
    workingPath: '/wt',
    metadata: { repoRoot: '/repo' },
  };

  function completedRun(over: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      status: 'completed',
      isolationEnvId: '/wt',
      metadata: {
        jira: { issueKey: 'PROJ-7', specId: 'REQ-PROJ-7', title: 'Add a logout button' },
        nodeStates: { verify: 'completed' },
        outputs: { verify: { text: 'npm test ok\nVERIFY_RESULT=ran-and-passed\n' } },
        ...over,
      },
    };
  }

  function deps(raise: JiraCompletionDeps['raisePullRequest']): {
    d: JiraCompletionDeps;
    logs: string[];
  } {
    const logs: string[] = [];
    return {
      logs,
      d: {
        getIsolationEnvById: () => ENV,
        raisePullRequest: raise,
        projectRoot: '/repo',
        log: (m) => logs.push(m),
      },
    };
  }

  it('completed + verified → raises a PR with the key-bearing branch/title/body', async () => {
    const raise = vi.fn().mockResolvedValue({ ok: true, url: 'https://x/pull/1' });
    const { d, logs } = deps(raise);

    const out = await handleJiraRunCompletion(completedRun(), d);

    expect(raise).toHaveBeenCalledTimes(1);
    const arg = raise.mock.calls[0]![0];
    expect(arg.branchName).toBe(ENV.branchName);
    expect(arg.worktreePath).toBe('/wt');
    expect(arg.repoRoot).toBe('/repo');
    expect(arg.title).toContain('PROJ-7');
    expect(arg.body).toMatch(/^JIRA: PROJ-7$/m);
    expect(out).toEqual({ ok: true, url: 'https://x/pull/1' });
    expect(logs.join('\n')).toContain('https://x/pull/1');
  });

  it('a completed-but-verify-SKIPPED run raises NO PR', async () => {
    const raise = vi.fn();
    const { d } = deps(raise);
    const run = completedRun({
      outputs: { verify: { text: 'no framework\nVERIFY_RESULT=skipped\n' } },
    });

    const out = await handleJiraRunCompletion(run, d);

    expect(raise).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it('a non-JIRA run (no metadata.jira) is a silent no-op', async () => {
    const raise = vi.fn();
    const { d } = deps(raise);
    const run = { id: 'r', status: 'completed', isolationEnvId: '/wt', metadata: {} };

    const out = await handleJiraRunCompletion(run, d);

    expect(raise).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it('gh-missing → clear message; the branch/worktree are left intact (no teardown here)', async () => {
    const raise = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'gh-missing',
      message: 'GitHub CLI (gh) is not installed … left intact.',
    });
    const { d, logs } = deps(raise);

    const out = await handleJiraRunCompletion(completedRun(), d);

    expect(raise).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: false, reason: 'gh-missing' });
    // The handler never destroys the worktree — it only reports.
    expect(logs.join('\n')).toMatch(/intact/i);
  });
});
