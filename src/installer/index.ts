/**
 * SpecShip Installer (Claude Code only).
 *
 * Writes the specship MCP server config + auto-allow permissions into
 * Claude Code at the chosen location (global / local). Uses
 * @clack/prompts for the interactive UI; `runInstallerWithOptions` is
 * the non-interactive entry called from the `--target` / `--yes` CLI
 * flags. (The `--target` flag is preserved for backwards compatibility
 * but only accepts `claude` / `auto` / `all` / `none`.)
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { claudeTarget, statusLineState, getStatusLineSnippet } from './targets/claude';
import type { AgentTarget, Location, TargetId } from './targets/types';
import { getGlyphs } from '../ui/glyphs';
// Import the lightweight submodules directly (not the ../sync barrel, which
// re-exports FileWatcher and would transitively pull in ../extraction — the
// installer must stay importable even when native modules can't load).
import { watchDisabledReason } from '../sync/watch-policy';
import { isGitRepo, isSyncHookInstalled, installGitSyncHook } from '../sync/git-hooks';

// Backwards-compat: keep these named exports — downstream code may
// import them. The shim in `config-writer.ts` continues to re-export
// them too.
export {
  writeMcpConfig,
  writePermissions,
  hasMcpConfig,
  hasPermissions,
} from './config-writer';
export type { InstallLocation } from './config-writer';

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

export interface RunInstallerOptions {
  /**
   * Vestigial — preserved for backwards compatibility with the
   * multi-agent CLI. Accepted values: `claude` (the only real target),
   * `auto` / `all` (synonymous), `none` (skip). Anything else throws.
   */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Skip the auto-allow prompt; use this value directly. */
  autoAllow?: boolean;
  /**
   * Governance tier — spec/authoring/review/design commands + the SDD steering
   * (CLAUDE.md rule + nudge hook). Opt-in (INSTALL-WEDGE-DOC): pass `true` (the
   * `--sdd` flag) to install it. Undefined/false ⇒ retrieval-only.
   */
  sdd?: boolean;
  /**
   * Wire SpecShip's status-line segment into Claude's status line
   * (SHIP-STATUSLINE-DOC). Opt-in: undefined ⇒ ask interactively (default no);
   * `true` (the `--statusline` flag) installs without asking; `false` skips.
   * Never overwrites a status line the user already configured.
   */
  statusLine?: boolean;
  /**
   * Skip every confirm and use defaults: location=local,
   * autoAllow=true. For scripting / CI.
   */
  yes?: boolean;
}

/**
 * Interactive entry — `specship install` with no args runs this.
 */
export async function runInstaller(): Promise<void> {
  return runInstallerWithOptions({});
}

