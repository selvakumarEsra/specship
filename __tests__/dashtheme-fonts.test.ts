/**
 * REQ-DASHTHEME-002 — the dashboard uses the design system's fonts, served
 * locally: Space Grotesk (body), Bricolage Grotesque (headings + large
 * numerals), Geist Mono kept for code/IDs; old fonts gone; package within the
 * pack-guard budget.
 *
 * Build-artifact checks run against a FRESH vite build of ui/ into a temp dir
 * (so a stale ui/dist can't pass them); when ui/ deps aren't installed they
 * fall back to the shipped copy under dist/ui (built by `npm run build`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_PACKED_BYTES,
  MAX_UNPACKED_BYTES,
  MAX_FILE_COUNT,
  readPackManifest,
  repoRoot,
} from './pack-budget';
import { assertNoExternalOrigins } from '../scripts/check-ui-deps.mjs';

const uiDir = path.join(repoRoot, 'ui');
const stylesDir = path.join(uiDir, 'src', 'styles');
const snapshotDir = path.join(repoRoot, 'specs', 'dashboard-theme-bmg', 'snapshot');

const read = (p: string) => fs.readFileSync(p, 'utf8');
const sha256 = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** Families of a `--name: a, b, c;` custom property in a stylesheet. */
function customPropFamilies(css: string, name: string): string[] {
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) return [];
  return m[1]!.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
}

/** Selector lists of every rule whose body contains `decl`. */
function selectorsUsing(css: string, decl: RegExp): string[] {
  const out: string[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (decl.test(m[2]!)) out.push(...m[1]!.split(',').map((s) => s.trim()));
  }
  return out;
}

/** The snapshot's font files and their recorded SHA256SUMS digests. */
function snapshotFontSums(): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of read(path.join(snapshotDir, 'SHA256SUMS')).split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+fonts\/(.+\.woff2)$/);
    if (m) sums.set(m[2]!, m[1]!);
  }
  return sums;
}

/** Built asset matching a snapshot stem (`space-grotesk-latin.woff2` → `space-grotesk-latin-<hash>.woff2`). */
function builtFontFor(assets: string[], snapshotName: string): string | undefined {
  const stem = snapshotName.replace(/\.woff2$/, '');
  const re = new RegExp(`^${stem.replace(/[-]/g, '\\-')}(?:-[A-Za-z0-9_-]{8})?\\.woff2$`);
  return assets.find((a) => re.test(a));
}

let tmp: string | undefined;
let distDir: string;
let assetsDir: string;
let assets: string[];

