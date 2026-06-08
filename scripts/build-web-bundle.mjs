#!/usr/bin/env node
/**
 * Build the SpecShip Desktop Angular UI and copy the production bundle into
 * the root's `dist/web/` so it ships with the npm tarball.
 *
 * - Skipped when `--skip-build` (or env `SPECSHIP_SKIP_WEB_BUILD`) is set
 *   — convenient for the GitHub Actions release path which builds the SPA
 *   in a separate matrix step.
 * - Builds production by default. Set `SPECSHIP_WEB_CONFIG=development`
 *   to use a faster dev config (no minification, useful for local trial).
 *
 * The Angular build itself has no runtime Node deps; the output under
 * `packages/web-ng/dist/web-ng/browser/` is plain HTML/CSS/JS + fonts +
 * favicons. `@fastify/static` serves them as-is.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const webPkg = path.resolve(root, 'packages', 'web-ng');
const webDist = path.join(webPkg, 'dist', 'web-ng', 'browser');
const outDir = path.join(root, 'dist', 'web');
const skip = process.argv.includes('--skip-build') || process.env['SPECSHIP_SKIP_WEB_BUILD'] === '1';
const config = process.env['SPECSHIP_WEB_CONFIG'] ?? 'production';

if (!existsSync(webPkg)) {
  console.error(`[build-web-bundle] expected ${webPkg} but not found`);
  process.exit(1);
}

if (!skip) {
  console.log(`[build-web-bundle] building Angular UI (configuration=${config})`);
  const ngBin = process.platform === 'win32'
    ? path.join(webPkg, 'node_modules', '.bin', 'ng.cmd')
    : path.join(webPkg, 'node_modules', '.bin', 'ng');
  if (!existsSync(ngBin)) {
    console.error(`[build-web-bundle] Angular CLI not found at ${ngBin} — run \`cd packages/web-ng && npm install\` first`);
    process.exit(1);
  }
  execFileSync(ngBin, ['build', '--configuration', config], { stdio: 'inherit', cwd: webPkg });
}

if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error(`[build-web-bundle] no index.html at ${path.relative(root, webDist)} — Angular build did not produce a browser bundle`);
  process.exit(1);
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else if (ent.isFile()) await fs.copyFile(s, d);
  }
}

await fs.rm(outDir, { recursive: true, force: true });
await copyDir(webDist, outDir);

const entries = await fs.readdir(outDir);
console.log(`[build-web-bundle] copied ${entries.length} entries → dist/web/`);
