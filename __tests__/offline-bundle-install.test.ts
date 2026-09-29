/**
 * Offline / air-gapped bundle installer — REQ-OFFLINE-001.
 *
 * The release bundle (compiled app, produced by scripts/build-bundle.sh) must
 * be *self-installing offline*: an installer baked into the archive that puts
 * the launcher on PATH using only files already in the bundle plus the
 * machine's own Node — no npm, no compiler, no network.
 *
 * These tests are deterministic and never touch the network:
 *   - A3: build-bundle.sh stages the installer into the archive.
 *   - A2: the bundle installer invokes no npm / compiler / network command.
 *   - A1/A4: running the installer against a STUB bundle (the real launcher +
 *     a stub `node` on PATH) symlinks the launcher onto PATH, `specship` runs,
 *     re-running is idempotent, and `--uninstall` reverses it.
 *   - REQ-OFFLINE-006: the launcher/installer resolve Node from PATH and
 *     refuse to install when it is missing or out of range.
 *
 * HOME / install + bin dirs are redirected to tmpdirs; no real ~/.specship or
 * ~/.local/bin is ever touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

const REPO = path.resolve(__dirname, '..');
const BUNDLE_INSTALLER = path.join(REPO, 'scripts', 'bundle-install.sh');
const BUILD_BUNDLE = path.join(REPO, 'scripts', 'build-bundle.sh');

/** Drop full-line shell comments so token checks test real commands, not prose. */
function stripComments(sh: string): string {
  return sh
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('REQ-OFFLINE-001 — build-bundle stages a self-installing offline installer', () => {
  it('build-bundle.sh stages install.sh (unix) and install.ps1 (win32) into the archive (A3)', () => {
    const src = fs.readFileSync(BUILD_BUNDLE, 'utf8');
    // The unix bundle gets a bundle-local install.sh at its root.
    expect(src).toMatch(/install\.sh/);
    expect(src).toMatch(/bundle-install\.sh/);
    // The Windows bundle gets a bundle-local install.ps1 at its root.
    expect(src).toMatch(/install\.ps1/);
    expect(src).toMatch(/bundle-install\.ps1/);
  });

  it('the bundle installer invokes no npm, compiler, or network command (A2)', () => {
    const body = stripComments(fs.readFileSync(BUNDLE_INSTALLER, 'utf8'));
    expect(body).not.toMatch(/\bnpm\b/);
    expect(body).not.toMatch(/\b(tsc|node-gyp|gcc|g\+\+|make|cc)\b/);
    expect(body).not.toMatch(/\b(curl|wget)\b/);
  });
});

/**
 * The bundle's real unix launcher, lifted verbatim out of the `LAUNCH`
 * heredoc in scripts/build-bundle.sh — so these tests exercise the shipped
 * launcher (PATH resolution + version gate) rather than a copy that can drift.
 */
function realLauncher(): string {
  const src = fs.readFileSync(BUILD_BUNDLE, 'utf8');
  const start = src.indexOf("<<'LAUNCH'\n");
  const end = src.indexOf('\nLAUNCH\n', start);
  if (start < 0 || end < 0) throw new Error('launcher heredoc not found in build-bundle.sh');
  return src.slice(start + "<<'LAUNCH'\n".length, end + 1);
}

/**
 * A stub `node` for PATH. It reports `version` to `-v`, and otherwise drops
 * `--liftoff-only` plus the script path and answers as the CLI would — so
 * `specship --version` works end-to-end without a real Node runtime.
 */
function writeNodeShim(dir: string, version: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const shim = `#!/bin/sh
[ "$1" = "-v" ] && { echo "${version}"; exit 0; }
[ "$1" = "--liftoff-only" ] && shift
shift   # the .js path
case "\${1:-}" in
  --version) echo "9.9.9-test"; exit 0 ;;
  install)   echo "claude wired (stub)"; exit 0 ;;
  *)         echo "stub specship: $*"; exit 0 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'node'), shim, { mode: 0o755 });
  return dir;
}

/**
 * Build a fake extracted bundle: the real launcher, a stub compiled app, and a
 * copy of the bundle installer as `install.sh`. No `node` binary is staged —
 * bundles ship none (REQ-OFFLINE-006).
 */
function makeStubBundle(dir: string): void {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib', 'dist', 'bin'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'bin', 'specship'), realLauncher(), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'lib', 'dist', 'bin', 'specship.js'), '// stub\n');

  // The installer under test, placed where build-bundle.sh would put it.
  fs.copyFileSync(BUNDLE_INSTALLER, path.join(dir, 'install.sh'));
  fs.chmodSync(path.join(dir, 'install.sh'), 0o755);
}

describe('REQ-OFFLINE-001 — installing from an extracted bundle (no npm/compile/network)', () => {
  let work: string;
  let bundle: string;
  let installDir: string;
  let binDir: string;
  let shimPath: string;

  function runInstaller(args: string[]): string {
    return execFileSync('/bin/sh', [path.join(bundle, 'install.sh'), ...args], {
      env: {
        ...process.env,
        PATH: shimPath,
        SPECSHIP_INSTALL_DIR: installDir,
        SPECSHIP_BIN_DIR: binDir,
      },
      encoding: 'utf8',
    });
  }

  function runLauncher(link: string): string {
    return execFileSync('/bin/sh', [link, '--version'], {
      env: { ...process.env, PATH: shimPath },
      encoding: 'utf8',
    });
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-offline-'));
    bundle = path.join(work, 'specship-darwin-arm64');
    installDir = path.join(work, '.specship');
    binDir = path.join(work, '.local', 'bin');
    // A supported Node (24.x) on PATH — the bundle ships none.
    shimPath = `${writeNodeShim(path.join(work, 'shim'), 'v24.16.0')}:/usr/bin:/bin`;
    makeStubBundle(bundle);
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('symlinks the launcher onto PATH and `specship --version` runs (A1)', () => {
    runInstaller(['--skip-claude']);

    const link = path.join(binDir, 'specship');
    expect(fs.existsSync(link)).toBe(true);
    expect(runLauncher(link).trim()).toBe('9.9.9-test');
  });

  it('re-running the installer is idempotent (A4)', () => {
    runInstaller(['--skip-claude']);
    // A second run must not error and must leave a working symlink.
    expect(() => runInstaller(['--skip-claude'])).not.toThrow();

    expect(runLauncher(path.join(binDir, 'specship')).trim()).toBe('9.9.9-test');
  });

  it('--uninstall removes the install dir and the PATH symlink (A4)', () => {
    runInstaller(['--skip-claude']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(true);

    runInstaller(['--uninstall']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(false);
    expect(fs.existsSync(installDir)).toBe(false);
  });

  // REQ-OFFLINE-002 — Claude wiring via the machine's Node, with an opt-out.
  // The stub `node` prints "claude wired (stub)" when invoked with `install`,
  // so its presence in the output proves the resolved Node ran the wiring.
  it('a default install wires Claude Code via the resolved Node (REQ-OFFLINE-002 A1/A3)', () => {
    const out = runInstaller([]);
    expect(out).toMatch(/claude wired \(stub\)/);
  });

  it('--skip-claude installs onto PATH but does not wire Claude Code (REQ-OFFLINE-002 A2)', () => {
    const out = runInstaller(['--skip-claude']);
    expect(out).not.toMatch(/claude wired \(stub\)/);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(true);
  });

  // REQ-OFFLINE-006.A2 — the launcher runs the app through the PATH node,
  // with `--liftoff-only` on node's own command line.
  it('the launcher execs the on-PATH node with --liftoff-only (REQ-OFFLINE-006 A2)', () => {
    const log = path.join(work, 'argv.log');
    const recorder = path.join(work, 'recorder');
    fs.mkdirSync(recorder, { recursive: true });
    fs.writeFileSync(
      path.join(recorder, 'node'),
      `#!/bin/sh\n[ "$1" = "-v" ] && { echo "v24.16.0"; exit 0; }\necho "$@" >> "${log}"\nexit 0\n`,
      { mode: 0o755 },
    );
    runInstaller(['--skip-claude']);

    execFileSync('/bin/sh', [path.join(binDir, 'specship'), '--version'], {
      env: { ...process.env, PATH: `${recorder}:/usr/bin:/bin` },
      encoding: 'utf8',
    });

    const argv = fs.readFileSync(log, 'utf8').trim();
    expect(argv).toMatch(/^--liftoff-only /);
    expect(argv).toMatch(/lib\/dist\/bin\/specship\.js --version$/);
  });
});

