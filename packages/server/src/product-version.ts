/**
 * Resolve the real product version — `@specship/specship`'s package.json
 * `version` — without a bare-package runtime import (DOM-SPECSHIP-004: a
 * `import pkg from '@specship/specship/package.json'` would silently pin a
 * stale install). Instead walk up from this compiled module, which lands in
 * both delivery shapes under the product package:
 *
 *   1. **Bundled** — `<bundle>/lib/dist/server/…` → `<bundle>/lib/package.json`.
 *   2. **Workspace / dev** — `packages/server/{src,dist}/…` → repo root
 *      `package.json` (the walk skips the private `@specship/specship-server`
 *      manifest because its name doesn't match).
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function productVersion(): string {
  if (cached) return cached;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  let fallback: string | null = null;
  for (let depth = 0; depth < 8; depth++) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf-8')) as { name?: string; version?: string };
        if (pkg.name === '@specship/specship' && pkg.version) {
          cached = pkg.version;
          return cached;
        }
        // Remember the nearest versioned manifest as a last resort.
        if (!fallback && pkg.version) fallback = pkg.version;
      } catch { /* unreadable manifest — keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cached = fallback ?? '0.0.0';
  return cached;
}
