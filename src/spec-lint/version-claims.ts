/**
 * Dependency-version claims (LINKACC-DOC, REQ-LINKACC-008).
 *
 * A spec MAY record in its frontmatter the version of an external package or
 * tool its requirements were checked against:
 *
 *   checked_against: "@google/gemini-cli@0.28.0"
 *
 * Several claims are comma-separated. Each is split at its LAST `@`, so scoped
 * names keep their leading `@`. The version must be `x.y.z`.
 *
 * The version in use is found, in order:
 *   1. `package-lock.json` → `packages["node_modules/<pkg>"].version`;
 *   2. `node_modules/<pkg>/package.json` → `version`;
 *   3. a probe the PROJECT opts into in `specship.config.json`:
 *      `"versionProbes": { "<pkg>": "<command>" }` — the first `x.y.z` in the
 *      command's stdout is the version in use.
 *
 * Only the config may name a probe: nothing read from a spec file is ever
 * executed. A probe runs without a shell (the command string is split into
 * argv, honouring quotes), with a 3 s timeout, memoised per process; failure,
 * timeout or no `x.y.z` in its output leaves the claim unchecked. A claim
 * SpecShip cannot check is reported as unchecked — never as current.
 *
 * Shared by `specship lint` and `specship_spec`, so both use one resolver.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { compareVersions } from '../update/updater';

/** The frontmatter key a spec records its claims under. */
export const VERSION_CLAIM_KEY = 'checked_against';

/** The config key a project names its version probes under. */
export const VERSION_PROBES_KEY = 'versionProbes';

/** Default probe timeout (ms). */
export const VERSION_PROBE_TIMEOUT_MS = 3000;

const SEMVER = /^\d+\.\d+\.\d+$/;
const FIRST_SEMVER = /\d+\.\d+\.\d+/;

export interface VersionClaim {
  /** Package or tool name, e.g. `@google/gemini-cli`. */
  pkg: string;
  /** The version the spec was checked against (`x.y.z`). */
  version: string;
  /** The claim as written. */
  raw: string;
}

export interface VersionClaimError {
  raw: string;
  reason: string;
}

/** Looks up the version in use for a package; null when it cannot be found. */
export type VersionInUseResolver = (pkg: string) => string | null;

export type VersionClaimResult =
  | { status: 'current'; claim: VersionClaim; inUse: string }
  /** The version in use is older than the claim — not flagged (only newer is). */
  | { status: 'older'; claim: VersionClaim; inUse: string }
  | { status: 'stale'; claim: VersionClaim; inUse: string }
  | { status: 'unchecked'; claim: VersionClaim }
  | { status: 'malformed'; error: VersionClaimError };

/**
 * Parse the `checked_against` value from a spec's frontmatter metadata.
 * Absent key → no claims, no errors. A non-string value (the frontmatter
 * parser turns a bare integer into a number) or an empty one is malformed.
 */
export function parseVersionClaims(meta: Record<string, unknown> | undefined | null): {
  claims: VersionClaim[];
  errors: VersionClaimError[];
} {
  const claims: VersionClaim[] = [];
  const errors: VersionClaimError[] = [];
  if (!meta || !(VERSION_CLAIM_KEY in meta)) return { claims, errors };
  const value = meta[VERSION_CLAIM_KEY];
  if (typeof value !== 'string') {
    errors.push({ raw: String(value), reason: 'the value must be a quoted "<package>@<x.y.z>" string' });
    return { claims, errors };
  }
  const parts = value.split(',').map((p) => p.trim());
  if (parts.every((p) => p.length === 0)) {
    errors.push({ raw: value, reason: 'the value is empty' });
    return { claims, errors };
  }
  for (const raw of parts) {
    if (raw.length === 0) {
      errors.push({ raw: value, reason: 'it has an empty entry between commas' });
      continue;
    }
    const at = raw.lastIndexOf('@');
    if (at <= 0) {
      errors.push({ raw, reason: 'it has no "<package>@<version>" separator' });
      continue;
    }
    const pkg = raw.slice(0, at).trim();
    const version = raw.slice(at + 1).trim();
    if (pkg.length === 0 || pkg === '@') {
      errors.push({ raw, reason: 'the package name is empty' });
    } else if (!SEMVER.test(version)) {
      errors.push({ raw, reason: `the version "${version}" is not x.y.z` });
    } else {
      claims.push({ pkg, version, raw });
    }
  }
  return { claims, errors };
}

/**
 * The `checked_against` frontmatter entry of a spec source, with its 1-indexed
 * line, read the way the markdown extractor reads frontmatter (surrounding
 * quotes stripped, an all-digit value becomes a number). Null when absent.
 */
export function findVersionClaimInSource(source: string): { meta: Record<string, unknown>; line: number } | null {
  const lines = source.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '---') return null;
    const colon = line.indexOf(':');
    if (colon <= 0 || line.slice(0, colon).trim() !== VERSION_CLAIM_KEY) continue;
    let value: unknown = line.slice(colon + 1).trim();
    const s = value as string;
    if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
      value = s.slice(1, -1);
    }
    if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
    return { meta: { [VERSION_CLAIM_KEY]: value }, line: i + 1 };
  }
  return null;
}

