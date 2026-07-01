/**
 * Dashboard build is self-contained — REQ-BUNDLE-WEB-001.
 *
 * `build:web` (scripts/build-web-bundle.mjs) must install the dashboard's own
 * dependencies when the Angular CLI is missing, instead of erroring out — so a
 * clean checkout (and `scripts/build-bundle.sh` run on one) still ships the
 * current UI. These are static guards on the script's control flow; a full
 * behavioral test would require an Angular install (network + minutes).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build-web-bundle.mjs');

describe('REQ-BUNDLE-WEB-001 — build:web self-installs the dashboard deps', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');

  it('installs the dashboard dependencies when the Angular CLI is missing (A1)', () => {
    expect(src).toMatch(/installing dashboard deps/i);
    // The install command is built (npm ci / install) ...
    expect(src).toMatch(/\[\s*['"](ci|install)['"]/);
    // ... and actually executed via npm (not just mentioned in an error string).
    expect(src).toMatch(/execFileSync\(\s*npmBin/);
  });

  it('re-verifies the Angular CLI after attempting the install, failing loudly if still missing (A5)', () => {
    // Two existsSync(ngBin) checks: once to decide to install, once after.
    const checks = src.match(/existsSync\(ngBin\)/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });

  it('does not reinstall when the Angular CLI is already present (A3)', () => {
    // The install lives inside the `!existsSync(ngBin)` guard, so a present CLI skips it.
    expect(src).toMatch(/if\s*\(\s*!existsSync\(ngBin\)\s*\)/);
  });

  it('still builds on the default path (skip is opt-in only) (A4)', () => {
    expect(src).toMatch(/SPECSHIP_SKIP_WEB_BUILD/);
    expect(src).toMatch(/--skip-build/);
  });
});
