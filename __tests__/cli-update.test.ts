/**
 * Unit tests for `specship update` (CLI-UPDATE-DOC).
 *
 * The core (`runUpdate`) is pure + dependency-injected: it takes the current
 * version, an install-method detector, a latest-version resolver, and an
 * installer runner, and returns a structured result ({ exitCode, lines, ... }).
 * No process.exit, no network, no spawning here — the CLI command wires the
 * real deps and prints/exits from the returned result. That keeps every
 * acceptance criterion testable without touching the machine's real install.
 */
import { describe, it, expect } from 'vitest';
import {
  detectInstallMethod,
  compareVersions,
  isUpdateAvailable,
  runUpdate,
  type UpdateDeps,
} from '../src/update/updater';

// A baseline set of deps a test can override field-by-field.
function deps(over: Partial<UpdateDeps> = {}): UpdateDeps {
  return {
    currentVersion: '0.11.6',
    detect: () => 'bundle',
    resolveLatest: async () => '0.11.8',
    runInstaller: async () => {},
    installDir: '/home/u/.specship',
    binDir: '/home/u/.local/bin',
    ...over,
  };
}

describe('detectInstallMethod (REQ-CLI-UPDATE-002)', () => {
  it('detects a bundle install when the binary lives under the install dir', () => {
    expect(detectInstallMethod('/home/u/.specship/0.11.6/dist/bin', '/home/u/.specship')).toBe('bundle');
  });

  it('detects an npm install when the binary lives under node_modules', () => {
    expect(
      detectInstallMethod('/usr/local/lib/node_modules/@specship/specship/dist/bin', '/home/u/.specship'),
    ).toBe('npm');
  });

  it('returns unknown when it matches neither', () => {
    expect(detectInstallMethod('/opt/somewhere/dist/bin', '/home/u/.specship')).toBe('unknown');
  });
});

describe('version comparison', () => {
  it('orders versions numerically per segment, not lexically', () => {
    expect(compareVersions('0.11.8', '0.11.6')).toBe(1);
    expect(compareVersions('0.9.0', '0.11.0')).toBe(-1); // not string-compare
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('tolerates a leading v', () => {
    expect(compareVersions('v0.11.8', '0.11.8')).toBe(0);
  });

  it('isUpdateAvailable is true only when latest is strictly newer', () => {
    expect(isUpdateAvailable('0.11.6', '0.11.8')).toBe(true);
    expect(isUpdateAvailable('0.11.8', '0.11.8')).toBe(false);
    expect(isUpdateAvailable('0.11.9', '0.11.8')).toBe(false);
  });
});

describe('runUpdate — perform (REQ-CLI-UPDATE-001)', () => {
  it('A1: updates an out-of-date install and reports old → new', async () => {
    let ran = 0;
    const r = await runUpdate(deps({ currentVersion: '0.11.6', resolveLatest: async () => '0.11.8', runInstaller: async () => { ran++; } }));
    expect(ran).toBe(1);
    expect(r.changed).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n')).toMatch(/0\.11\.6.*0\.11\.8/s);
  });

  it('A2: no-ops when already on the latest version, exit 0, no reinstall', async () => {
    let ran = 0;
    const r = await runUpdate(deps({ currentVersion: '0.11.8', resolveLatest: async () => '0.11.8', runInstaller: async () => { ran++; } }));
    expect(ran).toBe(0);
    expect(r.changed).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n').toLowerCase()).toContain('up to date');
  });
});

describe('runUpdate — install-method routing (REQ-CLI-UPDATE-002)', () => {
  it('A1/A2: passes the detected method through to the installer', async () => {
    const seen: string[] = [];
    await runUpdate(deps({ detect: () => 'bundle', runInstaller: async (m) => { seen.push(m); } }));
    await runUpdate(deps({ detect: () => 'npm', runInstaller: async (m) => { seen.push(m); } }));
    expect(seen).toEqual(['bundle', 'npm']);
  });

  it('A3: unknown install method exits non-zero and prints both manual commands', async () => {
    let ran = 0;
    const r = await runUpdate(deps({ detect: () => 'unknown', runInstaller: async () => { ran++; } }));
    expect(ran).toBe(0);
    expect(r.exitCode).not.toBe(0);
    const out = r.lines.join('\n');
    expect(out).toContain('install.sh');                       // bundle path
    expect(out).toContain('npm i -g @specship/specship@latest'); // npm path
  });
});

describe('runUpdate — --check (REQ-CLI-UPDATE-003)', () => {
  it('A1/A2: reports current+latest and does NOT run the installer', async () => {
    let ran = 0;
    const r = await runUpdate(
      deps({ currentVersion: '0.11.6', resolveLatest: async () => '0.11.8', runInstaller: async () => { ran++; } }),
      { check: true },
    );
    expect(ran).toBe(0);
    expect(r.changed).toBe(false);
    const out = r.lines.join('\n');
    expect(out).toContain('0.11.6');
    expect(out).toContain('0.11.8');
  });

  it('A3: exits 0 when up to date, 10 when an update is available', async () => {
    const upToDate = await runUpdate(deps({ currentVersion: '0.11.8', resolveLatest: async () => '0.11.8' }), { check: true });
    expect(upToDate.exitCode).toBe(0);

    const available = await runUpdate(deps({ currentVersion: '0.11.6', resolveLatest: async () => '0.11.8' }), { check: true });
    expect(available.exitCode).toBe(10);
  });
});

describe('runUpdate — failure handling (REQ-CLI-UPDATE-004)', () => {
  it('A1: an unreachable latest-version source errors non-zero and does not install', async () => {
    let ran = 0;
    const r = await runUpdate(deps({
      resolveLatest: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
      runInstaller: async () => { ran++; },
    }));
    expect(ran).toBe(0);
    expect(r.changed).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n').toLowerCase()).toMatch(/could not|unreachable|failed/);
  });

  it('A2: a failing installer surfaces the failure and exits non-zero', async () => {
    const r = await runUpdate(deps({
      currentVersion: '0.11.6',
      resolveLatest: async () => '0.11.8',
      runInstaller: async () => { throw new Error('installer exited 1'); },
    }));
    expect(r.changed).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n').toLowerCase()).toContain('fail');
  });
});

describe('runUpdate — restart reminder (REQ-CLI-UPDATE-005)', () => {
  it('A1: a successful update reminds the user to restart running sessions', async () => {
    const r = await runUpdate(deps({ currentVersion: '0.11.6', resolveLatest: async () => '0.11.8' }));
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n').toLowerCase()).toContain('restart');
  });
});