function safePkgName(pkg: string): boolean {
  return pkg.length > 0 && !pkg.includes('..') && !path.isAbsolute(pkg) && !pkg.includes('\\');
}

function versionFromLockfile(projectRoot: string, pkg: string): string | null {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: unknown }>;
    };
    const v = lock.packages?.[`node_modules/${pkg}`]?.version;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function versionFromNodeModules(projectRoot: string, pkg: string): string | null {
  try {
    const p = path.join(projectRoot, 'node_modules', ...pkg.split('/'), 'package.json');
    const v = (JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The probe command the project's `specship.config.json` names for `pkg`, if any. */
function configuredProbe(projectRoot: string, pkg: string): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'specship.config.json'), 'utf8')) as Record<string, unknown>;
    const probes = cfg?.[VERSION_PROBES_KEY];
    if (!probes || typeof probes !== 'object' || Array.isArray(probes)) return null;
    if (!Object.prototype.hasOwnProperty.call(probes, pkg)) return null;
    const cmd = (probes as Record<string, unknown>)[pkg];
    return typeof cmd === 'string' && cmd.trim().length > 0 ? cmd.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Split a command string into argv without a shell: whitespace separates
 * arguments, single or double quotes group them. No expansion, no pipes —
 * the string is never handed to a shell.
 */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        out.push(cur);
        cur = '';
        started = false;
      }
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

const probeCache = new Map<string, string | null>();

/** Forget memoised probe results (tests). */
export function clearVersionProbeCache(): void {
  probeCache.clear();
}

function runProbe(projectRoot: string, command: string, timeoutMs: number): string | null {
  const key = `${path.resolve(projectRoot)}\0${command}\0${timeoutMs}`;
  if (probeCache.has(key)) return probeCache.get(key) ?? null;
  let result: string | null = null;
  const argv = splitCommand(command);
  if (argv.length > 0) {
    try {
      const out = execFileSync(argv[0]!, argv.slice(1), {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        shell: false,
        windowsHide: true,
      });
      result = out.match(FIRST_SEMVER)?.[0] ?? null;
    } catch {
      result = null;
    }
  }
  probeCache.set(key, result);
  return result;
}

export interface ResolveVersionInUseOptions {
  /** Probe timeout in ms. Defaults to {@link VERSION_PROBE_TIMEOUT_MS}. */
  probeTimeoutMs?: number;
}

/**
 * The version of `pkg` the project uses: lockfile, then `node_modules`, then
 * a probe configured in `specship.config.json`. Null when none of them knows.
 */
export function resolveVersionInUse(
  projectRoot: string,
  pkg: string,
  opts: ResolveVersionInUseOptions = {}
): string | null {
  const name = pkg.trim();
  if (!safePkgName(name)) return null;
  const fromLock = versionFromLockfile(projectRoot, name);
  if (fromLock) return fromLock;
  const fromModules = versionFromNodeModules(projectRoot, name);
  if (fromModules) return fromModules;
  const probe = configuredProbe(projectRoot, name);
  if (!probe) return null;
  return runProbe(projectRoot, probe, opts.probeTimeoutMs ?? VERSION_PROBE_TIMEOUT_MS);
}

/**
 * Check every claim in `meta` against the version in use. One result per
 * claim (and per malformed entry). `resolver` overrides the default
 * {@link resolveVersionInUse} — tests inject one.
 */
export function checkVersionClaims(
  meta: Record<string, unknown> | undefined | null,
  projectRoot: string,
  resolver?: VersionInUseResolver
): VersionClaimResult[] {
  const { claims, errors } = parseVersionClaims(meta);
  const resolve: VersionInUseResolver = resolver ?? ((pkg) => resolveVersionInUse(projectRoot, pkg));
  const out: VersionClaimResult[] = errors.map((error) => ({ status: 'malformed' as const, error }));
  for (const claim of claims) {
    let inUse: string | null = null;
    try {
      inUse = resolve(claim.pkg);
    } catch {
      inUse = null;
    }
    const v = inUse?.match(FIRST_SEMVER)?.[0] ?? null;
    if (v === null) {
      out.push({ status: 'unchecked', claim });
      continue;
    }
    const cmp = compareVersions(v, claim.version);
    out.push({ status: cmp > 0 ? 'stale' : cmp < 0 ? 'older' : 'current', claim, inUse: v });
  }
  return out;
}

/**
 * The one wording lint and `specship_spec` share. Null for results that are
 * not reported (current / older).
 */
export function formatVersionClaim(r: VersionClaimResult): string | null {
  switch (r.status) {
    case 'stale':
      return `checked against ${r.claim.pkg} ${r.claim.version}, project uses ${r.inUse} — re-check the spec against ${r.inUse} and update ${VERSION_CLAIM_KEY}.`;
    case 'unchecked':
      return `checked against ${r.claim.pkg} ${r.claim.version}, but the version in use could not be found (no package-lock.json entry, no node_modules package, no ${VERSION_PROBES_KEY} probe in specship.config.json) — unchecked.`;
    case 'malformed':
      return `Malformed ${VERSION_CLAIM_KEY} claim "${r.error.raw}": ${r.error.reason}. Write ${VERSION_CLAIM_KEY}: "<package>@<x.y.z>".`;
    default:
      return null;
  }
}
