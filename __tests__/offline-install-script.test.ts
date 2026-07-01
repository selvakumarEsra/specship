/**
 * Repurposed offline installer — REQ-OFFLINE-003.
 *
 * `scripts/offline-install.sh` must no longer build from source. It consumes a
 * PRE-BUILT self-contained bundle (an extracted specship-<target>/ directory or
 * a specship-<target>.tar.gz / .zip archive) and delegates to the installer
 * baked inside it — so it runs on a host with no npm and no compiler.
 *
 * Tests are deterministic and never touch the network:
 *   - A2: the script invokes no npm (ci/install/link/build) or compiler.
 *   - A1: installing from a pre-built bundle (dir AND archive) puts specship
 *     on PATH without npm/compile.
 *   - A3: `--undo` removes the PATH symlink, using no npm.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

const REPO = path.resolve(__dirname, '..');
const OFFLINE_INSTALL = path.join(REPO, 'scripts', 'offline-install.sh');
const OFFLINE_INSTALL_PS1 = path.join(REPO, 'scripts', 'offline-install.ps1');
const BUNDLE_INSTALLER = path.join(REPO, 'scripts', 'bundle-install.sh');

function stripComments(sh: string): string {
  return sh
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/** Same stub bundle shape used by the bundle-installer tests. */
function makeStubBundle(dir: string): void {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib', 'dist', 'bin'), { recursive: true });

  const stubNode = `#!/bin/sh
[ "$1" = "--liftoff-only" ] && shift
shift
case "\${1:-}" in
  --version) echo "9.9.9-test"; exit 0 ;;
  install)   echo "claude wired (stub)"; exit 0 ;;
  *)         echo "stub specship: $*"; exit 0 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'node'), stubNode, { mode: 0o755 });

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

  fs.copyFileSync(BUNDLE_INSTALLER, path.join(dir, 'install.sh'));
  fs.chmodSync(path.join(dir, 'install.sh'), 0o755);
}

describe('REQ-OFFLINE-003 — offline-install.sh consumes a pre-built bundle, never compiles', () => {
  // REQ-OFFLINE-003.A2: "no longer contains npm ci / install / link / build".
  const NPM_INVOCATIONS = /npm\s+(ci|install|link|run\s+build)\b/;

  it('invokes no npm (ci/install/link/build) and no compiler (A2)', () => {
    const body = fs.readFileSync(OFFLINE_INSTALL, 'utf8');
    expect(body).not.toMatch(NPM_INVOCATIONS);
    expect(stripComments(body)).not.toMatch(/\b(tsc|node-gyp|gcc|g\+\+|make|cc)\b/);
  });

  it('the PowerShell variant also invokes no npm (A2)', () => {
    const body = fs.readFileSync(OFFLINE_INSTALL_PS1, 'utf8');
    expect(body).not.toMatch(NPM_INVOCATIONS);
  });
});

describe('REQ-OFFLINE-003 — installing from a pre-built bundle (no npm/compile/network)', () => {
  let work: string;
  let bundleDir: string;
  let installDir: string;
  let binDir: string;

  function runOffline(args: string[]): string {
    return execFileSync('/bin/bash', [OFFLINE_INSTALL, ...args], {
      env: {
        ...process.env,
        SPECSHIP_INSTALL_DIR: installDir,
        SPECSHIP_BIN_DIR: binDir,
      },
      encoding: 'utf8',
    });
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-offscript-'));
    bundleDir = path.join(work, 'specship-darwin-arm64');
    installDir = path.join(work, '.specship');
    binDir = path.join(work, '.local', 'bin');
    makeStubBundle(bundleDir);
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('installs from an extracted bundle directory (A1)', () => {
    runOffline([bundleDir, '--skip-claude']);
    const link = path.join(binDir, 'specship');
    expect(fs.existsSync(link)).toBe(true);
    const version = execFileSync('/bin/sh', [link, '--version'], { encoding: 'utf8' });
    expect(version.trim()).toBe('9.9.9-test');
  });

  it('installs from a .tar.gz archive (A1)', () => {
    const archive = path.join(work, 'specship-darwin-arm64.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', work, 'specship-darwin-arm64']);
    fs.rmSync(bundleDir, { recursive: true, force: true }); // only the archive remains

    runOffline([archive, '--skip-claude']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(true);
  });

  it('--undo reverses the install with no npm (A3)', () => {
    runOffline([bundleDir, '--skip-claude']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(true);

    runOffline(['--undo']);
    expect(fs.existsSync(path.join(binDir, 'specship'))).toBe(false);
    expect(fs.existsSync(installDir)).toBe(false);
  });
});
