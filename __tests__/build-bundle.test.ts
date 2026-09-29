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

const src = fs.readFileSync(SCRIPT, 'utf8');

describe('REQ-BUNDLE-WEB-002 — build-bundle.sh cleans before building', () => {
  it('runs `npm run clean` before `npm run build` (A1)', () => {
    const cleanIdx = src.indexOf('npm run clean');
    const buildIdx = src.indexOf('npm run build');
    expect(cleanIdx).toBeGreaterThanOrEqual(0); // clean step present
    expect(buildIdx).toBeGreaterThanOrEqual(0); // build step present
    expect(cleanIdx).toBeLessThan(buildIdx); // clean precedes build
  });
});

/**
 * REQ-OFFLINE-006 — bundles ship no Node runtime. The build must not download
 * one (A1) and both launchers must resolve `node` from PATH, gate its version,
 * and keep `--liftoff-only` on the node command line (A2).
 */
describe('REQ-OFFLINE-006 — the bundle uses the machine Node, not a vendored one', () => {
  it('never downloads or stages a Node runtime (A1)', () => {
    expect(src).not.toMatch(/nodejs\.org\/dist/);
    expect(src).not.toMatch(/NODE_URL/);
    expect(src).not.toMatch(/\bcurl\b/);
    expect(src).not.toMatch(/NODE_BIN/);
    expect(src).not.toMatch(/\$STAGE\/node(\.exe)?"/);
  });

  it('the unix launcher resolves node from PATH and gates the version (A2)', () => {
    const launcher = src.slice(src.indexOf("<<'LAUNCH'"), src.indexOf('\nLAUNCH\n'));
    expect(launcher).toMatch(/command -v node/);
    expect(launcher).toMatch(/22\.5\.0/);
    expect(launcher).toMatch(/25\.0\.0/);
    expect(launcher).toMatch(/https:\/\/nodejs\.org/);
    expect(launcher).toMatch(/exec "\$NODE" --liftoff-only/);
  });

  it('the windows launcher resolves node from PATH and gates the version (A2)', () => {
    const launcher = src.slice(src.indexOf("<<'CMD'"), src.indexOf('\nCMD\n'));
    expect(launcher).toMatch(/where node/);
    expect(launcher).toMatch(/22\.5\.0/);
    expect(launcher).toMatch(/25\.0\.0/);
    expect(launcher).toMatch(/https:\/\/nodejs\.org/);
    expect(launcher).toMatch(/"%NODE%" --liftoff-only/);
  });
});
