/**
 * Playwright `webServer` entrypoint. It:
 *   1. verifies the built CLI and the built desktop SPA are present (building
 *      the SPA on demand as a fallback for a standalone `cd e2e && npm test`),
 *   2. builds the hermetic fixture (indexed project + seeded transcripts),
 *   3. boots the REAL dashboard server over the built SPA and stays attached
 *      so Playwright owns the lifecycle (it polls /api/status for readiness and
 *      SIGTERMs us on teardown).
 *
 * The suite drives the built SPA (REQ-DESKTOP-032): `desktop --web-dir
 * <ui/dist>` serves ui/dist with its SPA fallback. The SPA is the dashboard's
 * only surface (REQ-DESKTOP-033 — the server-rendered dashboard retired), so
 * no flag is needed to select it.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildFixture } from '../lib/fixture.mjs';
import { BIN, FIXTURE, HOST, PORT, REPO_ROOT } from '../lib/paths.mjs';

const UI_DIR = path.join(REPO_ROOT, 'ui');
const WEB_DIR = path.join(UI_DIR, 'dist');

// The harness drives the compiled dist binary — `npm run build` must have run.
if (!fs.existsSync(BIN)) {
  console.error(`[e2e] built CLI not found at ${BIN} — run \`npm run build\` first.`);
  process.exit(1);
}

// The built SPA is what the suite exercises. The root `npm run e2e` script
// builds it up front; this fallback lets `cd e2e && npm test` work standalone
// by building it on demand (skipped when ui/dist is already present).
if (!fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  console.error('[e2e] ui/dist not found — building the desktop SPA (one-time)…');
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: UI_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(`[e2e] \`${cmd} ${args.join(' ')}\` failed while building the SPA`);
      process.exit(1);
    }
  };
  run('npm', ['ci']);
  run('npm', ['run', 'build']);
}

const env = await buildFixture();

const child = spawn(
  'node',
  [
    BIN, 'desktop',
    '--web-dir', WEB_DIR,
    '--host', HOST, '--port', String(PORT),
    '--path', FIXTURE, '--ingest', '--no-watch',
  ],
  { env, stdio: 'inherit' },
);

const shutdown = (code) => {
  try { child.kill('SIGTERM'); } catch { /* noop */ }
  process.exit(code ?? 0);
};
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
child.on('exit', (code) => process.exit(code ?? 0));
