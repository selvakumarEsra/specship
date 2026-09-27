/**
 * Pack guard (SLIM-DOC, REQ-SLIM-001)
 *
 * The published tarball is the product surface: every byte here lands on every
 * user's disk. These assertions enumerate the real `npm pack` manifest rather
 * than reasoning about package.json, so a new asset directory or a compiler
 * flag that starts emitting maps fails loudly instead of quietly adding MBs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Size budgets are a RATCHET: set just above the measured size of a clean
 * build after the REQ-SLIM-001/002 slimming — 2.19 MB packed / 5.74 MB
 * unpacked / 503 files, down from 2.94 MB / 14.10 MB / 954. Lower them when
 * the package shrinks; never raise them to make a failing build pass —
 * investigate what got added instead. A failure right after pulling this
 * change usually means a stale `dist/` (rebuild: content-hashed SPA bundles
 * used to accumulate under dist/ui/assets).
 */
const MAX_PACKED_BYTES = 2_400_000;
const MAX_UNPACKED_BYTES = 6_200_000;
const MAX_FILE_COUNT = 530;

/** REQ-SLIM-002.A4's own ceiling, independent of the ratchet above. */
const SLIM_A4_UNPACKED_CEILING = 7_000_000;

interface PackFile {
  path: string;
  size: number;
}

interface PackManifest {
  entryCount: number;
  size: number;
  unpackedSize: number;
  files: PackFile[];
}

const repoRoot = path.resolve(__dirname, '..');

let manifest: PackManifest;

// `npm pack --dry-run` shells out to the packer and can take a few seconds on
// a cold cache; it writes nothing to disk.
beforeAll(() => {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(stdout) as PackManifest[];
  manifest = parsed[0]!;
}, 180_000);

describe('published package contents (SLIM-DOC)', () => {
  it('REQ-SLIM-001.A1: ships no source maps', () => {
    const maps = manifest.files.filter((f) => f.path.endsWith('.map'));
    expect(maps.map((f) => f.path)).toEqual([]);
  });

  it('REQ-SLIM-001.A1: ships none of the dev/release tooling under scripts/', () => {
    const scripts = manifest.files.filter((f) => f.path.startsWith('scripts/'));
    expect(scripts.map((f) => f.path)).toEqual([]);
  });

  it('REQ-SLIM-001.A1: still ships the runtime entrypoints the package advertises', () => {
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths.has('dist/index.js')).toBe(true);
    expect(paths.has('dist/bin/specship.js')).toBe(true);
    // preuninstall runs this — the reason scripts/ can be dropped safely.
    expect(paths.has('dist/bin/uninstall.js')).toBe(true);
    expect(paths.has('dist/db/schema.sql')).toBe(true);
  });

  it('REQ-SLIM-001.A2: packed size is within budget', () => {
    expect(manifest.size).toBeLessThanOrEqual(MAX_PACKED_BYTES);
  });

  it('REQ-SLIM-002.A4: unpacked size is at or below 7 MB', () => {
    expect(manifest.unpackedSize).toBeLessThanOrEqual(SLIM_A4_UNPACKED_CEILING);
  });

  it('REQ-SLIM-001.A2: unpacked size is within the ratchet budget', () => {
    expect(manifest.unpackedSize).toBeLessThanOrEqual(MAX_UNPACKED_BYTES);
  });

  it('REQ-SLIM-001.A2: file count is within budget', () => {
    expect(manifest.entryCount).toBeLessThanOrEqual(MAX_FILE_COUNT);
  });

  it('REQ-SLIM-002.A1: oversized grammars ship compressed, small ones raw', () => {
    const wasm = manifest.files.filter((f) => f.path.startsWith('dist/extraction/wasm/'));
    const names = wasm.map((f) => f.path.replace('dist/extraction/wasm/', ''));
    expect(names).toContain('tree-sitter-scala.wasm.gz');
    expect(names).toContain('tree-sitter-pascal.wasm.gz');
    expect(names).not.toContain('tree-sitter-scala.wasm');
    expect(names).not.toContain('tree-sitter-pascal.wasm');
    // Below the threshold — compressing these would only add a decode step.
    expect(names).toContain('tree-sitter-lua.wasm');
    expect(names).toContain('tree-sitter-luau.wasm');
  });
});

describe('local development build (SLIM-DOC)', () => {
  it('REQ-SLIM-001.A3: compiles with source maps — the exclusion is pack-time only', () => {
    // Exclusion lives in package.json "files" (a `!dist/**/*.map` negation), so
    // tsc must still be configured to emit them for local debugging.
    const tsconfig = require(path.join(repoRoot, 'tsconfig.json'));
    expect(tsconfig.compilerOptions.sourceMap).toBe(true);
  });
});
