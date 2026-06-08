#!/usr/bin/env node
/**
 * Copy the built Angular UI (packages/web-ng/dist/web-ng/browser) into the
 * server package's `public/web/` so it ships as part of the npm tarball.
 *
 * Run after `npm run build:web && npm run build`. The CLI auto-detects this
 * location at startup so `specship-desktop` Just Works once installed.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPkg = path.resolve(here, '..');
const webBuild = path.resolve(serverPkg, '..', 'web-ng', 'dist', 'web-ng', 'browser');
const dest = path.resolve(serverPkg, 'public', 'web');

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

async function main() {
  try {
    await fs.access(path.join(webBuild, 'index.html'));
  } catch {
    console.error(`[copy-web] No build at ${webBuild}. Run \`npm run build:web\` first.`);
    process.exit(1);
  }
  try {
    await fs.rm(dest, { recursive: true, force: true });
  } catch { /* ignore */ }
  await copyDir(webBuild, dest);
  const out = await fs.readdir(dest);
  console.log(`[copy-web] copied ${out.length} entries → ${path.relative(serverPkg, dest)}`);
}

main().catch((err) => {
  console.error('[copy-web] failed:', err);
  process.exit(1);
});
