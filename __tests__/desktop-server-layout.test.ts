/**
 * REQ-DESKTOP-029.A5 — the dashboard server lives in a clean top-level
 * `server/` module beside `ui/`, the `packages/` nesting is dissolved, and its
 * former residents are relocated (`npm-shim/`, `e2e/`) rather than left behind.
 * A regression here (a re-nested `packages/server`, or a stale `file:../..`
 * dep) silently breaks the bundle build and the CLI's dev-sibling loader.
 *
 * Plus DOM-SPECSHIP-004 — no module under `server/src` may STATICALLY import
 * from `@specship/specship`. A static value import is eagerly resolved and
 * would silently pin a stale build; the server reaches the core only through
 * the dynamic loader (`await import(...)`) or type-only positions
 * (`typeof import(...)` / `import type`). This sweeps every route (and the
 * whole tree) so a new file can't reintroduce the bare import.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('desktop server layout (REQ-DESKTOP-029.A5)', () => {
  it('exposes server/ and ui/ as sibling top-level modules', () => {
    expect(fs.existsSync(path.join(root, 'server', 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'server', 'src', 'server.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui', 'package.json'))).toBe(true);
  });

  it('dissolves the packages/ nesting — no dashboard code remains under it', () => {
    expect(fs.existsSync(path.join(root, 'packages'))).toBe(false);
  });

  it('relocates the former packages/ residents (npm shim + e2e), not deletes them', () => {
    expect(fs.existsSync(path.join(root, 'npm-shim', 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'e2e', 'package.json'))).toBe(true);
  });

  it('pins the core dep at the depth-1 relative path (file:..), not the old file:../..', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@specship/specship']).toBe('file:..');
  });
});

describe('no static @specship/specship import under server/src (DOM-SPECSHIP-004)', () => {
  // A static import statement (value OR namespace/default) resolved eagerly by
  // the bundler. `import type` is erased and allowed; the negative lookahead
  // excludes it. Dynamic `import(...)` and `typeof import(...)` have no
  // `from` clause and are never matched.
  const STATIC_IMPORT = /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+['"]@specship\/specship(?:\/[^'"]*)?['"]/m;

  function* walk(dir: string): Generator<string> {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) yield* walk(p);
      else if (p.endsWith('.ts')) yield p;
    }
  }

  it('every route is free of a static bare-package import', () => {
    const routesDir = path.join(root, 'server', 'src', 'routes');
    const offenders: string[] = [];
    for (const file of walk(routesDir)) {
      if (STATIC_IMPORT.test(fs.readFileSync(file, 'utf-8'))) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the whole server/src tree is free of a static bare-package import', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(root, 'server', 'src'))) {
      if (STATIC_IMPORT.test(fs.readFileSync(file, 'utf-8'))) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
