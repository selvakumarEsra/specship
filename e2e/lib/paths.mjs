/**
 * Shared paths + ports for the dashboard e2e harness.
 *
 * Both the Playwright config and the fixture/serve scripts import this so the
 * port and the hermetic work dirs are defined in exactly one place.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** HTTP port the fixture server binds. Override with E2E_PORT. */
export const PORT = Number(process.env.E2E_PORT || 4319);
export const HOST = '127.0.0.1';
/** The dashboard is served (and MUST be opened) at 127.0.0.1 — that is the
 *  exact condition the same-origin/CORS dashboard-blank bug regressed on. */
export const BASE_URL = `http://${HOST}:${PORT}`;

/** e2e */
export const E2E_DIR = path.resolve(here, '..');
/** repo root (e2e/lib -> ../..) */
export const REPO_ROOT = path.resolve(here, '..', '..');
/** the built CLI the harness drives — `npm run build` must have run. */
export const BIN = path.join(REPO_ROOT, 'dist', 'bin', 'specship.js');

/** Everything the harness writes lives under here and is wiped each run. */
export const WORK = path.join(E2E_DIR, '.tmp');
/** The indexed fixture project `serve --ui --path` points at. */
export const FIXTURE = path.join(WORK, 'fixture');
/** A fake $HOME so the transcript ingest watcher reads seeded JSONL, never
 *  the developer's real ~/.claude/projects. */
export const HOME_DIR = path.join(WORK, 'home');
