/**
 * Pin the Node-25 block banner content. The banner replaced a soft
 * `console.warn` because the warning was scrolling off-screen before
 * the OOM crash 30 seconds later, generating duplicate bug reports
 * (#54, #81, #140). The recipe and override env var below are
 * load-bearing — if any of them get edited away, this test catches it.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildNode25BlockBanner,
  buildNodeTooOldBanner,
  isNodeTooOld,
  nodeFloorDecision,
  MIN_NODE_MAJOR,
  MIN_NODE_MINOR,
  MIN_NODE_VERSION,
} from '../src/bin/node-version-check';

describe('buildNode25BlockBanner', () => {
  it('embeds the reported Node version in the header', () => {
    expect(buildNode25BlockBanner('25.9.0')).toContain(
      'Unsupported Node.js version: 25.9.0'
    );
  });

  it('names the V8 turboshaft WASM root cause and the OOM symptom', () => {
    const banner = buildNode25BlockBanner('25.7.0');
    expect(banner).toContain('V8 WASM JIT');
    expect(banner).toContain('turboshaft');
    expect(banner).toContain('Fatal process out of memory: Zone');
  });

  it('points users to Node 22 LTS via nvm and Homebrew', () => {
    const banner = buildNode25BlockBanner('25.7.0');
    expect(banner).toContain('Node.js 22 LTS');
    expect(banner).toContain('nvm install 22');
    expect(banner).toContain('brew install node@22');
  });

  it('documents the SPECSHIP_ALLOW_UNSAFE_NODE override', () => {
    const banner = buildNode25BlockBanner('25.7.0');
    expect(banner).toContain('SPECSHIP_ALLOW_UNSAFE_NODE=1');
  });

  it('links to issue #81 for the root-cause writeup', () => {
    expect(buildNode25BlockBanner('25.7.0')).toContain(
      'github.com/selvakumarEsra/specship/issues/81'
    );
  });
});

describe('buildNodeTooOldBanner', () => {
  it('embeds the reported Node version in the header', () => {
    expect(buildNodeTooOldBanner('18.20.0')).toContain(
      'Unsupported Node.js version: 18.20.0'
    );
  });

  it('REQ-AUDFIX-007.A1: states the 22.5 floor', () => {
    expect(MIN_NODE_MAJOR).toBe(22);
    expect(MIN_NODE_MINOR).toBe(5);
    expect(MIN_NODE_VERSION).toBe('22.5');
    expect(buildNodeTooOldBanner('22.4.0')).toContain('requires Node.js 22.5 or newer');
  });

  it('points users to Node 22 LTS via nvm and Homebrew', () => {
    const banner = buildNodeTooOldBanner('16.0.0');
    expect(banner).toContain('Node.js 22 LTS');
    expect(banner).toContain('nvm install 22');
    expect(banner).toContain('brew install node@22');
  });

  it('documents the SPECSHIP_ALLOW_UNSAFE_NODE override', () => {
    expect(buildNodeTooOldBanner('18.0.0')).toContain('SPECSHIP_ALLOW_UNSAFE_NODE=1');
  });
});

describe('REQ-AUDFIX-007.A1 — the Node floor is 22.5 (major + minor)', () => {
  it('REQ-AUDFIX-007.A1: blocks 22.4 and older', () => {
    for (const v of ['22.4.1', '22.4.0', '22.0.0', '21.7.3', '20.19.0', '18.20.0', 'v20.0.0']) {
      expect(isNodeTooOld(v)).toBe(true);
      expect(nodeFloorDecision(v, {})).toBe('block');
    }
  });

  it('REQ-AUDFIX-007.A1: lets 22.5 and newer (below 25) through', () => {
    for (const v of ['22.5.0', '22.5.1', '22.12.0', '23.0.0', '24.18.0', 'v22.5.0']) {
      expect(isNodeTooOld(v)).toBe(false);
      expect(nodeFloorDecision(v, {})).toBe('ok');
    }
  });

  it('REQ-AUDFIX-007.A1: treats an unparseable version as too old', () => {
    expect(isNodeTooOld('garbage')).toBe(true);
  });

  it('REQ-AUDFIX-007.A1: SPECSHIP_ALLOW_UNSAFE_NODE=1 still overrides the block (warn, continue)', () => {
    expect(nodeFloorDecision('22.4.0', { SPECSHIP_ALLOW_UNSAFE_NODE: '1' })).toBe('warn');
    expect(nodeFloorDecision('20.0.0', { SPECSHIP_ALLOW_UNSAFE_NODE: '1' })).toBe('warn');
    // The override never changes the verdict for a supported version.
    expect(nodeFloorDecision('22.5.0', { SPECSHIP_ALLOW_UNSAFE_NODE: '1' })).toBe('ok');
  });

  it('REQ-AUDFIX-007.A1: the CLI bootstrap routes the floor through nodeFloorDecision and exits on block', () => {
    const cli = fs.readFileSync(path.join(__dirname, '..', 'src', 'bin', 'specship.ts'), 'utf-8');
    expect(cli).toMatch(/nodeFloorDecision\(nodeVersion\)/);
    expect(cli).toMatch(/if \(nodeFloor === 'block'\) \{\s*process\.exit\(1\);/);
  });
});

describe('REQ-AUDFIX-007.A2 — every engines.node and CI job agree on >=22.5', () => {
  const root = path.join(__dirname, '..');
  const ENGINES = '>=22.5.0 <25.0.0';

  it('REQ-AUDFIX-007.A2: package.json engines.node', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.engines.node).toBe(ENGINES);
  });

  it('REQ-AUDFIX-007.A2: npm-shim/package.json engines.node', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'npm-shim', 'package.json'), 'utf-8'));
    expect(pkg.engines.node).toBe(ENGINES);
  });

  it('REQ-AUDFIX-007.A2: the lockfiles\' root package entries match', () => {
    for (const rel of ['package-lock.json', path.join('npm-shim', 'package-lock.json')]) {
      const lock = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
      expect(lock.packages[''].engines.node).toBe(ENGINES);
    }
  });

  it('REQ-AUDFIX-007.A2: the published packages generated by pack-npm.sh declare the same floor', () => {
    const pack = fs.readFileSync(path.join(root, 'scripts', 'pack-npm.sh'), 'utf-8');
    const declared = [...pack.matchAll(/engines:\s*\{\s*node:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const d of declared) expect(d).toBe(ENGINES);
  });

  it('REQ-AUDFIX-007.A2: no CI workflow runs on Node 20', () => {
    const dir = path.join(root, '.github', 'workflows');
    for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const yml = fs.readFileSync(path.join(dir, f), 'utf-8');
      // node-version: 20 / '20' / "20.x" and matrix lists containing '20'
      expect(yml, f).not.toMatch(/node-version:\s*['"]?20(\.[\dx]+)*['"]?\s*$/m);
      expect(yml, f).not.toMatch(/node-version:\s*\[[^\]]*['"]?\b20(\.[\dx]+)*\b['"]?[^\]]*\]/);
    }
  });
});