export async function runInstallerWithOptions(opts: RunInstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`SpecShip v${getVersion()}`);

  const useDefaults = opts.yes === true;

  // `--target=none` — explicit skip, matches the historical contract.
  if (opts.target === 'none') {
    clack.outro('Skipped — no agent configured.');
    return;
  }
  // Any other value is accepted (claude / auto / all / undefined); we
  // only have one target to write.
  if (opts.target !== undefined
      && !['claude', 'auto', 'all'].includes(opts.target)) {
    throw new Error(
      `Unknown --target value "${opts.target}". This build is Claude-only; ` +
      `accepted values are 'claude' (default), 'auto', 'all', or 'none'.`,
    );
  }

  // Step 1: install the specship CLI on PATH (always offered; skipped
  // with --yes since CI assumes it's there).
  if (!useDefaults) {
    const shouldInstallGlobally = await clack.confirm({
      message: 'Install the specship CLI on your PATH? (Required so Claude Code can launch the MCP server)',
      initialValue: true,
    });
    if (clack.isCancel(shouldInstallGlobally)) {
      clack.cancel('Installation cancelled.');
      process.exit(0);
    }
    if (shouldInstallGlobally) {
      const s = clack.spinner();
      s.start('Installing specship CLI...');
      try {
        execSync('npm install -g @specship/specship', { stdio: 'pipe', windowsHide: true });
        s.stop('Installed specship CLI on PATH');
      } catch {
        s.stop('Could not install (permission denied)');
        clack.log.warn('Try: sudo npm install -g @specship/specship');
      }
    } else {
      clack.log.info('Skipped CLI install — Claude Code will not be able to launch the MCP server without it');
    }
  }

  // Step 2: global vs local. Default is **local** so the SpecShip MCP
  // surface (tool list, server instructions) only appears in Claude
  // Code sessions opened against projects that have actually opted in.
  // Global is still supported via `--location global`; pick it when you
  // want the tools advertised in every project regardless.
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'local';
  } else {
    const sel = await clack.select({
      message: 'Apply Claude Code config to just this project, or all of them?',
      options: [
        { value: 'local'  as const, label: 'Just this project (recommended)', hint: './.mcp.json + ./.claude/settings.json' },
        { value: 'global' as const, label: 'All projects', hint: '~/.claude.json + ~/.claude/settings.json' },
      ],
      initialValue: 'local' as const,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('Installation cancelled.');
      process.exit(0);
    }
    location = sel;
  }

  // Step 3: auto-allow permissions.
  let autoAllow: boolean;
  if (opts.autoAllow !== undefined) {
    autoAllow = opts.autoAllow;
  } else if (useDefaults) {
    autoAllow = true;
  } else {
    const ans = await clack.confirm({
      message: 'Auto-allow SpecShip commands? (Skips permission prompts in Claude Code)',
      initialValue: true,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Installation cancelled.');
      process.exit(0);
    }
    autoAllow = ans;
  }

  // Step 3b: status-line segment (SHIP-STATUSLINE-DOC). Strictly opt-in. Only
  // offered when no status line is configured; if one already exists we never
  // touch it and instead show the composable snippet. `--statusline` /
  // `--no-statusline` skip the prompt; `--yes` leaves it off (opt-in default).
  let installStatusLine = false;
  if (opts.statusLine !== undefined) {
    installStatusLine = opts.statusLine;
  } else if (!useDefaults) {
    const state = statusLineState(location);
    if (state === 'foreign') {
      clack.note(getStatusLineSnippet(), 'You already have a status line — add SpecShip to it');
    } else {
      const ans = await clack.confirm({
        message: 'Add a SpecShip status-line segment? (shows index sync state, drift, and calls this session)',
        initialValue: false,
      });
      if (clack.isCancel(ans)) {
        clack.cancel('Installation cancelled.');
        process.exit(0);
      }
      installStatusLine = ans;
    }
  }

  // Step 4: write Claude config. The governance tier is opt-in
  // (INSTALL-WEDGE-DOC): only an explicit `sdd: true` (from `--sdd`) installs it;
  // a default install provisions the retrieval tier alone.
  const result = claudeTarget.install(location, { autoAllow, sdd: opts.sdd, installStatusLine });
  for (const file of result.files) {
    const verb = file.action === 'unchanged'
      ? 'Unchanged'
      : file.action === 'created' ? 'Created'
        : file.action === 'removed' ? 'Removed'
          : 'Updated';
    clack.log.success(`Claude Code: ${verb} ${tildify(file.path)}`);
  }
  for (const note of result.notes ?? []) {
    clack.log.info(`Claude Code: ${note}`);
  }

  // Step 5: for local install, initialize the project.
  if (location === 'local') {
    await initializeLocalProject(clack, useDefaults);
  }

  if (location === 'global') {
    clack.note('cd your-project\nspecship init -i', 'Quick start');
  }

  clack.outro('Done! Restart Claude Code to use SpecShip.');
}

export interface RunUninstallerOptions {
  /**
   * Vestigial — preserved for backwards compatibility. Accepts `claude`
   * / `auto` / `all` / `none`. Anything else throws.
   */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Non-interactive: location=local, no prompts. */
  yes?: boolean;
}

export type UninstallStatus = 'removed' | 'not-configured' | 'unsupported';

/**
 * Per-target outcome of an uninstall sweep. `removed` means we deleted
 * at least one thing; `not-configured` means there was no specship
 * config at this location (nothing to do); `unsupported` is dead in
 * the Claude-only build but kept for the test surface.
 */
export interface UninstallReport {
  id: TargetId;
  displayName: string;
  status: UninstallStatus;
  /** Absolute paths we actually edited/removed. */
  removedPaths: string[];
  /** Verbatim notes from the target (rare for uninstall). */
  notes: string[];
}

/**
 * Pure uninstall sweep — no prompts. Exposed (and unit-tested)
 * separately from the clack UI so the aggregation logic can be
 * asserted directly. Safe to call when nothing was installed (target
 * uninstall returns `not-found` actions).
 */
export function uninstallTargets(
  targets: readonly AgentTarget[],
  location: Location,
): UninstallReport[] {
  return targets.map((target) => {
    if (!target.supportsLocation(location)) {
      const only: Location = location === 'local' ? 'global' : 'local';
      return {
        id: target.id,
        displayName: target.displayName,
        status: 'unsupported' as const,
        removedPaths: [],
        notes: [`no ${location} config — this agent is ${only}-only`],
      };
    }
    const result = target.uninstall(location);
    const removedPaths = result.files
      .filter((f) => f.action === 'removed')
      .map((f) => f.path);
    return {
      id: target.id,
      displayName: target.displayName,
      status: removedPaths.length > 0 ? ('removed' as const) : ('not-configured' as const),
      removedPaths,
      notes: result.notes ?? [],
    };
  });
}

/**
 * Interactive uninstaller — the inverse of `runInstallerWithOptions`.
 * Asks global-vs-local, then sweeps Claude Code's config at that
 * location. Removes only what install wrote (MCP server entry,
 * permissions) — never the `.specship/` index, which `specship
 * uninit` owns.
 */
export async function runUninstaller(opts: RunUninstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`SpecShip v${getVersion()} — uninstall`);

  const useDefaults = opts.yes === true;

  if (opts.target === 'none') {
    clack.outro('Skipped — nothing to uninstall.');
    return;
  }
  if (opts.target !== undefined
      && !['claude', 'auto', 'all'].includes(opts.target)) {
    throw new Error(
      `Unknown --target value "${opts.target}". This build is Claude-only; ` +
      `accepted values are 'claude' (default), 'auto', 'all', or 'none'.`,
    );
  }

  // Step 1: location. Default tracks install (now local), so a user
  // who ran `specship install --yes` and `specship uninstall --yes`
  // touches the same files on both sides.
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'local';
  } else {
    const sel = await clack.select({
      message: 'Remove SpecShip from just this project, or all of them?',
      options: [
        { value: 'local'  as const, label: 'Just this project (local)', hint: './.mcp.json + ./.claude/settings.json' },
        { value: 'global' as const, label: 'All projects (global)', hint: '~/.claude.json + ~/.claude/settings.json' },
      ],
      initialValue: 'local' as const,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('Uninstall cancelled.');
      process.exit(0);
    }
    location = sel;
  }

  // Step 2: sweep + feedback. uninstallTargets always returns one
  // report per input target — the non-null assertion is safe.
  const report = uninstallTargets([claudeTarget], location)[0]!;
  if (report.status === 'removed') {
    for (const p of report.removedPaths) {
      clack.log.success(`Claude Code: removed ${tildify(p)}`);
    }
  } else if (report.status === 'not-configured') {
    clack.log.info(`Claude Code: not configured — nothing to remove`);
  } else {
    clack.log.info(`Claude Code: skipped — ${report.notes[0] ?? 'unsupported location'}`);
  }

  // Step 3: for local uninstall, the index dir is separate.
  if (location === 'local' && fs.existsSync(path.join(process.cwd(), '.specship'))) {
    clack.log.info('The .specship/ index for this project is still here. Run `specship uninit` to delete it.');
  }

  // Step 4: summary.
  if (report.status === 'removed') {
    clack.outro('Removed SpecShip from Claude Code. Restart it to apply.');
  } else {
    clack.outro(`SpecShip was not configured in Claude Code at the ${location} location — nothing to remove.`);
  }
}

