/**
 * REQ-DESKTOP-017 — the ui/ module's build guard (scripts/check-ui-deps.mjs).
 *
 *   A2/A5: runtime deps exactly react + react-dom; any extra fails the check.
 *   A3:    lockfile is registry-only (no git/tarball/http URLs, no
 *          non-allowlisted install scripts).
 *   A4:    built assets reference zero external origins.
 *
 * Plus a source-level sweep: ui/src imports nothing but react/react-dom and
 * its own modules — charts, icons, and the graph are in-module SVG, not a
 * third-party chart/component/CSS package.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

// @ts-expect-error — plain .mjs module without type declarations.
import {
  assertRuntimeDepsAllowlist,
  assertRegistryLockfile,
  assertNoExternalOrigins,
  assertNoMockDataset,
  assertInitialJsBudget,
  measureInitialJsGzip,
} from '../scripts/check-ui-deps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(root, 'ui');

let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guard-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function writeJson(rel: string, value: unknown): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

describe('runtime dependency allowlist (A2/A5)', () => {
  it('passes on the real ui/package.json', () => {
    expect(assertRuntimeDepsAllowlist(path.join(uiDir, 'package.json'))).toEqual([]);
  });

  it('fails when a runtime dependency beyond the allowlist appears', () => {
    const p = writeJson('extra-dep.json', {
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', recharts: '^2.0.0' },
    });
    const errors = assertRuntimeDepsAllowlist(p) as string[];
    expect(errors.some((e) => e.includes('recharts'))).toBe(true);
  });

  it('fails when an expected runtime dependency is missing', () => {
    const p = writeJson('missing-dep.json', { dependencies: { react: '^18.3.1' } });
    const errors = assertRuntimeDepsAllowlist(p) as string[];
    expect(errors.some((e) => e.includes('react-dom'))).toBe(true);
  });

  it('fails on smuggled optionalDependencies', () => {
    const p = writeJson('optional-dep.json', {
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      optionalDependencies: { fsevents: '^2.3.3' },
    });
    const errors = assertRuntimeDepsAllowlist(p) as string[];
    expect(errors.some((e) => e.includes('optionalDependencies'))).toBe(true);
  });
});

describe('registry-safe lockfile (A3)', () => {
  it('passes on the real ui/package-lock.json', () => {
    const lockPath = path.join(uiDir, 'package-lock.json');
    expect(fs.existsSync(lockPath), 'ui/package-lock.json must be committed').toBe(true);
    expect(assertRegistryLockfile(lockPath)).toEqual([]);
  });

  it('flags git and plain-http resolutions', () => {
    const p = writeJson('bad-lock.json', {
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture' },
        'node_modules/left-pad': { resolved: 'git+ssh://git@github.com/x/left-pad.git#abc' },
        'node_modules/right-pad': { resolved: 'http://internal.example.com/right-pad-1.0.0.tgz' },
        'node_modules/react': { resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz' },
      },
    });
    const errors = assertRegistryLockfile(p) as string[];
    expect(errors.some((e) => e.startsWith('left-pad'))).toBe(true);
    expect(errors.some((e) => e.startsWith('right-pad'))).toBe(true);
    expect(errors.some((e) => e.startsWith('react:'))).toBe(false);
  });

  it('flags non-allowlisted install scripts', () => {
    const p = writeJson('script-lock.json', {
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture' },
        'node_modules/sketchy': {
          resolved: 'https://registry.npmjs.org/sketchy/-/sketchy-1.0.0.tgz',
          hasInstallScript: true,
        },
      },
    });
    const errors = assertRegistryLockfile(p) as string[];
    expect(errors.some((e) => e.includes('sketchy') && e.includes('install script'))).toBe(true);
  });
});

describe('zero external origins in built assets (A4)', () => {
  it('flags a CDN font reference', () => {
    const dist = path.join(tmp, 'dist-cdn');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      '<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">',
    );
    const errors = assertNoExternalOrigins(dist) as string[];
    expect(errors.some((e) => e.includes('fonts.googleapis.com'))).toBe(true);
  });

  it('passes clean output and tolerates inert namespace/loopback URLs', () => {
    const dist = path.join(tmp, 'dist-clean');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<script src="./assets/index-abc.js"></script>');
    fs.writeFileSync(
      path.join(dist, 'assets', 'index-abc.js'),
      'const ns="http://www.w3.org/2000/svg";const err="https://reactjs.org/docs/error-decoder.html";fetch("http://127.0.0.1:4242/api/status")',
    );
    // Binary assets (fonts) are not text-scanned — bytes may coincidentally match URLs.
    fs.writeFileSync(path.join(dist, 'assets', 'geist.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
    expect(assertNoExternalOrigins(dist)).toEqual([]);
  });

  it('passes on the real ui/dist when it has been built', () => {
    const dist = path.join(uiDir, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) return; // not built in this checkout — the ui build itself enforces this
    expect(assertNoExternalOrigins(dist)).toEqual([]);
  });
});

describe('initial JS budget (REQ-DESKTOP-031.A1)', () => {
  function distWith(jsFiles: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsbudget-'));
    const assets = path.join(dir, 'assets');
    fs.mkdirSync(assets);
    for (const [name, body] of Object.entries(jsFiles)) fs.writeFileSync(path.join(assets, name), body);
    return dir;
  }

  it('passes a small bundle and reports the gzipped total', () => {
    const dir = distWith({ 'index-abc.js': 'console.log("small app")\n'.repeat(50) });
    const { totalGzip } = assertInitialJsBudget(dir, 250 * 1024);
    expect(totalGzip).toBeGreaterThan(0);
    expect(totalGzip).toBeLessThan(250 * 1024);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when the gzipped initial JS exceeds the budget', () => {
    // Any real JS file blows a 10-byte budget — asserts the guard fires and
    // names the overage, independent of how well the fixture compresses.
    const dir = distWith({ 'index-big.js': 'export const app = () => "hello world";\n'.repeat(20) });
    expect(() => assertInitialJsBudget(dir, 10)).toThrow(/exceeds the .* budget/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the real built ui/dist is within budget (when built)', () => {
    const distAssets = path.join(uiDir, 'dist', 'assets');
    if (!fs.existsSync(distAssets)) return; // ui not built in this run — skip
    const { totalGzip } = measureInitialJsGzip(path.join(uiDir, 'dist'));
    expect(totalGzip).toBeLessThanOrEqual(250 * 1024);
  });
});

describe('no mock dataset in ui/src (REQ-DESKTOP-030.A4)', () => {
  it('passes on the real ui/src — the design bundle mock dataset is never wired in', () => {
    expect(assertNoMockDataset(path.join(uiDir, 'src'))).toEqual([]);
  });

  it('flags a fixture that imports the design bundle mock data.js', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockimport-'));
    fs.writeFileSync(path.join(dir, 'bad.tsx'), `import { DATA } from '../specs/specship-desktop/data.js';\nexport const x = DATA;\n`);
    const errors = assertNoMockDataset(dir);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/mock dataset/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags a fixture that reads window.DATA (the mock global) but not a doc comment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockglobal-'));
    fs.writeFileSync(path.join(dir, 'bad.ts'), `export const n = window.DATA.status.nodes;\n`);
    fs.writeFileSync(path.join(dir, 'ok.ts'), `// historical note: the design bundle attached window.DATA\nexport const n = 1;\n`);
    const errors = assertNoMockDataset(dir);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/window\.DATA/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('ui/src imports only react + its own modules (A2)', () => {
  // CSS-only self-hosted font assets from devDependencies are the single
  // non-react bare import the source may use (REQ-DESKTOP-017.A4).
  const ALLOWED_BARE = [/^react(\/|$)/, /^react-dom(\/|$)/, /^@fontsource-variable\//];

  function* walk(dir: string): Generator<string> {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) yield* walk(p);
      else yield p;
    }
  }

  it('has no third-party chart/component/CSS package imports', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(uiDir, 'src'))) {
      if (!/\.(ts|tsx|css)$/.test(file)) continue;
      // Test files never enter the vite bundle (only index.html-reachable
      // modules do) — their vitest/testing-library devDep imports are not
      // runtime payload, which is what this guard protects.
      if (/\.test\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      const body = fs.readFileSync(file, 'utf8');
      const specifiers = [
        ...[...body.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1]!),
        ...[...body.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!),
      ];
      for (const spec of specifiers) {
        if (spec.startsWith('.') || spec.startsWith('/')) continue;
        if (ALLOWED_BARE.some((re) => re.test(spec))) continue;
        offenders.push(`${path.relative(uiDir, file)} imports "${spec}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
