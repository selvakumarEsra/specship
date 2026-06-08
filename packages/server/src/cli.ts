#!/usr/bin/env node
/**
 * Standalone CLI entry for the specship HTTP server + Angular UI.
 *
 *   specship-desktop --project-root /path/to/project [--port 4242]
 *
 * When the bundled web UI is present, the same process serves the SPA at /
 * and the API at /api/*. Pass `--no-web` to run headless (API only) or
 * `--web-dir <path>` to point at a custom build.
 *
 * The JSONL ingest watcher is started inside `createServer()` by default —
 * pass `--no-ingest` to disable.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from './server.js';

interface CliArgs {
  /** May be null — server then boots projectless (UI picker chooses). */
  projectRoot: string | null;
  host: string;
  port: number;
  ingest: boolean;
  verbose: boolean;
  webDir: string | null;
  noWeb: boolean;
  open: boolean;
}

function parseArgs(): CliArgs {
  const envRoot = process.env.SPECSHIP_PROJECT_ROOT ?? process.env.SPECSHIP_PROJECT_ROOT ?? null;
  const args: CliArgs = {
    projectRoot: envRoot,
    host: '127.0.0.1',
    port: 4242,
    ingest: true,
    verbose: false,
    webDir: null,
    noWeb: false,
    open: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root' || a === '-p') args.projectRoot = argv[++i] ?? args.projectRoot;
    else if (a === '--port') args.port = parseInt(argv[++i] ?? '4242', 10) || 4242;
    else if (a === '--host') args.host = argv[++i] ?? args.host;
    else if (a === '--no-ingest') args.ingest = false;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--web-dir') args.webDir = argv[++i] ?? null;
    else if (a === '--no-web') args.noWeb = true;
    else if (a === '--open') args.open = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: specship-desktop [options]

Options:
  --project-root, -p <path>   Project root (default: $SPECSHIP_PROJECT_ROOT, $SPECSHIP_PROJECT_ROOT, or cwd)
  --port <n>                  HTTP port (default: 4242)
  --host <h>                  Bind host (default: 127.0.0.1)
  --no-ingest                 Skip the in-process Claude JSONL transcript watcher
  --web-dir <path>            Explicit path to a built Angular UI (index.html lives here)
  --no-web                    Run headless — serve the API only, no SPA
  --open                      Open the UI in the default browser once listening
  --verbose, -v               Verbose logs`);
      process.exit(0);
    }
  }
  return args;
}

/**
 * Locate the built Angular UI. Tries (in order):
 *   1. Explicit --web-dir / env var
 *   2. Sibling `public/web/` next to the running script (production layout)
 *   3. Sibling `../web-ng/dist/web-ng/browser/` (monorepo dev layout)
 *   4. Walk up looking for `packages/web-ng/dist/web-ng/browser/`
 * Returns null when nothing is found — the server then runs API-only.
 */
function locateWebDir(explicit: string | null): string | null {
  const envDir = process.env.SPECSHIP_WEB_DIR ?? process.env.SPECSHIP_WEB_DIR;
  const candidates: string[] = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (envDir) candidates.push(path.resolve(envDir));

  // __dirname equivalent in ESM
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Production layout: <pkg>/dist/cli.js, UI shipped at <pkg>/public/web/
  candidates.push(path.resolve(here, '..', 'public', 'web'));
  candidates.push(path.resolve(here, '..', '..', 'public', 'web'));
  // Monorepo dev layout: packages/server/dist/cli.js → packages/web-ng/dist/web-ng/browser
  candidates.push(path.resolve(here, '..', '..', 'web-ng', 'dist', 'web-ng', 'browser'));
  candidates.push(path.resolve(here, '..', '..', '..', 'web-ng', 'dist', 'web-ng', 'browser'));

  // Walk up from cwd looking for the monorepo layout (handy when run via npx
  // inside a checkout).
  let cur = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    candidates.push(path.join(cur, 'packages', 'web-ng', 'dist', 'web-ng', 'browser'));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  for (const c of candidates) {
    if (existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

function tryOpenInBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    // best-effort; ignore failure
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const webDir = args.noWeb ? null : locateWebDir(args.webDir);

  const handle = await createServer({
    projectRoot: args.projectRoot ?? undefined,
    host: args.host,
    port: args.port,
    ingest: args.ingest,
    verbose: args.verbose,
    webDir,
  });

  console.error(`[specship-desktop] listening on ${handle.url}`);
  if (args.projectRoot) {
    console.error(`[specship-desktop] project: ${args.projectRoot}`);
  } else {
    console.error(`[specship-desktop] project: (none — pick one in the desktop UI)`);
  }
  if (webDir) console.error(`[specship-desktop] UI:      ${webDir}`);
  else console.error(`[specship-desktop] UI:      (none — running headless)`);
  if (args.ingest) console.error(`[specship-desktop] Claude Code transcript ingest active`);

  if (args.open) tryOpenInBrowser(handle.url);

  const shutdown = async () => {
    console.error('[specship-desktop] shutting down');
    await handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  console.error('[specship-desktop] startup failed:', err);
  process.exit(1);
});
