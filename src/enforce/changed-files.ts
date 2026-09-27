/**
 * Change scoping for the enforcement gate (REQ-AUTHG-006).
 *
 * `specship check --since <ref>` needs the set of files a working tree has
 * touched since a git ref, so the drift and behaviour checks can evaluate only
 * the requirements that change reaches. Gating all 60+ requirement docs in a
 * repo makes the gate unusable as a pre-commit check; per-ID excludes were the
 * only escape.
 *
 * The ref is validated before anything else runs: an unknown ref throws
 * (REQ-AUTHG-006.A3) rather than silently degrading to a full-repo run, which
 * would report findings the caller never asked about and quietly hide the typo.
 */

import { execFileSync } from 'child_process';
import { normalizePath } from './enforce';

/** Thrown when `<ref>` is not a commit-ish this repository knows. */
export class InvalidRefError extends Error {
  constructor(ref: string, detail?: string) {
    super(
      `not a git ref in this repository: ${ref}` +
        (detail ? ` (${detail})` : '') +
        '. Pass a branch, tag or commit `specship check --since` can resolve.',
    );
    this.name = 'InvalidRefError';
  }
}

function git(projectRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Files changed since `ref`: committed changes, uncommitted working-tree
 * changes, and untracked files. Untracked files count because a newly authored
 * spec (or a brand-new source file) is exactly the change a scoped run must
 * see.
 *
 * Throws `InvalidRefError` when `ref` does not resolve, or a plain Error when
 * the directory is not a git repository.
 */
export function changedFilesSince(projectRoot: string, ref: string): string[] {
  try {
    git(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  } catch (err) {
    throw new Error(
      `not a git repository: ${projectRoot} — \`--since\` needs git to compute changed files`,
    );
  }
  try {
    git(projectRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch (err) {
    throw new InvalidRefError(ref, err instanceof Error ? err.message.trim().split('\n')[0] : undefined);
  }

  const out = new Set<string>();
  const collect = (raw: string): void => {
    for (const line of raw.split('\n')) {
      const f = normalizePath(line.trim());
      if (f) out.add(f);
    }
  };
  collect(git(projectRoot, ['diff', '--name-only', ref, '--']));
  collect(git(projectRoot, ['ls-files', '--others', '--exclude-standard']));
  return [...out].sort();
}
