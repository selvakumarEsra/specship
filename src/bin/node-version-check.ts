/**
 * Node.js version compatibility check.
 *
 * Node 25.x has a V8 turboshaft WASM JIT Zone allocator bug that
 * reliably crashes SpecShip with `Fatal process out of memory: Zone`
 * during tree-sitter grammar compilation. This module owns the
 * user-facing banner shown before exit. Kept side-effect-free so it's
 * safe to import from tests without triggering CLI bootstrap.
 */

/**
 * Build the bordered banner shown when SpecShip detects an
 * unsupported Node.js major version (currently 25+). Pinned via unit
 * test so the recovery commands and override instructions can't be
 * silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNode25BlockBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[SpecShip] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    'Node.js 25.x has a V8 WASM JIT (turboshaft) Zone allocator bug that',
    'crashes with `Fatal process out of memory: Zone` when SpecShip',
    'compiles tree-sitter grammars. SpecShip WILL crash on this Node',
    'version mid-indexing. See https://github.com/selvakumarEsra/specship/issues/81',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - you will likely OOM):',
    '  SPECSHIP_ALLOW_UNSAFE_NODE=1 specship ...',
    sep,
  ].join('\n');
}

/**
 * Lowest supported Node.js version (major.minor). Matches the `engines` floor
 * (`>=22.5.0 <25.0.0`) in package.json, npm-shim/package.json, and every
 * package `scripts/pack-npm.sh` publishes. 22.5 is the first release with the
 * built-in `node:sqlite` the SQLite adapter falls back to. `engines` alone only
 * *warns* on install (unless the user set `engine-strict`), so the CLI bootstrap
 * also hard-blocks here to actually enforce the floor (REQ-AUDFIX-007).
 */
export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_MINOR = 5;
/** Human-readable floor, e.g. "22.5". */
export const MIN_NODE_VERSION = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`;

/**
 * True when `nodeVersion` (e.g. "22.4.1", "v20.0.0") is below the supported
 * floor. Compares major, then minor; an unparseable version counts as too old.
 */
export function isNodeTooOld(nodeVersion: string): boolean {
  const [majStr, minStr] = nodeVersion.replace(/^v/, '').split('.');
  const major = parseInt(majStr ?? '', 10);
  const minor = parseInt(minStr ?? '0', 10);
  if (!Number.isFinite(major)) return true;
  if (major !== MIN_NODE_MAJOR) return major < MIN_NODE_MAJOR;
  return (Number.isFinite(minor) ? minor : 0) < MIN_NODE_MINOR;
}

/**
 * Startup decision for the Node floor: `ok` (supported), `block` (too old, exit
 * 1), or `warn` (too old, but `SPECSHIP_ALLOW_UNSAFE_NODE` is set — show the
 * banner and continue). Pure so the bootstrap and tests share one rule.
 */
export function nodeFloorDecision(
  nodeVersion: string,
  env: Record<string, string | undefined> = process.env,
): 'ok' | 'block' | 'warn' {
  if (!isNodeTooOld(nodeVersion)) return 'ok';
  return env.SPECSHIP_ALLOW_UNSAFE_NODE ? 'warn' : 'block';
}

/**
 * Build the bordered banner shown when SpecShip detects a Node.js version below
 * {@link MIN_NODE_VERSION}. Pinned via unit test so the recovery commands and the
 * override env var can't be silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[SpecShip] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `SpecShip requires Node.js ${MIN_NODE_VERSION} or newer. Older versions lack`,
    'language features and native APIs SpecShip depends on, and are not',
    'tested or supported.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  SPECSHIP_ALLOW_UNSAFE_NODE=1 specship ...',
    sep,
  ].join('\n');
}