/**
 * Replace home-directory prefix in a path with `~/` for cleaner log
 * lines. Pure cosmetic.
 */
function tildify(p: string): string {
  const home = require('os').homedir();
  if (p.startsWith(home + path.sep)) return '~' + p.substring(home.length);
  return p;
}

/**
 * Initialize SpecShip in the current project (for local installs), then
 * offer the watch fallback when the live watcher won't run here (see
 * offerWatchFallback).
 */
async function initializeLocalProject(
  clack: typeof import('@clack/prompts'),
  useDefaults = false,
): Promise<void> {
  const projectPath = process.cwd();

  let SpecShip: typeof import('../index').default;
  try {
    SpecShip = (await import('../index')).default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.error(`Could not load native modules: ${msg}`);
    clack.log.info('Skipping project initialization. Run "specship init -i" later.');
    return;
  }

  // Check if already initialized
  if (SpecShip.isInitialized(projectPath)) {
    clack.log.info('SpecShip already initialized in this project');
    await offerWatchFallback(clack, projectPath, { yes: useDefaults });
    return;
  }

  // Initialize
  const cg = await SpecShip.init(projectPath);
  clack.log.success('Created .specship/ directory');

  // Index the project with shimmer progress (worker thread for smooth animation)
  const { createShimmerProgress } = await import('../ui/shimmer-progress');
  process.stdout.write(`\x1b[2m${getGlyphs().rail}\x1b[0m\n`);
  const progress = createShimmerProgress();

  const result = await cg.indexAll({
    onProgress: progress.onProgress,
  });

  await progress.stop();

  if (result.filesErrored > 0) {
    clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} failed, ${formatNumber(result.nodesCreated)} symbols)`);
  } else {
    clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.nodesCreated)} symbols)`);
  }

  cg.close();

  await offerWatchFallback(clack, projectPath, { yes: useDefaults });
}

