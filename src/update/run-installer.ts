/**
 * The real installer adapter for `specship update` (REQ-CLI-UPDATE-002).
 *
 * `installerCommand` is pure (built + tested here); `runInstaller` is the thin
 * spawn wrapper the CLI drives. A non-zero exit rejects, which `runUpdate`
 * surfaces as a clean failure that leaves the existing install intact
 * (REQ-CLI-UPDATE-004.A2).
 */
import { spawn } from 'node:child_process';
import type { InstallMethod } from './updater';
import { BUNDLE_INSTALL_CMD } from './updater';

export interface InstallerEnv {
  installDir: string;
  binDir: string;
}

export interface InstallerCommand {
  command: string;
  args: string[];
  extraEnv: Record<string, string>;
}

export function installerCommand(method: InstallMethod, env: InstallerEnv): InstallerCommand {
  if (method === 'npm') {
    return { command: 'npm', args: ['i', '-g', '@specship/specship@latest'], extraEnv: {} };
  }
  // bundle: re-run install.sh, threading the existing install/bin dirs through
  // so the update lands exactly where the original install did.
  return {
    command: 'sh',
    args: ['-c', BUNDLE_INSTALL_CMD],
    extraEnv: { SPECSHIP_INSTALL_DIR: env.installDir, SPECSHIP_BIN_DIR: env.binDir },
  };
}

export function runInstaller(method: InstallMethod, env: InstallerEnv): Promise<void> {
  const { command, args, extraEnv } = installerCommand(method, env);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${method} updater exited with code ${code ?? 'null'}`));
    });
  });
}
