/**
 * Playwright `webServer` entrypoint: build the hermetic fixture, then boot
 * `specship serve --ui` on 127.0.0.1 and stay attached so Playwright owns the
 * lifecycle (it polls /api/status for readiness and SIGTERMs us on teardown).
 */
import { spawn } from 'node:child_process';
import { buildFixture } from '../lib/fixture.mjs';
import { BIN, FIXTURE, HOST, PORT } from '../lib/paths.mjs';

const env = await buildFixture();

const child = spawn(
  'node',
  [BIN, 'serve', '--ui', '--host', HOST, '--port', String(PORT), '--path', FIXTURE, '--ingest', '--no-watch'],
  { env, stdio: 'inherit' },
);

const shutdown = (code) => {
  try { child.kill('SIGTERM'); } catch { /* noop */ }
  process.exit(code ?? 0);
};
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
child.on('exit', (code) => process.exit(code ?? 0));