/**
 * When the live file watcher will be disabled for this project (e.g. WSL2
 * /mnt drives, or SPECSHIP_NO_WATCH), the index would silently go stale.
 * Offer to keep it fresh automatically via git hooks instead of manual
 * `specship sync`. No-op on environments where the watcher runs normally.
 */
export async function offerWatchFallback(
  clack: typeof import('@clack/prompts'),
  projectPath: string,
  opts: { yes?: boolean } = {},
): Promise<void> {
  const reason = watchDisabledReason(projectPath);
  if (!reason) return; // Watcher runs normally — nothing to set up.

  clack.log.warn(`Live file watching is disabled here — ${reason}.`);
  clack.log.info('Until you re-sync, the SpecShip index stays frozen — it will not pick up edits on its own.');

  // No git repo → the commit-hook path doesn't apply; point at manual sync.
  if (!isGitRepo(projectPath)) {
    clack.log.info('Run `specship sync` after changing files to refresh the index.');
    return;
  }

  // Already wired up on a previous run — confirm and move on without nagging.
  if (isSyncHookInstalled(projectPath)) {
    clack.log.info('Git sync hooks are already installed — the index refreshes after commit / pull / checkout.');
    return;
  }

  let choice: 'hook' | 'manual';
  if (opts.yes) {
    choice = 'hook';
  } else {
    const sel = await clack.select({
      message: 'How should SpecShip keep its index fresh?',
      options: [
        { value: 'hook' as const, label: 'Sync on git commit / pull / checkout', hint: 'installs git hooks (recommended)' },
        { value: 'manual' as const, label: 'I\'ll run `specship sync` myself', hint: 'fully manual' },
      ],
      initialValue: 'hook' as const,
    });
    if (clack.isCancel(sel)) {
      clack.log.info('Skipped — run `specship sync` after changes to refresh the index.');
      return;
    }
    choice = sel;
  }

  if (choice === 'manual') {
    clack.log.info('Run `specship sync` after changing files to refresh the index.');
    return;
  }

  const result = installGitSyncHook(projectPath);
  if (result.installed.length > 0) {
    clack.log.success(
      `Installed git ${result.installed.join(', ')} hook${result.installed.length > 1 ? 's' : ''} — ` +
      'the index refreshes in the background after each.',
    );
    clack.log.info('Run `specship sync` anytime to refresh immediately.');
  } else {
    clack.log.warn(
      `Could not install git hooks${result.skipped ? ` (${result.skipped})` : ''}. ` +
      'Run `specship sync` after changes instead.',
    );
  }
}
