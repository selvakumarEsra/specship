/**
 * SpecShip Installer.
 *
 * Writes the specship MCP server config + auto-allow permissions into
 * Claude Code at the chosen location (global / local). Uses
 * @clack/prompts for the interactive UI; `runInstallerWithOptions` is
 * the non-interactive entry called from the `--target` / `--yes` CLI
 * flags. `--target` SELECTS the agents to wire (`claude` — the default —
 * and/or `gemini`, GEMINI-TARGET-DOC); the legacy `auto` / `all` / `none`
 * spellings keep their old Claude-only meanings.
 */

import { execSync, execFileSync, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { claudeTarget, statusLineState, getStatusLineSnippet } from './targets/claude';
import { ALL_TARGETS, getTarget, listTargetIds } from './targets/registry';
import type { AgentTarget, Location, TargetId } from './targets/types';
import { detectInstallMethod } from '../update/updater';
import { planPurge, executePurge, assertSafeToRemove, type PurgeEnv, type PurgeExecDeps } from './purge';
import { getGlyphs } from '../ui/glyphs';
// Lightweight (fs/path only) — safe for the installer's no-native-modules rule.
import { enableGateChecks } from '../enforce/enforce';
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
   * Which agent target(s) to wire (GEMINI-TARGET-DOC, REQ-GEMINI-002).
   * Comma-separated registry ids — `claude`, `gemini`, or `claude,gemini`.
   * The legacy values still mean exactly what they meant when this build was
   * Claude-only: absent / `claude` / `auto` / `all` ⇒ Claude alone (so no
   * existing invocation starts writing a Gemini config), `none` ⇒ skip.
   * Anything else throws.
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
   * Integrations opt-in (INTEG-TIER-DOC): enable the tool groups that talk to
   * external services. Off by default; a prior install's opt-in is preserved
   * on upgrade.
   */
  withJira?: boolean;
  withDesigner?: boolean;
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
 * Resolve the `--target` value into the targets to install
 * (REQ-GEMINI-002.A4). An empty result means "install nothing" (`none`).
 *
 * The legacy spellings are pinned to Claude on purpose: `all` reads like
 * "every registered target" but has always meant the single Claude install,
 * and quietly widening it would start writing a Gemini config for people who
 * never asked. Gemini is reachable only by naming it.
 */
export function resolveInstallTargets(target?: string): AgentTarget[] {
  if (target === 'none') return [];
  if (target === undefined || ['claude', 'auto', 'all'].includes(target)) {
    return [claudeTarget];
  }
  const ids = target.split(',').map((s) => s.trim()).filter(Boolean);
  const resolved = ids.map((id) => {
    const found = getTarget(id);
    if (!found) {
      throw new Error(
        `Unknown --target value "${id}". Accepted values are ` +
        `${listTargetIds().map((t) => `'${t}'`).join(', ')}, ` +
        `'auto'/'all' (= claude), or 'none'.`,
      );
    }
    return found;
  });
  // De-dupe so `--target claude,claude` doesn't install twice.
  return [...new Map(resolved.map((t) => [t.id, t])).values()];
}

/** Primary config path per target, for the location prompt's hint line. */
function describeFirstPaths(targets: readonly AgentTarget[], loc: Location): string {
  return targets
    .map((t) => t.describePaths(loc)[0])
    .filter((p): p is string => typeof p === 'string')
    .map(tildify)
    .join(' + ');
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

  // Which agents to wire. `--target=none` is an explicit skip (historical
  // contract); an unknown id throws.
  const selectedTargets = resolveInstallTargets(opts.target);
  if (selectedTargets.length === 0) {
    clack.outro('Skipped — no agent configured.');
    return;
  }
  // Everything Claude-shaped below (permissions, status line) is skipped when
  // Claude isn't selected — those prompts have no meaning for another agent.
  const installClaude = selectedTargets.some((t) => t.id === 'claude');

  // Step 1 (INSTALL-SCOPE-DOC, REQ-SCOPE-001): `specship install` is
  // WIRING-ONLY — binary acquisition (npm i -g, or the offline bundle's
  // install.sh) is a separate, prior step, and by definition the binary
  // already exists when this runs. We never invoke a package manager here
  // (offline machines have no npm; a bundle install must not be hijacked
  // onto the npm method). The one thing worth checking is read-only: the
  // MCP entry launches `specship` BY NAME, so warn if PATH can't resolve it.
  try {
    const probe = process.platform === 'win32' ? 'where specship' : 'command -v specship';
    execSync(probe, { stdio: 'pipe', windowsHide: true, shell: process.platform === 'win32' ? undefined : '/bin/sh' });
  } catch {
    clack.log.warn(
      'The `specship` command is not on your PATH — Claude Code launches `specship serve --mcp` by name, ' +
      'so the wiring below will not work until it is. Install the CLI first:\n' +
      '    npm i -g @specship/specship          (online)\n' +
      '    ./install.sh from the release bundle (offline — puts it on PATH)\n' +
      'Continuing with the wiring anyway.',
    );
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
    const agents = selectedTargets.map((t) => t.displayName).join(' / ');
    const sel = await clack.select({
      message: `Apply ${agents} config to just this project, or all of them?`,
      options: installClaude
        ? [
          { value: 'local'  as const, label: 'Just this project (recommended)', hint: './.mcp.json + ./.claude/settings.json' },
          { value: 'global' as const, label: 'All projects', hint: '~/.claude.json + ~/.claude/settings.json' },
        ]
        : [
          { value: 'local'  as const, label: 'Just this project (recommended)', hint: describeFirstPaths(selectedTargets, 'local') },
          { value: 'global' as const, label: 'All projects', hint: describeFirstPaths(selectedTargets, 'global') },
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
  } else if (!installClaude) {
    // Permissions are a Claude surface — don't ask about them when the user
    // only selected another agent.
    autoAllow = false;
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
  } else if (!useDefaults && installClaude) {
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
  for (const target of selectedTargets) {
    const result = target.install(location, {
      autoAllow,
      sdd: opts.sdd,
      withJira: opts.withJira,
      withDesigner: opts.withDesigner,
      installStatusLine,
    });
    for (const file of result.files) {
      const verb = file.action === 'unchanged'
        ? 'Unchanged'
        : file.action === 'created' ? 'Created'
          : file.action === 'removed' ? 'Removed'
            : 'Updated';
      clack.log.success(`${target.displayName}: ${verb} ${tildify(file.path)}`);
    }
    // A target with unsupported surfaces says so here (REQ-GEMINI-006.A1) —
    // the note is the only place the capability gap is stated at install time.
    for (const note of result.notes ?? []) {
      clack.log.info(`${target.displayName}: ${note}`);
    }
  }

  // Step 4b: the gate graduation ramp's install ask (REQ-ENFORCE-004.A3).
  // A user choosing --sdd has opted into spec-driven rigor, so gating the
  // drift + behaviour checks is offered once, recommended on. Local installs
  // only — the config is per-project (specship.config.json at the project
  // root); a global install gets the one-liner instead. `--yes` keeps the
  // advisory-only default (same posture as the status-line prompt).
  if (opts.sdd !== false) {
    if (location === 'local' && !useDefaults) {
      const gate = await clack.confirm({
        message: 'Gate `specship check` on drift & behaviour? (recommended — declining keeps every check advisory)',
        initialValue: true,
      });
      if (clack.isCancel(gate)) {
        clack.cancel('Installation cancelled.');
        process.exit(0);
      }
      if (gate) {
        const enabled = enableGateChecks(process.cwd(), ['drift', 'behaviour']);
        if (enabled.length) {
          clack.log.success(`Gating enabled for ${enabled.join(', ')} (specship.config.json)`);
        } else {
          clack.log.info('Gating for drift & behaviour was already enabled.');
        }
      } else {
        clack.log.info('Advisory-only. Enable later with: specship check --enable-gate drift behaviour');
      }
    } else if (location === 'global') {
      clack.note('specship check --enable-gate drift behaviour', 'Per-project: turn the gate on');
    }
  }

  // Step 5: for local install, initialize the project.
  if (location === 'local') {
    await initializeLocalProject(clack, useDefaults);
  }

  if (location === 'global') {
    clack.note('cd your-project\nspecship init -i', 'Quick start');
  }

  // Step 6: offer integration setup for whatever was just enabled
  // (INSTALL-INTEG-SETUP-DOC). Interactive-only; --yes plans nothing.
  await runEnabledIntegrationSetup(clack, {
    withJira: opts.withJira,
    withDesigner: opts.withDesigner,
    useDefaults,
  });

  clack.outro(
    `Done! Restart ${selectedTargets.map((t) => t.displayName).join(' / ')} to use SpecShip.`,
  );
}

/**
 * Build + run the post-install integration-setup plan (INSTALL-INTEG-SETUP-DOC).
 * The planner decides what to offer; the runner prompts + spawns. Both are
 * best-effort — nothing here fails the install.
 */
async function runEnabledIntegrationSetup(
  clack: Awaited<ReturnType<typeof importESM>>,
  input: { withJira?: boolean; withDesigner?: boolean; useDefaults: boolean },
): Promise<void> {
  if (!input.withJira && !input.withDesigner) return;
  const {
    planIntegrationSetup,
    runIntegrationSetup,
    commandOnPath,
  } = await import('./integration-setup');

  const jiraConfigured = (): boolean => {
    try {
      // Any resolvable base URL (env or ~/.specship/jira.json) counts as
      // configured; resolveJiraCredentials throws when nothing is set.
      const { resolveJiraCredentials } = require('../jira/config') as typeof import('../jira/config');
      resolveJiraCredentials();
      return true;
    } catch {
      return false;
    }
  };

  const plan = planIntegrationSetup(input, { jiraConfigured, commandOnPath });

  const spawnSetup = (command: string, args: string[]): Promise<number> =>
    new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'inherit' });
      child.on('error', () => resolve(127));
      child.on('exit', (code) => resolve(code ?? 1));
    });

  await runIntegrationSetup(plan, clack as unknown as import('./integration-setup').SetupClack, spawnSetup);
}

export interface RunUninstallerOptions {
  /**
   * Vestigial — preserved for backwards compatibility. Accepts `claude`
   * / `auto` / `all` / `none`. Anything else throws.
   */
  target?: string;
  /** Only meaningful with `keepData`: which wiring location to sweep. */
  location?: Location;
  /** Non-interactive: skip the confirmation prompt. */
  yes?: boolean;
  /**
   * Escape hatch (REQ-UNINSTALL-003): perform ONLY the original wiring-only
   * uninstall — remove the Claude Code config, keep the index, `~/.specship`,
   * and the binary. No confirmation, no data loss.
   */
  keepData?: boolean;
  /**
   * Purge environment (from the CLI, which knows the running binary's dir).
   * Omitted → derived from `os.homedir()` + the `SPECSHIP_*` env with the
   * installer module's own `__dirname` as the method-detection anchor.
   */
  purgeEnv?: PurgeEnv;
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
 * Uninstaller entry. By default a COMPLETE removal (UNINSTALL-PURGE-DOC): the
 * Claude Code wiring at both locations, the current project's `.specship/`
 * index, the user-level `~/.specship/` data, and the binary itself. The
 * `--keep-data` escape hatch runs the original wiring-only behavior instead.
 */
export async function runUninstaller(opts: RunUninstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');
  clack.intro(`SpecShip v${getVersion()} — uninstall`);

  if (opts.target === 'none') {
    clack.outro('Skipped — nothing to uninstall.');
    return;
  }
  // Same resolution as install, so `--target gemini` sweeps the Gemini wiring
  // instead of being rejected. A full purge ignores this and removes every
  // registered target's wiring — "complete removal" means complete.
  const selectedTargets = resolveInstallTargets(opts.target);

  if (opts.keepData) {
    await wiringOnlyUninstall(clack, opts, selectedTargets);
    return;
  }
  await purgeUninstall(clack, opts);
}

/**
 * REQ-UNINSTALL-003 — the original behavior: strip only the agent wiring
 * (Claude Code unless `--target` says otherwise) at the chosen location,
 * leaving the index, `~/.specship`, and the binary.
 */
async function wiringOnlyUninstall(
  clack: typeof import('@clack/prompts'),
  opts: RunUninstallerOptions,
  targets: readonly AgentTarget[],
): Promise<void> {
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (opts.yes === true) {
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

  const reports = uninstallTargets(targets, location);
  for (const report of reports) {
    const name = report.displayName;
    if (report.status === 'removed') {
      for (const p of report.removedPaths) clack.log.success(`${name}: removed ${tildify(p)}`);
    } else if (report.status === 'not-configured') {
      clack.log.info(`${name}: not configured — nothing to remove`);
    } else {
      clack.log.info(`${name}: skipped — ${report.notes[0] ?? 'unsupported location'}`);
    }
  }
  const removedAny = reports.some((r) => r.status === 'removed');
  const agents = targets.map((t) => t.displayName).join(' / ');

  if (location === 'local' && fs.existsSync(path.join(process.cwd(), '.specship'))) {
    clack.log.info('The .specship/ index for this project is still here. Run `specship uninit` to delete it.');
  }
  clack.log.info('Kept your data and the specship binary (--keep-data). Run `specship uninstall` (no flag) for a complete removal.');

  if (removedAny) {
    clack.outro(`Removed SpecShip from ${agents}. Restart it to apply.`);
  } else {
    clack.outro(`SpecShip was not configured in ${agents} at the ${location} location — nothing to remove.`);
  }
}

/**
 * REQ-UNINSTALL-001/002 — complete removal: the Claude Code wiring at BOTH
 * locations, the current project's index, the user-level `~/.specship`, and the
 * binary (by detected install method). Gated by a confirmation that lists
 * exactly what will be deleted; `--yes` skips the prompt.
 */
async function purgeUninstall(
  clack: typeof import('@clack/prompts'),
  opts: RunUninstallerOptions,
): Promise<void> {
  const env = opts.purgeEnv ?? deriveDefaultPurgeEnv();
  const plan = planPurge(env);

  const targets: string[] = [
    'Claude Code wiring (global + this project)',
    `This project's index — ${tildify(plan.projectIndex)}`,
    ...plan.dataDirs.map((d) => `User data & config (incl. JIRA credentials) — ${tildify(d)}`),
  ];
  if (plan.symlink) targets.push(`PATH symlink — ${tildify(plan.symlink)}`);
  if (plan.npmRemove) targets.push('The specship program — `npm rm -g @specship/specship`');
  if (plan.method === 'unknown') targets.push('The specship program — manual (install method unknown)');

  clack.log.warn(
    'This permanently removes EVERYTHING SpecShip:\n' +
    targets.map((t) => `  • ${t}`).join('\n') +
    "\n  (Other projects' .specship/ indexes are NOT auto-removed — no registry exists.)",
  );

  if (opts.yes !== true) {
    const proceed = await clack.confirm({ message: 'Remove SpecShip completely?', initialValue: false });
    if (clack.isCancel(proceed) || proceed !== true) {
      clack.cancel('Uninstall cancelled — nothing was removed.');
      return;
    }
  }

  // 1. Every registered target's wiring at BOTH locations — a purge that left
  //    a Gemini MCP entry behind wouldn't be a complete removal.
  for (const location of ['global', 'local'] as Location[]) {
    for (const report of uninstallTargets(ALL_TARGETS, location)) {
      if (report.status === 'removed') {
        for (const p of report.removedPaths) {
          clack.log.success(`${report.displayName} (${location}): removed ${tildify(p)}`);
        }
      }
    }
  }

  // 2. Index + user data + binary. Self-affecting removals run LAST inside
  //    executePurge, so nothing loads a new module after the code is gone.
  const result = executePurge(plan, productionPurgeDeps(clack, env.homedir));
  for (const note of result.notes) clack.log.warn(note);

  clack.outro('SpecShip completely removed. Restart Claude Code to apply.');
}

/** Derive the purge env when the CLI didn't pass one (back-compat / tests). */
function deriveDefaultPurgeEnv(): PurgeEnv {
  const installDir = process.env.SPECSHIP_INSTALL_DIR || path.join(os.homedir(), '.specship');
  const binDir = process.env.SPECSHIP_BIN_DIR || path.join(os.homedir(), '.local', 'bin');
  return {
    cwd: process.cwd(),
    homedir: os.homedir(),
    installDir,
    binDir,
    method: detectInstallMethod(__dirname, installDir),
  };
}

/** Production filesystem/spawn deps for `executePurge`, guarded against unsafe paths. */
function productionPurgeDeps(
  clack: typeof import('@clack/prompts'),
  homedir: string,
): PurgeExecDeps {
  return {
    rmDir: (p) => {
      assertSafeToRemove(p, homedir);
      if (!fs.existsSync(p)) return false;
      fs.rmSync(p, { recursive: true, force: true });
      return true;
    },
    rmFile: (p) => {
      try { fs.lstatSync(p); } catch { return false; } // lstat: a broken symlink is still removable
      fs.rmSync(p, { force: true });
      return true;
    },
    runNpmRemove: () => {
      try {
        execFileSync('npm', ['rm', '-g', '@specship/specship'], { stdio: 'ignore' });
        return { ok: true, detail: 'removed @specship/specship (npm global)' };
      } catch (err) {
        return {
          ok: false,
          detail:
            'could not run `npm rm -g @specship/specship` automatically — run it ' +
            `yourself to remove the binary. (${err instanceof Error ? err.message : String(err)})`,
        };
      }
    },
    log: (msg) => clack.log.success(msg),
  };
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
