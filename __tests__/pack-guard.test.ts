/**
 * Pack guard (SLIM-DOC, REQ-SLIM-001)
 *
 * The published tarball is the product surface: every byte here lands on every
 * user's disk. These assertions enumerate the real `npm pack` manifest rather
 * than reasoning about package.json, so a new asset directory or a compiler
 * flag that starts emitting maps fails loudly instead of quietly adding MBs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  MAX_PACKED_BYTES,
  MAX_UNPACKED_BYTES,
  MAX_FILE_COUNT,
  SLIM_A4_UNPACKED_CEILING,
  repoRoot,
  readPackManifest,
  type PackManifest,
} from './pack-budget';

// The size budgets (a ratchet) and their dated raise history live in
// ./pack-budget.ts, shared with REQ-DASHTHEME-002.A5's test.

let manifest: PackManifest;

// `npm pack --dry-run` shells out to the packer and can take a few seconds on
// a cold cache; it writes nothing to disk.
beforeAll(() => {
  manifest = readPackManifest();
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