beforeAll(() => {
  const vite = path.join(uiDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  if (fs.existsSync(vite)) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashtheme-fonts-'));
    execFileSync(vite, ['build', '--outDir', tmp, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: uiDir,
      // vitest exports NODE_ENV=test, which would make vite bundle React's dev
      // build; build exactly what ships.
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: process.platform === 'win32',
    });
    distDir = tmp;
  } else {
    distDir = path.join(repoRoot, 'dist', 'ui');
  }
  assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`no built dashboard at ${distDir} — run \`npm run build\` (or \`npm --prefix ui ci\`) first`);
  }
  assets = fs.readdirSync(assetsDir);
}, 180_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('REQ-DASHTHEME-002 — design-system fonts, served locally', () => {
  it('REQ-DASHTHEME-002.A1: body resolves to Space Grotesk, headings and large numerals to Bricolage Grotesque', function reqDashtheme002A1() {
    const fonts = read(path.join(stylesDir, 'fonts.css'));
    const tokens = read(path.join(stylesDir, 'tokens.css'));
    const app = read(path.join(stylesDir, 'app.css'));

    // fonts.css is imported last in main.tsx, so its :root wins; tokens.css must agree.
    for (const sheet of [fonts, tokens]) {
      expect(customPropFamilies(sheet, '--font-ui')[0]).toBe('Space Grotesk');
      expect(customPropFamilies(sheet, '--font-display')[0]).toBe('Bricolage Grotesque');
    }

    // fonts.css declares both families with the snapshot's own @font-face rules.
    const faces = [...fonts.matchAll(/@font-face\{([^}]*)\}/g)].map((m) => m[1]!);
    const snapFaces = [...read(path.join(snapshotDir, 'fonts', 'fonts.css')).matchAll(/@font-face\{([^}]*)\}/g)].map((m) => m[1]!);
    const normalize = (f: string) => f.replace(/src:url\([^)]*?([a-z-]+\.woff2)\)/, 'src:url($1)');
    expect(faces.map(normalize)).toEqual(snapFaces.map(normalize));

    // Body text takes --font-ui; headings, page titles and large numerals take --font-display.
    expect(selectorsUsing(app, /font-family:\s*var\(--font-ui\)/)).toEqual(expect.arrayContaining(['html', 'body']));
    expect(selectorsUsing(app, /font-family:\s*var\(--font-display\)/)).toEqual(
      expect.arrayContaining(['h1', 'h2', 'h3', 'h4', '.sp-title', '[data-page-title]', '.display-num']),
    );
    // The stat-tile value (the dashboard's large numeral) carries the class.
    const modules = read(path.join(uiDir, 'src', 'components', 'dashboard-modules.tsx'));
    expect(modules.match(/className="tabular display-num"/g)?.length).toBe(1);

    // The built CSS keeps the mapping.
    const builtCss = assets.filter((a) => a.endsWith('.css')).map((a) => read(path.join(assetsDir, a))).join('\n');
    expect(builtCss).toMatch(/--font-ui:\s*"Space Grotesk"/);
    expect(builtCss).toMatch(/--font-display:\s*"Bricolage Grotesque"/);
  });

  it('REQ-DASHTHEME-002.A2: the built dashboard bundles both font files (snapshot bytes) and contacts no font host', function reqDashtheme002A2() {
    const sums = snapshotFontSums();
    expect([...sums.keys()].sort()).toEqual([
      'bricolage-latin-ext.woff2',
      'bricolage-latin.woff2',
      'space-grotesk-latin-ext.woff2',
      'space-grotesk-latin.woff2',
    ]);
    for (const [name, digest] of sums) {
      const built = builtFontFor(assets, name);
      expect(built, `${name} missing from the built dashboard`).toBeDefined();
      expect(sha256(path.join(assetsDir, built!)), `${built} bytes differ from the snapshot`).toBe(digest);
    }

    // Same-origin only: no external URL anywhere in the build, and no font-service hooks.
    expect(assertNoExternalOrigins(distDir)).toEqual([]);
    const text = [
      read(path.join(distDir, 'index.html')),
      ...assets.filter((a) => /\.(css|js)$/.test(a)).map((a) => read(path.join(assetsDir, a))),
    ].join('\n');
    expect(text).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import\s+url\(\s*['"]?https?:/);
    // Every font url() in the built CSS is a root-relative asset path served by the dashboard itself.
    const css = assets.filter((a) => a.endsWith('.css')).map((a) => read(path.join(assetsDir, a))).join('\n');
    const fontUrls = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]!.replace(/['"]/g, ''));
    expect(fontUrls.length).toBeGreaterThan(0);
    for (const u of fontUrls) {
      expect(u.startsWith('/assets/')).toBe(true);
      expect(assets).toContain(u.slice('/assets/'.length));
    }
  });

  it('REQ-DASHTHEME-002.A3: code views and spec IDs render in a monospace font', function reqDashtheme002A3() {
    const fonts = read(path.join(stylesDir, 'fonts.css'));
    const app = read(path.join(stylesDir, 'app.css'));
    const mono = customPropFamilies(fonts, '--font-mono');
    expect(mono[0]).toBe('Geist Mono Variable');
    expect(mono[mono.length - 1]).toBe('monospace');
    expect(customPropFamilies(read(path.join(stylesDir, 'tokens.css')), '--font-mono').pop()).toBe('monospace');

    // .mono (IDs, symbol names, paths) and the code/textarea views use --font-mono.
    const monoSelectors = selectorsUsing(app, /font-family:\s*var\(--font-mono\)/);
    expect(monoSelectors).toContain('.mono');
    expect(monoSelectors.length).toBeGreaterThan(3);

    // The Geist Mono files ship and are referenced.
    expect(read(path.join(uiDir, 'src', 'main.tsx'))).toContain("import '@fontsource-variable/geist-mono';");
    expect(assets.some((a) => /^geist-mono-latin-wght-normal-.*\.woff2$/.test(a))).toBe(true);
  });

  it('REQ-DASHTHEME-002.A4: no previously shipped font remains in the build unless something references it', function reqDashtheme002A4() {
    // Geist sans is gone — from the build, the imports and the dependency list.
    const fontFiles = assets.filter((a) => a.endsWith('.woff2'));
    expect(fontFiles.filter((a) => /^geist-(?!mono-)/.test(a))).toEqual([]);
    const pkg = JSON.parse(read(path.join(uiDir, 'package.json')));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@fontsource-variable/geist');
    expect(read(path.join(uiDir, 'src', 'main.tsx'))).not.toMatch(/@fontsource-variable\/geist['"]/);

    // Every font file that does ship is referenced by built CSS.
    const css = assets.filter((a) => a.endsWith('.css')).map((a) => read(path.join(assetsDir, a))).join('\n');
    const unreferenced = fontFiles.filter((f) => !css.includes(`/assets/${f}`));
    expect(unreferenced).toEqual([]);

    // The only font files are the four design-system files plus Geist Mono.
    const unexpected = fontFiles.filter(
      (f) => !/^geist-mono-/.test(f) && ![...snapshotFontSums().keys()].some((n) => builtFontFor([f], n)),
    );
    expect(unexpected).toEqual([]);
  });

  it('REQ-DASHTHEME-002.A5: the published package stays within the pack-guard budget', function reqDashtheme002A5() {
    const manifest = readPackManifest();
    expect(manifest.size).toBeLessThanOrEqual(MAX_PACKED_BYTES);
    expect(manifest.unpackedSize).toBeLessThanOrEqual(MAX_UNPACKED_BYTES);
    expect(manifest.entryCount).toBeLessThanOrEqual(MAX_FILE_COUNT);
    // The shipped dashboard carries the new fonts (so the budget measured them).
    const shipped = manifest.files.map((f) => f.path).filter((p) => p.startsWith('dist/ui/assets/') && p.endsWith('.woff2'));
    for (const name of snapshotFontSums().keys()) {
      expect(builtFontFor(shipped.map((p) => path.basename(p)), name), `${name} not in the published package`).toBeDefined();
    }
  }, 180_000);
});
