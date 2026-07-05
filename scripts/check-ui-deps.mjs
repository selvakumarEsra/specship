#!/usr/bin/env node
/**
 * Build guard for the ui/ module (REQ-DESKTOP-017).
 *
 * Pre-build (default, no args — first step of `ui`'s npm run build):
 *   1. Runtime-dependency allowlist (A2/A5): ui/package.json `dependencies`
 *      must be EXACTLY react + react-dom. Anything else fails the build.
 *   2. Registry-safe lockfile (A3): every package in ui/package-lock.json
 *      resolves to a registry tarball on the single canonical registry —
 *      no git/tarball/http URLs. (npm substitutes the configured registry's
 *      host for registry.npmjs.org at install time, so an enterprise mirror
 *      replays the same lockfile without edits — the module installs from
 *      whatever ONE registry npm is pointed at, and nothing else.)
 *   3. No install-script network steps (A3): no lockfile entry may carry
 *      hasInstallScript, except allowlisted packages whose script provably
 *      needs no network (esbuild: its postinstall only relocates the binary
 *      already installed via its platform optionalDependencies).
 *
 * Post-build (`--dist <dir>` — last step of `ui`'s npm run build):
 *   4. Zero external origins (A4): scan every text asset in ui/dist for
 *      https?:// URLs pointing anywhere but loopback. Fonts/scripts/styles
 *      must be bundled, not CDN'd.
 *
 * Exported for __tests__/ui-build-guard.test.ts; runs as a CLI from the ui
 * build script.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_DEP_ALLOWLIST = ['react', 'react-dom'];

/**
 * Install scripts that are safe against a registry-only install.
 *   - esbuild: its postinstall copies the binary out of the
 *     @esbuild/<platform> package that npm already fetched from the registry
 *     (optionalDependencies) — it only falls back to a download when that
 *     package is missing, which a lockfile install never hits.
 *   - fsevents (optional, darwin-only, rollup watch): the lockfile flag is
 *     stale packument metadata — the published 2.3.x TARBALL ships a prebuilt
 *     fsevents.node and its package.json has no install script at all, so a
 *     clean install runs nothing and compiles nothing.
 */
export const INSTALL_SCRIPT_ALLOWLIST = ['esbuild', 'fsevents'];

/** A2/A5: runtime deps must be exactly the allowlist — no more, no less. */
export function assertRuntimeDepsAllowlist(pkgJsonPath, allowlist = RUNTIME_DEP_ALLOWLIST) {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {}).sort();
  const errors = [];
  for (const d of deps) {
    if (!allowlist.includes(d)) {
      errors.push(`runtime dependency "${d}" is not in the allowlist [${allowlist.join(', ')}]`);
    }
  }
  for (const want of allowlist) {
    if (!deps.includes(want)) errors.push(`expected runtime dependency "${want}" is missing`);
  }
  // Optional/bundled deps become runtime payload too — the SPA has no
  // platform-specific runtime, so any entry here is a smuggled dependency.
  for (const field of ['optionalDependencies', 'bundledDependencies', 'bundleDependencies']) {
    if (pkg[field] && Object.keys(pkg[field]).length) {
      errors.push(`"${field}" must be empty in ${path.basename(pkgJsonPath)}`);
    }
  }
  return errors;
}

/** A3: lockfile entries must all be registry tarballs with safe scripts. */
export function assertRegistryLockfile(lockPath, scriptAllowlist = INSTALL_SCRIPT_ALLOWLIST) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const errors = [];
  const packages = lock.packages ?? {};
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue; // the module itself
    const name = key.replace(/^.*node_modules\//, '');
    if (entry.link) {
      errors.push(`${name}: is a link:, not a registry package`);
      continue;
    }
    const resolved = entry.resolved ?? '';
    if (!/^https:\/\/registry\.npmjs\.org\//.test(resolved) || !resolved.endsWith('.tgz')) {
      errors.push(`${name}: resolved to "${resolved || '(none)'}" — not a canonical-registry tarball (git/tarball/http URLs break mirrored installs)`);
    }
    if (entry.hasInstallScript && !scriptAllowlist.includes(name)) {
      errors.push(`${name}: has an install script — a postinstall may reach outside the registry`);
    }
  }
  return errors;
}

const TEXT_ASSET_EXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.webmanifest', '.map']);

/**
 * Origins that may appear as STRINGS in a bundle without ever being fetched.
 * Everything here is inert at runtime:
 *   - w3.org: XML/SVG namespace identifiers (react-dom, inline SVG).
 *   - reactjs.org / react.dev: React's prod error-decoder links, embedded in
 *     thrown Error messages only.
 * Loopback hosts are also allowed — same-machine, not external.
 */
export const INERT_URL_HOSTS = ['www.w3.org', 'reactjs.org', 'react.dev'];

function isAllowedUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  return INERT_URL_HOSTS.includes(host);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** A4: no text asset in the built output may reference an external origin. */
export function assertNoExternalOrigins(distDir) {
  const errors = [];
  for (const file of walk(distDir)) {
    if (!TEXT_ASSET_EXT.has(path.extname(file).toLowerCase())) continue;
    const body = readFileSync(file, 'utf8');
    const urls = body.match(/https?:\/\/[^\s"'`<>()\\]+/g) ?? [];
    for (const url of urls) {
      if (!isAllowedUrl(url)) {
        errors.push(`${path.relative(distDir, file)}: external origin ${url}`);
      }
    }
  }
  return errors;
}

/**
 * REQ-DESKTOP-030.A4: the design bundle's mock dataset (specs/specship-desktop's
 * `data.js`, attached to `window.DATA`) must never reach the production bundle.
 * The SPA binds to live APIs; the mock dataset is a design reference only. Scan
 * ui/src for any import of that dataset or a `window.DATA` read — either would
 * pull the mock values into the vite bundle and present them as real.
 */
export function assertNoMockDataset(srcDir) {
  const errors = [];
  const importRe = /(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g;
  for (const file of walk(srcDir)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (/\.test\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`)) continue;
    const body = readFileSync(file, 'utf8');
    const rel = path.relative(srcDir, file);
    for (const m of body.matchAll(importRe)) {
      const spec = m[1];
      if (/(^|\/)(specship-desktop|design)\/data(\.js)?$/.test(spec) || /\/data\.js$/.test(spec)) {
        errors.push(`${rel}: imports the design bundle's mock dataset "${spec}"`);
      }
    }
    // Reading window.DATA wires the mock dataset in at runtime (the design
    // bundle's global). Comments are stripped first so a doc reference is fine.
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '');
    if (/\bwindow\s*\.\s*DATA\b/.test(codeOnly)) {
      errors.push(`${rel}: reads window.DATA (the design bundle's mock global)`);
    }
  }
  return errors;
}

/**
 * REQ-DESKTOP-031.A1: the initial JS payload must stay at or under budget
 * (250 KB gzipped by default). The SPA ships a single entry chunk plus any
 * code-split chunks the index eagerly loads; sum the gzipped size of every
 * top-level `.js` in dist/assets (vite emits the entry + shared chunks here)
 * — that is what the browser downloads before the app is interactive. Returns
 * `{ totalGzip, perFile }` so callers can report, and throws when over budget.
 */
export const INITIAL_JS_BUDGET_BYTES = 250 * 1024;

export function measureInitialJsGzip(distDir) {
  const assetsDir = path.join(distDir, 'assets');
  const perFile = [];
  let totalGzip = 0;
  let files = [];
  try { files = readdirSync(assetsDir); } catch { return { totalGzip: 0, perFile: [] }; }
  for (const name of files) {
    if (!name.endsWith('.js')) continue;
    const bytes = gzipSync(readFileSync(path.join(assetsDir, name))).length;
    perFile.push({ name, gzip: bytes });
    totalGzip += bytes;
  }
  return { totalGzip, perFile };
}

export function assertInitialJsBudget(distDir, budgetBytes = INITIAL_JS_BUDGET_BYTES) {
  const { totalGzip, perFile } = measureInitialJsGzip(distDir);
  if (totalGzip > budgetBytes) {
    const kb = (n) => (n / 1024).toFixed(1) + ' KB';
    const breakdown = perFile.map((f) => `${f.name} (${kb(f.gzip)})`).join(', ');
    throw new Error(
      `initial JS payload ${kb(totalGzip)} gzipped exceeds the ${kb(budgetBytes)} budget — ${breakdown}`,
    );
  }
  return { totalGzip, perFile };
}

function fail(stage, errors) {
  console.error(`[check-ui-deps] ${stage} FAILED:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const uiDir = path.resolve(here, '..', 'ui');
  const args = process.argv.slice(2);
  const distIdx = args.indexOf('--dist');

  if (distIdx >= 0) {
    const distDir = path.resolve(process.cwd(), args[distIdx + 1] ?? path.join(uiDir, 'dist'));
    const errors = assertNoExternalOrigins(distDir);
    if (errors.length) fail('external-origin scan (REQ-DESKTOP-017.A4)', errors);
    let budget;
    try {
      budget = assertInitialJsBudget(distDir);
    } catch (e) {
      fail('initial JS budget (REQ-DESKTOP-031.A1)', [e.message]);
    }
    const kb = (budget.totalGzip / 1024).toFixed(1);
    console.log(`[check-ui-deps] OK — no external origins in ${distDir}; initial JS ${kb} KB gz (≤250 KB budget)`);
    return;
  }

  const depErrors = assertRuntimeDepsAllowlist(path.join(uiDir, 'package.json'));
  if (depErrors.length) fail('runtime dependency allowlist (REQ-DESKTOP-017.A2)', depErrors);

  const mockErrors = assertNoMockDataset(path.join(uiDir, 'src'));
  if (mockErrors.length) fail('mock-dataset guard (REQ-DESKTOP-030.A4)', mockErrors);

  const lockPath = path.join(uiDir, 'package-lock.json');
  let lockErrors = [];
  try {
    statSync(lockPath);
    lockErrors = assertRegistryLockfile(lockPath);
  } catch {
    lockErrors = ['ui/package-lock.json is missing — commit the lockfile so installs are registry-pinned'];
  }
  if (lockErrors.length) fail('registry-safe lockfile (REQ-DESKTOP-017.A3)', lockErrors);

  console.log('[check-ui-deps] OK — runtime deps are exactly [react, react-dom]; lockfile is registry-safe; no mock dataset in ui/src');
}

// Only run the CLI when invoked directly (the test suite imports the fns).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
