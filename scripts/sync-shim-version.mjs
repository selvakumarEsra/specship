#!/usr/bin/env node
/**
 * Sync `npm-shim/package.json` against the root version.
 *
 * The unscoped `specship-cli` shim has one dependency — `@specship/specship`
 * pinned to a specific version (NOT a range, because the shim's whole job is
 * to deliver THE matching CLI). So every root release needs the shim's:
 *   - `version`                              → the root's new version
 *   - `dependencies["@specship/specship"]` → exact match, same pin
 *
 * Wired into the root package's `version` lifecycle, this runs automatically
 * when `npm version <bump>` mutates the root. After it runs, the modified
 * shim package.json is `git add`-ed into the same version-bump commit so the
 * release stays atomic.
 *
 * Usage (manual): `npm run sync:shim`
 * Usage (auto):   triggered by `npm version patch|minor|major` via the
 *                 root `version` script.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const rootPkgPath = path.join(repoRoot, 'package.json');
const shimPkgPath = path.join(repoRoot, 'npm-shim', 'package.json');

function readJson(p) { return JSON.parse(readFileSync(p, 'utf-8')); }
function writeJson(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

const rootPkg = readJson(rootPkgPath);
const shimPkg = readJson(shimPkgPath);
const rootName = rootPkg.name; // e.g. @specship/specship
const target = rootPkg.version;

const changes = [];
if (shimPkg.version !== target) {
  changes.push(`version: ${shimPkg.version} → ${target}`);
  shimPkg.version = target;
}
shimPkg.dependencies ??= {};
const currentPin = shimPkg.dependencies[rootName];
if (currentPin !== target) {
  changes.push(`dep ${rootName}: ${currentPin ?? '(missing)'} → ${target}`);
  shimPkg.dependencies[rootName] = target;
}

if (changes.length === 0) {
  console.log(`[sync-shim] already in sync at ${target}`);
  process.exit(0);
}

writeJson(shimPkgPath, shimPkg);
console.log(`[sync-shim] updated npm-shim/package.json:`);
for (const c of changes) console.log(`           - ${c}`);

// Stage the change so `npm version` rolls it into the same commit.
try {
  execSync('git add npm-shim/package.json', { cwd: repoRoot, stdio: 'inherit' });
} catch {
  // Not in a git repo (or git unavailable) — fine; sync still happened on disk.
}
