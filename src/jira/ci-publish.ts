/**
 * CI-only JIRA publishing gate (REQ-MULTIDEV-005).
 *
 * With `jira.publishFrom: "ci"` in `specship.config.json`, every JIRA create
 * or update of a spec issue happens only in a CI run (`CI=true`) whose
 * checkout is on `jira.publishBranch` (default `main`). Every other run
 * defers and reports the spec as pending CI publication. With the setting
 * absent the gate answers `direct` and callers behave exactly as before.
 *
 * This module only READS git (branch name, origin URL). It never commits or
 * pushes — CI never writes to git.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';
import { readRepoJiraBinding } from './repo-config';
import type { JiraRepoBinding } from './types';

export type CiPublishGate =
  /** Setting absent: publish exactly as before. */
  | { mode: 'direct' }
  /** CI on the publish branch: publish, with cross-run dedupe, no git writes. */
  | { mode: 'publish'; publishBranch: string }
  /** Anywhere else: no JIRA write; `reason` is the user-facing note. */
  | { mode: 'deferred'; reason: string; publishBranch: string };

export interface CiPublishGateContext {
  /** Environment to read `CI` from. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Current branch (test seam). Default: `detectCurrentBranch(cwd)`. */
  currentBranch?: string | null;
  /** Checkout directory for branch detection. Default `process.cwd()`. */
  cwd?: string;
}

/** True when the environment reports a CI run (`CI=true`). */
export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CI ?? '').trim().toLowerCase() === 'true';
}

/**
 * Decide whether this run may write spec issues to JIRA. Pure apart from the
 * (injectable) branch lookup, which only runs in CI under the setting.
 */
export function resolveCiPublishGate(
  binding: Pick<JiraRepoBinding, 'publishFrom' | 'publishBranch'> | null | undefined,
  ctx: CiPublishGateContext = {},
): CiPublishGate {
  if (!binding || binding.publishFrom !== 'ci') return { mode: 'direct' };
  const publishBranch = binding.publishBranch?.trim() || 'main';
  const env = ctx.env ?? process.env;
  if (!isCiEnvironment(env)) {
    return {
      mode: 'deferred',
      publishBranch,
      reason:
        `pending CI publication — this repo publishes to JIRA only from CI on ` +
        `"${publishBranch}" (jira.publishFrom: "ci"); it will publish after merge.`,
    };
  }
  const branch =
    ctx.currentBranch !== undefined
      ? ctx.currentBranch
      : detectCurrentBranch(ctx.cwd ?? process.cwd(), env);
  if (branch !== publishBranch) {
    return {
      mode: 'deferred',
      publishBranch,
      reason:
        `pending CI publication — CI is on "${branch ?? 'unknown branch'}", but ` +
        `this repo publishes to JIRA only from "${publishBranch}" (jira.publishBranch).`,
    };
  }
  return { mode: 'publish', publishBranch };
}

/**
 * The checkout's branch. CI checkouts are often detached, so the provider's
 * branch variable wins (`GITHUB_REF_NAME`, `CI_COMMIT_REF_NAME`,
 * `BRANCH_NAME`), then `git rev-parse --abbrev-ref HEAD`. Null when unknown
 * (detached with no CI variable, or not a git repo).
 */
export function detectCurrentBranch(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const name of ['GITHUB_REF_NAME', 'CI_COMMIT_REF_NAME', 'BRANCH_NAME']) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  const head = gitRead(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return head && head !== 'HEAD' ? head : null;
}

/**
 * Stable repository identity for the dedupe label: the basename of the
 * `origin` remote URL without `.git`, falling back to the directory name.
 * Two repos bound to the same JIRA project must not match each other's
 * issues even when they declare the same requirement ID.
 */
export function detectRepoIdentity(projectRoot: string): string {
  const url = gitRead(projectRoot, ['remote', 'get-url', 'origin']);
  if (url) {
    const tail = url.replace(/[/\\]+$/, '').split(/[/\\:]/).pop() ?? '';
    const name = tail.replace(/\.git$/i, '');
    if (name) return name;
  }
  return path.basename(path.resolve(projectRoot));
}

/** JIRA labels cannot contain spaces; keep a conservative character set. */
function sanitizeLabelPart(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The repo-scoped label stamped on a created spec issue and searched for
 * before creating one: `specship-<repo>-<REQ-ID>`.
 */
export function specIssueLabel(repoIdentity: string, specId: string): string {
  return `specship-${sanitizeLabelPart(repoIdentity) || 'repo'}-${sanitizeLabelPart(specId)}`;
}

function gitRead(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const v = out.trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the gate straight from the repo binding at `projectRoot`. An
 * unreadable binding answers `direct` — the caller's own binding handling
 * surfaces that problem, exactly as before this setting existed.
 */
export function ciPublishGateFor(
  projectRoot: string,
  ctx: CiPublishGateContext = {},
  load: (cwd: string) => { binding: JiraRepoBinding | null } = readRepoJiraBinding,
): CiPublishGate {
  let binding: JiraRepoBinding | null = null;
  try {
    binding = load(projectRoot).binding;
  } catch {
    return { mode: 'direct' };
  }
  return resolveCiPublishGate(binding, { cwd: projectRoot, ...ctx });
}

