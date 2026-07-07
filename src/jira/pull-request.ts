/**
 * Raise a pull request for a completed, verified JIRA implementation run
 * (REQ-JIRA-006).
 *
 * The flow is driven entirely through the repo's EXISTING PR tooling — the
 * GitHub CLI (`gh`) plus `git` — so SpecShip never re-implements auth or the
 * host API. Every step goes through an injectable shell seam so the test suite
 * can assert the command shapes WITHOUT ever running a real `git push` or
 * `gh pr create` (which would push branches / open real PRs).
 *
 * Guarantees:
 *   - A3: if `gh` is missing or unauthenticated, or the push fails, we return
 *     the reason and DO NOTHING destructive — the caller leaves the branch +
 *     worktree fully intact for a manual PR. This helper never removes a
 *     worktree or deletes a branch.
 *   - A1/A2: the PR title and body embed the issue key (also carried by the
 *     branch name) so JIRA's development panel links the PR back to the ticket.
 *   - REQ-JIRA-009: no credential/secret is handled or echoed here — only the
 *     public issue key ever appears in the title/body.
 */

import { spawnSync } from 'child_process';

/** Result of a single shell invocation through the seam. */
export interface ShellResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Injectable shell runner — stubbed in tests, real `spawnSync` in prod. */
export type ShellRunner = (
  command: string,
  args: string[],
  cwd?: string,
) => ShellResult;

/** Discriminated outcome of a PR-raise attempt. */
export type PullRequestOutcome =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'gh-missing' | 'gh-unauthenticated' | 'push-failed' | 'create-failed';
      message: string;
    };

export interface RaisePullRequestOptions {
  /** Project root (the git repo the worktree branches from). */
  repoRoot: string;
  /** The worktree branch carrying the implementation (and the issue key). */
  branchName: string;
  /** Filesystem path of the worktree the push/PR is created from. */
  worktreePath: string;
  /** The source JIRA issue key (for the caller's title/body; embedded already). */
  issueKey: string;
  /** PR title (build with `buildPrTitle`). */
  title: string;
  /** PR body (build with `buildPrBody`). */
  body: string;
  /** Shell seam override (default: `spawnSync`). Tests always pass a stub. */
  shell?: ShellRunner;
}

/** The default shell runner — wraps `spawnSync`. Never used under test. */
function defaultShell(command: string, args: string[], cwd?: string): ShellResult {
  const r = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
  });
  return {
    // ENOENT (command not found) surfaces as a null status — treat as failure.
    status: r.status,
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
  };
}

/**
 * The PR title (A1): `<ISSUE-KEY>: <spec title>`. The leading key makes the PR
 * traceable to the ticket at a glance and is one of the three places JIRA's dev
 * panel matches (branch name + PR title + PR body).
 */
export function buildPrTitle(issueKey: string, specTitle: string): string {
  const title = specTitle.trim() || issueKey;
  return `${issueKey}: ${title}`;
}

/**
 * The PR body (A2): the key sits on its OWN line (`Closes <KEY>` + `JIRA: <KEY>`)
 * so JIRA's development panel links the PR back to the issue. No token/secret is
 * ever embedded — only the public key (REQ-JIRA-009).
 */
export function buildPrBody(issueKey: string, specTitle: string): string {
  const title = specTitle.trim();
  const lines = [
    `Implements ${issueKey}${title ? `: ${title}` : ''}.`,
    '',
    'Raised automatically by SpecShip after the implementation completed and',
    'its verification step passed.',
    '',
    // The key on its own line is what JIRA's dev panel matches on.
    `Closes ${issueKey}`,
    `JIRA: ${issueKey}`,
  ];
  return lines.join('\n');
}

/** Pull the created PR URL out of `gh pr create` stdout (it prints the URL). */
function extractUrl(stdout: string): string {
  const match = stdout.match(/https?:\/\/\S+/);
  if (match) return match[0];
  return stdout.trim();
}

/**
 * Raise a PR for a verified run. Probes `gh`, pushes the branch, then creates
 * the PR — returning early with a reason on the first failure and NEVER
 * touching the branch or worktree so the work is recoverable (A3).
 */
export async function raisePullRequest(
  opts: RaisePullRequestOptions,
): Promise<PullRequestOutcome> {
  const shell = opts.shell ?? defaultShell;
  const { branchName, worktreePath, title, body } = opts;

  // A3: probe the PR tooling before we change anything.
  const version = shell('gh', ['--version'], worktreePath);
  if (version.status !== 0) {
    return {
      ok: false,
      reason: 'gh-missing',
      message:
        'GitHub CLI (gh) is not installed, so no pull request was raised. ' +
        'Install gh (https://cli.github.com) and re-run, or open a PR manually — ' +
        `the branch "${branchName}" and its worktree are left intact.`,
    };
  }

  const auth = shell('gh', ['auth', 'status'], worktreePath);
  if (auth.status !== 0) {
    return {
      ok: false,
      reason: 'gh-unauthenticated',
      message:
        'GitHub CLI (gh) is not authenticated, so no pull request was raised. ' +
        'Run "gh auth login" and re-run, or open a PR manually — the branch ' +
        `"${branchName}" and its worktree are left intact.`,
    };
  }

  const push = shell('git', ['push', '-u', 'origin', branchName], worktreePath);
  if (push.status !== 0) {
    return {
      ok: false,
      reason: 'push-failed',
      message:
        `Pushing branch "${branchName}" failed, so no pull request was raised: ` +
        `${push.stderr.trim() || 'unknown error'}. The branch and its worktree ` +
        'are left intact for a manual push/PR.',
    };
  }

  const create = shell(
    'gh',
    ['pr', 'create', '--title', title, '--body', body, '--head', branchName],
    worktreePath,
  );
  if (create.status !== 0) {
    return {
      ok: false,
      reason: 'create-failed',
      message:
        `"gh pr create" failed, so no pull request was raised: ` +
        `${create.stderr.trim() || 'unknown error'}. The branch "${branchName}" ` +
        'was pushed and its worktree is intact — open the PR manually.',
    };
  }

  return { ok: true, url: extractUrl(create.stdout) };
}