/**
 * REQ-OFFLINE-006 — no runtime is vendored, so a missing or out-of-range Node
 * must fail loudly and leave the machine untouched (A3/A4).
 */
describe('REQ-OFFLINE-006 — the installer gates on the machine Node', () => {
  let work: string;
  let bundle: string;
  let installDir: string;
  let binDir: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-offline-node-'));
    bundle = path.join(work, 'specship-darwin-arm64');
    installDir = path.join(work, '.specship');
    binDir = path.join(work, '.local', 'bin');
    makeStubBundle(bundle);
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  /** Run install.sh with the given PATH; returns exit status + stderr. */
  function runWithPath(searchPath: string): { status: number; stderr: string } {
    try {
      execFileSync('/bin/sh', [path.join(bundle, 'install.sh')], {
        env: {
          ...process.env,
          HOME: work,
          PATH: searchPath,
          SPECSHIP_INSTALL_DIR: installDir,
          SPECSHIP_BIN_DIR: binDir,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stderr: '' };
    } catch (err: any) {
      return { status: err.status ?? -1, stderr: String(err.stderr ?? '') };
    }
  }

  function expectRefused(stderr: string): void {
    expect(stderr).toMatch(/22\.5/);
    expect(stderr).toMatch(/25/);
    expect(stderr).toMatch(/https:\/\/nodejs\.org/);
    // No install, no PATH symlink, no Claude Code wiring (A3).
    expect(fs.existsSync(installDir)).toBe(false);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(false);
    expect(fs.existsSync(path.join(work, '.claude.json'))).toBe(false);
    expect(fs.existsSync(path.join(work, '.mcp.json'))).toBe(false);
  }

  // Guarded: a machine with node in /usr/bin or /bin has no "node-free" PATH.
  const noSystemNode = !fs.existsSync('/usr/bin/node') && !fs.existsSync('/bin/node');

  it.runIf(noSystemNode)('refuses to install when no node is on PATH (A3)', () => {
    const { status, stderr } = runWithPath('/usr/bin:/bin');
    expect(status).not.toBe(0);
    expectRefused(stderr);
  });

  it('refuses to install against Node 20.x (A4)', () => {
    const shim = writeNodeShim(path.join(work, 'shim20'), 'v20.19.0');
    const { status, stderr } = runWithPath(`${shim}:/usr/bin:/bin`);
    expect(status).not.toBe(0);
    expectRefused(stderr);
  });

  it('refuses to install against Node 25.x (A4)', () => {
    const shim = writeNodeShim(path.join(work, 'shim25'), 'v25.0.0');
    const { status, stderr } = runWithPath(`${shim}:/usr/bin:/bin`);
    expect(status).not.toBe(0);
    expectRefused(stderr);
  });
});
