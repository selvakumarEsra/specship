/**
 * Install-time defaults for the questions `specship install` no longer asks
 * (SLIM-DOC, REQ-SLIM-003).
 *
 * An interactive install asks exactly one question — where to write the config.
 * The status line, the auto-allow permission list and the initial index all
 * have a sensible default, so they are applied without prompting and NAMED in
 * the closing summary together with the flag that opts out (REQ-SLIM-003.A2) —
 * nothing may happen invisibly.
 *
 * Pure on purpose: the policy is unit-tested here, independently of clack and
 * of a TTY.
 */

/** What the install actually did about the status line. */
export type StatusLineOutcome =
  /** SpecShip's segment was written. */
  | 'added'
  /** The user already had a status line; it was left untouched (REQ-SLIM-003.A4). */
  | 'kept-existing'
  /** Not installed — `--skip-statusline`, or a target with no status line. */
  | 'skipped';

/** What the install actually did about the project index. */
export type IndexOutcome =
  /** The project was indexed. */
  | 'indexed'
  /** No index was built (`--skip-index`, already indexed, or not a project). */
  | 'skipped';

export interface InstallDefaultsSummaryInput {
  statusLine: StatusLineOutcome;
  /** False when `--statusline` / `--skip-statusline` decided it — not a default. */
  statusLineDefaulted: boolean;
  index: IndexOutcome;
  /** False when `--skip-index` decided it — not a default. */
  indexDefaulted: boolean;
  /** Whether the auto-allow permission list was written. */
  autoAllow: boolean;
  /** False when `--no-permissions` / `--yes` decided it — not a default. */
  autoAllowDefaulted: boolean;
}

/**
 * Resolve the status-line default (REQ-SLIM-003.A1): ON unless a flag said
 * otherwise, and never for a target that has no status line. Default-ON is safe
 * because the never-overwrite guarantee lives one layer down in
 * `writeStatusLineEntry`, which returns `kept` for a status line the user owns
 * (REQ-SLIM-003.A4) — this function does not need to know about it.
 *
 * `--yes` gets the same default as an interactive run: the default IS the
 * default, and `--skip-statusline` is the opt-out for automation.
 */
export function resolveStatusLine(flag: boolean | undefined, installClaude: boolean): boolean {
  if (!installClaude) return false;
  return flag ?? true;
}

/**
 * Resolve the auto-allow default: ON unless `--no-permissions` (or an explicit
 * caller value) said otherwise, and never for a non-Claude target.
 */
export function resolveAutoAllow(flag: boolean | undefined, installClaude: boolean): boolean {
  if (!installClaude) return false;
  return flag ?? true;
}

/**
 * The closing summary lines (REQ-SLIM-003.A2). One line per decision that was
 * both DEFAULTED and observable, each naming its opt-out flag. A decision the
 * user made explicitly with a flag is not echoed — they already know.
 */
export function describeInstallDefaults(input: InstallDefaultsSummaryInput): string[] {
  const lines: string[] = [];

  if (input.statusLineDefaulted) {
    if (input.statusLine === 'added') {
      lines.push('status line: added — skip next time with --skip-statusline');
    } else if (input.statusLine === 'kept-existing') {
      lines.push(
        'status line: you already had one — left untouched, SpecShip\'s segment was not added ' +
        '(--skip-statusline stops the attempt entirely)',
      );
    }
  }

  if (input.autoAllowDefaulted && input.autoAllow) {
    lines.push('auto-allow permissions: written — skip next time with --no-permissions');
  }

  if (input.indexDefaulted && input.index === 'indexed') {
    lines.push('initial indexing: this project was indexed — skip next time with --skip-index');
  }

  return lines;
}
