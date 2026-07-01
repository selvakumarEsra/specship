/**
 * Bundle build starts from a clean dist/ — REQ-BUNDLE-WEB-002.
 *
 * `npm run build` overwrites but never deletes, so orphaned `.js` from renamed/
 * deleted source can ride into the bundle. `scripts/build-bundle.sh` must run
 * `npm run clean` before `npm run build` so the bundle is assembled from a
 * wholly rebuilt dist/. Static guard on the script's command order.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build-bundle.sh');

describe('REQ-BUNDLE-WEB-002 — build-bundle.sh cleans before building', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');

  it('runs `npm run clean` before `npm run build` (A1)', () => {
    const cleanIdx = src.indexOf('npm run clean');
    const buildIdx = src.indexOf('npm run build');
    expect(cleanIdx).toBeGreaterThanOrEqual(0); // clean step present
    expect(buildIdx).toBeGreaterThanOrEqual(0); // build step present
    expect(cleanIdx).toBeLessThan(buildIdx); // clean precedes build
  });
});
