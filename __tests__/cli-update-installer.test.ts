/**
 * Tests for the installer command builder (REQ-CLI-UPDATE-002.A1/A2). The
 * builder is pure — the actual spawn is a thin wrapper the CLI drives — so we
 * assert the command + the env it threads through, not a real install.
 */
import { describe, it, expect } from 'vitest';
import { installerCommand } from '../src/update/run-installer';

describe('installerCommand', () => {
  it('A2: npm method runs the global npm upgrade of @specship/specship', () => {
    const c = installerCommand('npm', { installDir: '/x', binDir: '/y' });
    expect(c.command).toBe('npm');
    expect(c.args).toEqual(['i', '-g', '@specship/specship@latest']);
  });

  it('A1: bundle method re-runs install.sh honoring the existing install + bin dirs', () => {
    const c = installerCommand('bundle', { installDir: '/home/u/.specship', binDir: '/home/u/.local/bin' });
    expect(c.command).toBe('sh');
    expect(c.args.join(' ')).toContain('install.sh');
    expect(c.extraEnv.SPECSHIP_INSTALL_DIR).toBe('/home/u/.specship');
    expect(c.extraEnv.SPECSHIP_BIN_DIR).toBe('/home/u/.local/bin');
  });
});
