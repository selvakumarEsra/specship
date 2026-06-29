/**
 * Install-time "index the current project?" decision (REQ-HANDSHAKE-004).
 *
 * `specship install` run inside an un-indexed git repo offers to build that
 * project's index in the same breath, so the user's first project is activated
 * without a separate, forgettable `init` step. It never silently auto-indexes,
 * and it never offers a re-index for an already-indexed project.
 */

export type InstallInitDecision =
  /** Do nothing (already indexed, not a project, or an explicit opt-out). */
  | 'skip'
  /** Ask the user interactively whether to build the index. */
  | 'offer'
  /** Build the index without prompting (the non-interactive `--yes` default). */
  | 'auto-index';

export interface InstallInitContext {
  /** Is the install running inside a git repository? */
  isGitRepo: boolean;
  /** Does the project already have a `.specship/` index? */
  isInitialized: boolean;
  /** Was `--yes` (non-interactive) passed? */
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
  // Only offer inside an actual project.
  if (!ctx.isGitRepo) return 'skip';
  // Inside an un-indexed git repo: index by default under --yes (activation is
  // the priority), otherwise ask.
  return ctx.yes ? 'auto-index' : 'offer';
}
