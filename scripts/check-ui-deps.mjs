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
    console.log(`[check-ui-deps] OK — no external origins in ${distDir}`);
    return;
  }

  const depErrors = assertRuntimeDepsAllowlist(path.join(uiDir, 'package.json'));
  if (depErrors.length) fail('runtime dependency allowlist (REQ-DESKTOP-017.A2)', depErrors);

  const lockPath = path.join(uiDir, 'package-lock.json');
  let lockErrors = [];
  try {
    statSync(lockPath);
    lockErrors = assertRegistryLockfile(lockPath);
  } catch {
    lockErrors = ['ui/package-lock.json is missing — commit the lockfile so installs are registry-pinned'];
  }
  if (lockErrors.length) fail('registry-safe lockfile (REQ-DESKTOP-017.A3)', lockErrors);

  console.log('[check-ui-deps] OK — runtime deps are exactly [react, react-dom]; lockfile is registry-safe');
}

// Only run the CLI when invoked directly (the test suite imports the fns).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
