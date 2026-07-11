#!/usr/bin/env node
/**
 * Compile the HTTP server (`server/src/**`) into the root's
 * `dist/server/` so it ships as part of the single npm tarball.
 *
 * Why this lives at root scope: the publish pipeline (build-bundle.sh →
 * pack-npm.sh) copies the root `dist/` + the root `package.json` into each
 * per-platform tarball. Anything below `dist/server/` rides along; anything
 * NOT below `dist/` is invisible to the published artifact. Shipping the
 * server as its own package would mean a second release flow — this avoids
 * it.
 *
 * Runs `tsc` against `server/tsconfig.json` with `--outDir` pointed
 * at the root's `dist/server/`. The server's own `npm run build` is left
 * untouched so the workspace dev path keeps working.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const serverPkg = path.resolve(root, 'server');
const serverTsconfig = path.join(serverPkg, 'tsconfig.json');
const outDir = path.join(root, 'dist', 'server');

if (!existsSync(serverTsconfig)) {
  console.error(`[build-server-bundle] expected ${serverTsconfig} but not found`);
  process.exit(1);
}

// Prefer the workspace's typescript install so the version is consistent.
const tscBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'tsc.cmd')
  : path.join(root, 'node_modules', '.bin', 'tsc');

if (!existsSync(tscBin)) {
  console.error(`[build-server-bundle] tsc not found at ${tscBin} — run npm install at the repo root first`);
  process.exit(1);
}

console.log(`[build-server-bundle] compiling ${path.relative(root, serverPkg)} → ${path.relative(root, outDir)}`);

// Use absolute path for --outDir so tsc resolves it the same regardless of cwd.
execFileSync(
  tscBin,
  ['-p', serverTsconfig, '--outDir', outDir, '--declaration', 'false', '--declarationMap', 'false', '--sourceMap', 'false'],
  { stdio: 'inherit', cwd: serverPkg },
);

// Ship the built desktop SPA (REQ-DESKTOP-017.A1 + BUNDLE-DASHBOARD-DOC,
// REQ-BUNDLE-WEB-001): copy ui/dist → dist/ui so the platform tarballs carry
// it and the server's resolveDefaultWebDir() finds it next to dist/server/.
//
// SELF-CONTAINED: this step BUILDS the SPA rather than copying whatever
// happens to be lying in ui/dist — a standalone `scripts/build-bundle.sh`
// run (offline bundles, local builds) used to silently ship a stale or
// missing dashboard because only the Release workflow's separate step built
// it. The ui/ module has its own lockfile: install its deps when the build
// tool is absent (A1), never reinstall when present (A3), always rebuild
// from current source on the default path (A4), and FAIL LOUDLY if no
// index.html exists afterward (A5) — a bundle without its dashboard must
// never ship quietly. `SPECSHIP_SKIP_WEB_BUILD=1` is the explicit opt-out
// (dev/CI paths that don't produce shippable artifacts).
const uiPkg = path.join(root, 'ui');
const uiDist = path.join(uiPkg, 'dist');
const uiOut = path.join(root, 'dist', 'ui');
if (process.env.SPECSHIP_SKIP_WEB_BUILD === '1') {
  console.warn('[build-server-bundle] SPECSHIP_SKIP_WEB_BUILD=1 — desktop SPA build skipped (dist/ui not refreshed)');
  if (existsSync(path.join(uiDist, 'index.html'))) {
    cpSync(uiDist, uiOut, { recursive: true });
    console.log('[build-server-bundle] copied EXISTING (possibly stale) ui/dist → dist/ui/');
  }
} else {
  const uiBuildTool = process.platform === 'win32'
    ? path.join(uiPkg, 'node_modules', '.bin', 'tsc.cmd')
    : path.join(uiPkg, 'node_modules', '.bin', 'tsc');
  if (!existsSync(uiBuildTool)) {
    console.log('[build-server-bundle] ui/ dependencies missing — npm ci (from ui/package-lock.json)');
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'inherit', cwd: uiPkg, shell: process.platform === 'win32' });
  }
  console.log('[build-server-bundle] building desktop SPA (ui/)');
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: uiPkg, shell: process.platform === 'win32' });
  if (!existsSync(path.join(uiDist, 'index.html'))) {
    console.error('[build-server-bundle] ui build produced no dist/index.html — refusing to ship a bundle without the dashboard');
    process.exit(1);
  }
  cpSync(uiDist, uiOut, { recursive: true });
  console.log('[build-server-bundle] built + copied desktop SPA → dist/ui/');
}

// Make the CLI executable (its shebang is preserved by tsc, but the file
// mode isn't automatic on POSIX).
import('node:fs').then((m) => {
  try { m.chmodSync(path.join(outDir, 'cli.js'), 0o755); } catch { /* ignore */ }
  // Drop a nested package.json so Node treats every .js file under
  // dist/server/ as ESM — the root package.json has no "type": "module",
  // so without this Node would parse these files as CommonJS and the
  // `import`/`import.meta.url` syntax would throw.
  try {
    m.writeFileSync(
      path.join(outDir, 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2) + '\n',
    );
  } catch (e) {
    console.error('[build-server-bundle] could not write dist/server/package.json:', e);
    process.exit(1);
  }
});

// Sanity: the entry points should exist.
for (const f of ['index.js', 'server.js', 'cli.js']) {
  const p = path.join(outDir, f);
  if (!existsSync(p) || !statSync(p).isFile()) {
    console.error(`[build-server-bundle] expected ${path.relative(root, p)} after compile`);
    process.exit(1);
  }
}

console.log(`[build-server-bundle] OK — dist/server/{index,server,cli}.js present`);
