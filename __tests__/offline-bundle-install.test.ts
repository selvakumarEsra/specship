/**
 * Offline / air-gapped bundle installer — REQ-OFFLINE-001.
 *
 * The self-contained release bundle (vendored Node + compiled app, produced by
 * scripts/build-bundle.sh) must be *self-installing offline*: an installer
 * baked into the archive that puts the launcher on PATH using only files
 * already in the bundle — no npm, no compiler, no network.
 *
 * These tests are deterministic and never touch the network:
 *   - A3: build-bundle.sh stages the installer into the archive.
 *   - A2: the bundle installer invokes no npm / compiler / network command.
 *   - A1/A4: running the installer against a STUB bundle (a fake `node` +
 *     the real launcher) symlinks the launcher onto PATH, `specship` runs,
 *     re-running is idempotent, and `--uninstall` reverses it.
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
 * Build a fake extracted bundle: a stub `node`, the real launcher, and a copy
 * of the bundle installer as `install.sh`. The stub node answers `--version`
 * so `specship --version` works end-to-end through the symlink without a real
 * Node runtime.
 */
function makeStubBundle(dir: string): void {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib', 'dist', 'bin'), { recursive: true });

  // Stub `node`: drop `--liftoff-only` and the script path, then handle args.
  const stubNode = `#!/bin/sh
[ "$1" = "--liftoff-only" ] && shift
shift   # the .js path
case "\${1:-}" in
  --version) echo "9.9.9-test"; exit 0 ;;
  install)   echo "claude wired (stub)"; exit 0 ;;
  *)         echo "stub specship: $*"; exit 0 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'node'), stubNode, { mode: 0o755 });

  // The real launcher (mirrors scripts/build-bundle.sh): resolves symlinks,
  // then execs the vendored node by relative path.
  const launcher = `#!/bin/sh
SELF="$0"
while [ -L "$SELF" ]; do
  target="$(readlink "$SELF")"
  case "$target" in
    /*) SELF="$target" ;;
    *) SELF="$(dirname "$SELF")/$target" ;;
  esac
done
DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
exec "$DIR/node" --liftoff-only "$DIR/lib/dist/bin/specship.js" "$@"
`;
  fs.writeFileSync(path.join(dir, 'bin', 'specship'), launcher, { mode: 0o755 });
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

  function runInstaller(args: string[]): string {
    return execFileSync('/bin/sh', [path.join(bundle, 'install.sh'), ...args], {
      env: {
        ...process.env,
        SPECSHIP_INSTALL_DIR: installDir,
        SPECSHIP_BIN_DIR: binDir,
      },
      encoding: 'utf8',
    });
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-offline-'));
    bundle = path.join(work, 'specship-darwin-arm64');
    installDir = path.join(work, '.specship');
    binDir = path.join(work, '.local', 'bin');
    makeStubBundle(bundle);
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('symlinks the launcher onto PATH and `specship --version` runs (A1)', () => {
    runInstaller(['--skip-claude']);

    const link = path.join(binDir, 'specship');
    expect(fs.existsSync(link)).toBe(true);

    const version = execFileSync('/bin/sh', [link, '--version'], { encoding: 'utf8' });
    expect(version.trim()).toBe('9.9.9-test');
  });

  it('re-running the installer is idempotent (A4)', () => {
    runInstaller(['--skip-claude']);
    // A second run must not error and must leave a working symlink.
    expect(() => runInstaller(['--skip-claude'])).not.toThrow();

    const link = path.join(binDir, 'specship');
    const version = execFileSync('/bin/sh', [link, '--version'], { encoding: 'utf8' });
    expect(version.trim()).toBe('9.9.9-test');
  });

  it('--uninstall removes the install dir and the PATH symlink (A4)', () => {
    runInstaller(['--skip-claude']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(true);

    runInstaller(['--uninstall']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(false);
    expect(fs.existsSync(installDir)).toBe(false);
  });

  // REQ-OFFLINE-002 — Claude wiring via the vendored Node, with an opt-out.
  // The stub `node` prints "claude wired (stub)" when invoked with `install`,
  // so its presence in the output proves the bundled Node ran the wiring.
  it('a default install wires Claude Code via the vendored Node (REQ-OFFLINE-002 A1/A3)', () => {
    const out = runInstaller([]);
    expect(out).toMatch(/claude wired \(stub\)/);
  });

  it('--skip-claude installs onto PATH but does not wire Claude Code (REQ-OFFLINE-002 A2)', () => {
    const out = runInstaller(['--skip-claude']);
    expect(out).not.toMatch(/claude wired \(stub\)/);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(true);
  });
});
