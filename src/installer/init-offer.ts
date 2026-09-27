/**
 * Install-time "index the current project?" decision (REQ-HANDSHAKE-004,
 * REQ-SLIM-003).
 *
 * `specship install` run inside an un-indexed git repo builds that project's
 * index in the same breath, so the user's first project is activated without a
 * separate, forgettable `init` step. It no longer ASKS (REQ-SLIM-003.A1):
 * indexing is the default, `--skip-index` is the opt-out, and the install
 * summary names both (REQ-SLIM-003.A2). It never re-indexes an already-indexed
 * project.
 */

export type InstallInitDecision =
  /** Do nothing (already indexed, not a project, or an explicit opt-out). */
  | 'skip'
  /** Build the index without prompting (the default in every mode). */
  | 'auto-index';

export interface InstallInitContext {
  /** Is the install running inside a git repository? */
  isGitRepo: boolean;
  /** Does the project already have a `.specship/` index? */
  isInitialized: boolean;
  /**
   * Was `--yes` (non-interactive) passed? No longer changes the outcome —
   * indexing is the default in both modes — but kept so callers and the
   * historical contract stay readable.
   */
  yes: boolean;
  /** Was `--skip-index` passed? */
  skipIndex: boolean;
}

/**
 * Decide whether install should index the current project. Pure so the policy
 * is unit-tested independently of the prompt + indexing glue.
 */
export function decideInstallInit(ctx: InstallInitContext): InstallInitDecision {
  // An explicit opt-out wins in any mode — "do not index" means don't even ask.
  if (ctx.skipIndex) return 'skip';
  // Already activated: refreshing is `sync`/`index`'s job, not the install prompt.
  if (ctx.isInitialized) return 'skip';
  // Only act inside an actual project.
  if (!ctx.isGitRepo) return 'skip';
  // Inside an un-indexed git repo: index. Activation is the priority, and an
  // unindexed install is a broken install — so this is the default in every
  // mode rather than a question (REQ-SLIM-003.A1).
  return 'auto-index';
}
