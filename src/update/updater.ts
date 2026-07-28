/**
 * `specship update` core — self-update to the latest release (CLI-UPDATE-DOC).
 *
 * The orchestrator (`runUpdate`) is pure and dependency-injected: it takes the
 * current version, an install-method detector, a latest-version resolver, and
 * an installer runner, and returns a structured result. It never calls
 * process.exit, never touches the network, and never spawns — the CLI command
 * (`src/bin/specship.ts`) wires the real deps, prints `result.lines`, and exits
 * with `result.exitCode`. This keeps every acceptance criterion unit-testable
 * without mutating the machine's real install.
 */
import path from 'node:path';
import os from 'node:os';

/**
 * Resolve the bundle install dir the CLI uses to classify a running binary
 * (`~/.specship`, overridable via `SPECSHIP_INSTALL_DIR`). Extracted so
 * `specship_version` and the update command feed `detectInstallMethod` from
 * one place.
 */
export function resolveInstallDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPECSHIP_INSTALL_DIR || path.join(os.homedir(), '.specship');
}

export type InstallMethod = 'bundle' | 'npm' | 'unknown';

/** Exit code from `--check` when a newer version is available (distinct from
 *  the `1` used for real errors, so scripts/hooks can gate on it). */
export const CHECK_UPDATE_AVAILABLE = 10;

/** The manual fallbacks we point users at when we can't self-update. */
export const BUNDLE_INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/selvakumarEsra/specship/main/install.sh | sh';
export const NPM_INSTALL_CMD = 'npm i -g @specship/specship@latest';

export interface UpdateDeps {
  /** The version currently running (package.json version). */
  currentVersion: string;
  /** Determine how this binary was installed. */
  detect: () => InstallMethod;
  /** Resolve the latest published version for a method. Throws when the
   *  release source is unreachable. */
  resolveLatest: (method: InstallMethod) => Promise<string>;
  /** Perform the real update for a method. Throws when the underlying updater
   *  (bundle installer / npm) exits non-zero. */
  runInstaller: (method: InstallMethod) => Promise<void>;
  /** Bundle install dir (for messages). */
  installDir: string;
  /** Bundle symlink dir (for messages). */
  binDir: string;
}

export interface UpdateOptions {
  /** Read-only: report status, install nothing. */
  check?: boolean;
}

export interface UpdateResult {
  exitCode: number;
  method: InstallMethod;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  /** True only when the installer actually ran and succeeded. */
  changed: boolean;
  /** Human-facing output lines; the CLI prints these. */
  lines: string[];
}

/**
 * Which install channel produced the running binary, decided from the
 * directory the running `specship.js` lives in.
 *
 * - under the bundle install dir (default `~/.specship`) → 'bundle'
 * - under a `node_modules` tree                          → 'npm'
 * - neither                                              → 'unknown' (we refuse to guess)
 */
export function detectInstallMethod(binDirname: string, installDir: string): InstallMethod {
  const dir = path.resolve(binDirname);
  const root = path.resolve(installDir);
  if (dir === root || dir.startsWith(root + path.sep)) return 'bundle';
  if (dir.split(path.sep).includes('node_modules')) return 'npm';
  return 'unknown';
}

/** Numeric, per-segment version compare (not lexical). Tolerates a leading `v`. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/** True when `latest` is strictly newer than `current`. */
export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0;
}

export async function runUpdate(deps: UpdateDeps, opts: UpdateOptions = {}): Promise<UpdateResult> {
  const { currentVersion } = deps;
  const method = deps.detect();

  // Refuse to guess when we can't tell how it was installed (REQ-CLI-UPDATE-002.A3).
  if (method === 'unknown') {
    return {
      exitCode: 1,
      method,
      currentVersion,
      changed: false,
      lines: [
        "Couldn't determine how SpecShip was installed, so it can't self-update.",
        'Update manually with whichever you used:',
        `  bundle (install.sh): ${BUNDLE_INSTALL_CMD}`,
        `  npm:                 ${NPM_INSTALL_CMD}`,
      ],
    };
  }

  // Resolve the latest version; an unreachable source is a clean failure
  // that must not touch the existing install (REQ-CLI-UPDATE-004.A1).
  let latestVersion: string;
  try {
    latestVersion = await deps.resolveLatest(method);
  } catch (err) {
    return {
      exitCode: 1,
      method,
      currentVersion,
      changed: false,
      lines: [`Could not reach the release source to check for updates: ${errMsg(err)}`],
    };
  }

  const updateAvailable = isUpdateAvailable(currentVersion, latestVersion);

  // --check: read-only report, never installs (REQ-CLI-UPDATE-003).
  if (opts.check) {
    const lines = [
      `Current: ${currentVersion}`,
      `Latest:  ${latestVersion}`,
      updateAvailable
        ? `Update available → run \`specship update\` to install ${latestVersion}.`
        : 'You are on the latest version.',
    ];
    return {
      exitCode: updateAvailable ? CHECK_UPDATE_AVAILABLE : 0,
      method,
      currentVersion,
      latestVersion,
      updateAvailable,
      changed: false,
      lines,
    };
  }

  // Already current → no-op (REQ-CLI-UPDATE-001.A2).
  if (!updateAvailable) {
    return {
      exitCode: 0,
      method,
      currentVersion,
      latestVersion,
      updateAvailable: false,
      changed: false,
      lines: [`Already up to date (${currentVersion}).`],
    };
  }

  // Perform the update; a failing installer surfaces + leaves the install
  // intact (REQ-CLI-UPDATE-004.A2).
  try {
    await deps.runInstaller(method);
  } catch (err) {
    return {
      exitCode: 1,
      method,
      currentVersion,
      latestVersion,
      updateAvailable: true,
      changed: false,
      lines: [`Update failed: ${errMsg(err)}`, 'Your existing install is unchanged.'],
    };
  }

  // Success → report old → new + remind to restart (REQ-CLI-UPDATE-001.A1, 005.A1).
  return {
    exitCode: 0,
    method,
    currentVersion,
    latestVersion,
    updateAvailable: true,
    changed: true,
    lines: [
      `Updated ${currentVersion} → ${latestVersion}.`,
      'Restart any running `specship serve` / Claude Code MCP session to pick up the new version.',
    ],
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
