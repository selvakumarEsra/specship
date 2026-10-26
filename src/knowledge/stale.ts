/**
 * External-fact staleness (KNOWLEDGE-DOC, REQ-KNOW-002 / REQ-KNOW-006.A1).
 *
 * An external domain fact (`type: external`) records the `version` of its
 * `dependency` it was verified against. When the installed version differs,
 * the fact is stale: what it says may no longer be true. A dependency that
 * cannot be found is unverifiable — reported, never counted as fresh, but not
 * by itself a failure.
 *
 * Version comparison is deliberately exact-string: a fact verified against
 * 0.28.0 is not known to hold for 0.28.1, and semver ranges would hide that.
 *
 * Read-only: reads `specs/domain/` and `package.json` files, writes nothing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { loadDomainFacts, parseFixtureList } from './facts';

export interface ResolveVersionOptions {
  /**
   * Returns the global npm root (what `npm root -g` prints), or null. Injected
   * by tests; the default shells out to npm once per process and caches it.
   */
  globalRoot?: () => string | null;
}

export type StaleCheckOptions = ResolveVersionOptions;

export interface FreshFact {
  id: string;
  dependency: string;
  version: string;
}

export interface StaleFact {
  id: string;
  dependency: string;
  /** The version the fact was verified against. */
  verified: string;
  /** The version installed now. */
  installed: string;
  /** `path:Symbol` fixture tests to re-check (REQ-KNOW-006.A1). */
  fixtures: string[];
}

export interface UnverifiableFact {
  id: string;
  dependency: string;
}

export interface StaleCheckResult {
  fresh: FreshFact[];
  stale: StaleFact[];
  unverifiable: UnverifiableFact[];
}

let cachedGlobalRoot: string | null | undefined;

/** `npm root -g`, run at most once per process. Null when npm is unavailable. */
export function defaultGlobalNpmRoot(): string | null {
  if (cachedGlobalRoot !== undefined) return cachedGlobalRoot;
  try {
    const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      shell: process.platform === 'win32',
    }).trim();
    cachedGlobalRoot = out.length > 0 ? out : null;
  } catch {
    cachedGlobalRoot = null;
  }
  return cachedGlobalRoot;
}

function readPackageVersion(modulesDir: string, dependency: string): string | null {
  // `@scope/name` maps onto nested directories; path.join handles the slash.
  const pkgPath = path.join(modulesDir, ...dependency.split('/'), 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * The installed version of `dependency`: the project's `node_modules` first,
 * then the global npm root; null when neither has it.
 */
export function resolveInstalledVersion(
  dependency: string,
  projectRoot: string,
  opts: ResolveVersionOptions = {}
): string | null {
  const dep = dependency.trim();
  if (dep.length === 0 || dep.includes('..')) return null;
  const local = readPackageVersion(path.join(projectRoot, 'node_modules'), dep);
  if (local) return local;
  const globalRoot = (opts.globalRoot ?? defaultGlobalNpmRoot)();
  if (!globalRoot) return null;
  return readPackageVersion(globalRoot, dep);
}

/**
 * Compare every external fact under `<projectRoot>/specs/domain/` with the
 * installed version of its dependency. Facts missing `dependency` or `version`
 * are skipped (the lint reports them as errors).
 */
export function findStaleExternalFacts(
  projectRoot: string,
  opts: StaleCheckOptions = {}
): StaleCheckResult {
  const result: StaleCheckResult = { fresh: [], stale: [], unverifiable: [] };
  // Resolve the global root lazily and at most once for the whole run.
  let globalRoot: string | null | undefined;
  const memoGlobal = () => {
    if (globalRoot === undefined) globalRoot = (opts.globalRoot ?? defaultGlobalNpmRoot)();
    return globalRoot;
  };
  for (const fact of loadDomainFacts(projectRoot)) {
    if (fact.type !== 'external') continue;
    const dependency = typeof fact.metadata.dependency === 'string' ? fact.metadata.dependency.trim() : '';
    const rawVersion = fact.metadata.version;
    const verified =
      typeof rawVersion === 'string' || typeof rawVersion === 'number' ? String(rawVersion).trim() : '';
    if (!dependency || !verified) continue;
    const installed = resolveInstalledVersion(dependency, projectRoot, { globalRoot: memoGlobal });
    if (installed === null) {
      result.unverifiable.push({ id: fact.id, dependency });
    } else if (installed === verified) {
      result.fresh.push({ id: fact.id, dependency, version: verified });
    } else {
      result.stale.push({
        id: fact.id,
        dependency,
        verified,
        installed,
        fixtures: parseFixtureList(fact.metadata.fixture),
      });
    }
  }
  return result;
}

/** Exit code for `knowledge stale`: non-zero when any fact is stale. Unverifiable alone passes. */
export function exitCodeForStale(result: StaleCheckResult): number {
  return result.stale.length > 0 ? 1 : 0;
}

/** Human-readable report for `knowledge stale`. */
export function formatStaleReport(result: StaleCheckResult): string {
  const total = result.fresh.length + result.stale.length + result.unverifiable.length;
  if (total === 0) return 'Knowledge stale: no external facts in specs/domain/.';
  const out: string[] = [
    `Knowledge stale: ${result.stale.length} stale, ${result.unverifiable.length} unverifiable, ${result.fresh.length} fresh (of ${total} external fact${total === 1 ? '' : 's'}).`,
  ];
  if (result.stale.length > 0) {
    out.push('', 'Stale:');
    for (const s of result.stale) {
      out.push(`  ${s.id}  ${s.dependency}: verified ${s.verified}, installed ${s.installed}`);
      if (s.fixtures.length > 0) {
        out.push(`    re-check fixtures: ${s.fixtures.join(', ')}`);
      }
    }
  }
  if (result.unverifiable.length > 0) {
    out.push('', 'Unverifiable (dependency not installed locally or globally):');
    for (const u of result.unverifiable) out.push(`  ${u.id}  ${u.dependency}`);
  }
  return out.join('\n');
}
