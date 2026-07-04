#!/usr/bin/env node
/**
 * Compile the HTTP server (`packages/server/src/**`) into the root's
 * `dist/server/` so it ships as part of the single npm tarball.
 *
 * Why this lives at root scope: the publish pipeline (build-bundle.sh →
 * pack-npm.sh) copies the root `dist/` + the root `package.json` into each
 * per-platform tarball. Anything below `dist/server/` rides along; anything
 * NOT below `dist/` is invisible to the published artifact. Shipping the
 * server as its own package would mean a second release flow — this avoids
 * it.
 *
 * Runs `tsc` against `packages/server/tsconfig.json` with `--outDir` pointed
 * at the root's `dist/server/`. The server's own `npm run build` is left
 * untouched so the workspace dev path keeps working.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const serverPkg = path.resolve(root, 'packages', 'server');
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

// Copy the SSR dashboard's server-local assets that tsc does NOT emit: the
// `.mjs` render modules (plain JS emitting HTML strings — intentionally not
// tsc-compiled, keeping the dashboard dependency-free per REQ-DASHLEAN-002)
// and the static assets (CSS + island JS) served by the SSR routes.
const ssrSrc = path.join(serverPkg, 'src', 'ssr');
const ssrOut = path.join(outDir, 'ssr');
if (existsSync(ssrSrc)) {
  for (const f of ['render.mjs', 'md.mjs', 'design.mjs']) {
    const from = path.join(ssrSrc, f);
    if (existsSync(from)) cpSync(from, path.join(ssrOut, f));
  }
  for (const dir of ['public', 'templates']) {
    const from = path.join(ssrSrc, dir);
    if (existsSync(from)) cpSync(from, path.join(ssrOut, dir), { recursive: true });
  }
  console.log('[build-server-bundle] copied SSR render modules + assets → dist/server/ssr/');
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
