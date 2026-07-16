#!/usr/bin/env node
/**
 * SpecShip CLI
 *
 * Command-line interface for SpecShip code intelligence.
 *
 * Usage:
 *   specship                    Run interactive installer (when no args)
 *   specship install            Run interactive installer
 *   specship uninstall          Remove SpecShip from your agents
 *   specship init [path]        Initialize SpecShip in a project
 *   specship uninit [path]      Remove SpecShip from a project
 *   specship index [path]       Index all files in the project
 *   specship sync [path]        Sync changes since last index
 *   specship status [path]      Show index status
 *   specship query <search>     Search for symbols
 *   specship files [options]    Show project file structure
 *   specship context <task>     Build context for a task
 *   specship callers <symbol>   Find what calls a function/method
 *   specship callees <symbol>   Find what a function/method calls
 *   specship impact <symbol>    Analyze what code is affected by changing a symbol
 *   specship affected [files]   Find test files affected by changes
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getSpecShipDir, isInitialized } from '../directory';
import { detectWorktreeIndexMismatch, worktreeMismatchWarning } from '../sync/worktree';
import { createShimmerProgress } from '../ui/shimmer-progress';
import { getGlyphs } from '../ui/glyphs';

import { buildNode25BlockBanner, buildNodeTooOldBanner, MIN_NODE_MAJOR } from './node-version-check';
import { runUpdate, detectInstallMethod, type InstallMethod } from '../update/updater';
import { resolveLatestVersion } from '../update/resolve-latest';
import { runInstaller } from '../update/run-installer';
import { relaunchWithWasmRuntimeFlagsIfNeeded } from '../extraction/wasm-runtime-flags';

// Lazy-load heavy modules (SpecShip, runInstaller) to keep CLI startup fast.
async function loadSpecShip(): Promise<typeof import('../index')> {
  try {
    return await import('../index');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m${getGlyphs().err}\x1b[0m Failed to load SpecShip modules.`);
    console.error(`\n  Node: ${process.version}  Platform: ${process.platform} ${process.arch}`);
    console.error(`\n  Error: ${msg}`);
    console.error('\n  Try reinstalling with: npm install -g @specship/specship\n');
    process.exit(1);
  }
}

/**
 * Lazy-load the HTTP server package. Tries (in order):
 *   1. Installed npm dependency `@specship/specship-server`
 *   2. Dev sibling at `<repoRoot>/server/dist/index.js`
 *
 * Errors are surfaced with a hint about which install/build step is missing.
 */
interface ServerHandleLike { url: string; port: number; host: string; stop: () => Promise<void> }
interface ServerPackage {
  createServer: (opts: {
    /** Optional — server boots projectless when omitted; UI picks one. */
    projectRoot?: string;
    host?: string;
    port?: number;
    ingest?: boolean;
    /** Built desktop SPA dir; when set the server serves the SPA. */
    webDir?: string | null;
    watcher?: { stop: () => void; ingestNow: () => unknown } | null;
    verbose?: boolean;
  }) => Promise<ServerHandleLike>;
}

async function loadServerPackage(): Promise<ServerPackage> {
  // Resolution order:
  //   1. Bundled mode — `dist/server/index.js` next to this CLI. This is
  //      what every `npm i -g @specship/specship` install hits, since
  //      the publish pipeline copies the compiled server into the root's
  //      `dist/`.
  //   2. npm dep `@specship/specship-server` if some downstream
  //      consumer ever wires it as a separate package (kept for forward
  //      compatibility — not the shipped path).
  //   3. Dev/workspace sibling: `server/dist/index.js` for
  //      running from a checkout without a prior `npm run build`.
  const candidates: string[] = [
    path.resolve(__dirname, '..', 'server', 'index.js'),
    '@specship/specship-server',
    path.resolve(__dirname, '..', '..', 'server', 'dist', 'index.js'),
    path.resolve(__dirname, '..', '..', '..', 'server', 'dist', 'index.js'),
  ];
  let lastErr: unknown = null;
  for (const c of candidates) {
    try {
      return (await import(c)) as ServerPackage;
    } catch (e) { lastErr = e; }
  }
  console.error(`\x1b[31m${getGlyphs().err}\x1b[0m Could not load the bundled HTTP server. Re-run \`npm run build\` (or the bundled npm install is corrupt).`);
  if (lastErr) console.error('  ' + (lastErr instanceof Error ? lastErr.message : String(lastErr)));
  process.exit(1);
}

/**
 * The JSONL ingest watcher now ships inside `@specship/specship-server`
 * itself — `createServer({ ingest: true })` starts it. No separate package.
 */

/**
 * Claude Code's slug encoding (every non-alphanumeric char → '-') is lossy,
 * so decoding by mapping '-' back to '/' mangles any path containing
 * hyphens/dots/underscores. Recover real paths from `~/.claude.json` (its
 * `projects` object is keyed by real absolute paths), then from a `"cwd"`
 * value in the slug's newest transcript, before falling back to the lossy
 * decode. Mirrors `server/src/ingest/project-paths.ts`
 * (REQ-SLUGRES-004) — the server package depends on this one, so the CLI
 * can't import it.
 */
function buildClaudeSlugIndex(): Map<string, string> {
  const bySlug = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8');
    const parsed = JSON.parse(raw) as { projects?: Record<string, unknown> };
    for (const realPath of Object.keys(parsed.projects ?? {})) {
      bySlug.set(realPath.replace(/[^A-Za-z0-9]/g, '-'), realPath);
    }
  } catch { /* missing or malformed — sniff/fallback below still work */ }
  return bySlug;
}

function sniffClaudeSlugCwd(claudeRoot: string, slug: string): string | null {
  const dir = path.join(claudeRoot, slug);
  let newest: { file: string; mtimeMs: number } | null = null;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.toLowerCase().endsWith('.jsonl')) continue;
      const st = fs.statSync(path.join(dir, f.name));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { file: f.name, mtimeMs: st.mtimeMs };
    }
  } catch { return null; }
  if (!newest) return null;
  try {
    const fd = fs.openSync(path.join(dir, newest.file), 'r');
    let chunk: string;
    try {
      const buf = Buffer.alloc(64 * 1024);
      const read = fs.readSync(fd, buf, 0, buf.length, 0);
      chunk = buf.toString('utf8', 0, read);
    } finally { fs.closeSync(fd); }
    const m = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
    if (!m) return null;
    let cwd = JSON.parse(`"${m[1]}"`) as string;
    // Accept the cwd or an ancestor of it — sessions may record a subdir.
    for (; ;) {
      if (cwd.replace(/[^A-Za-z0-9]/g, '-') === slug) return cwd;
      const parent = path.dirname(cwd);
      if (parent === cwd) return null;
      cwd = parent;
    }
  } catch { return null; }
}

/**
 * Auto-pick a default project for `specship serve --ui` when the user
 * didn't pass `-p` and the cwd isn't initialized either. Walks
 * `~/.claude/projects/*` (Claude Code's per-project transcript dirs),
 * resolves each slug back to a real path, and returns the most-recently-
 * touched one that's still on disk AND has been `specship init`'d.
 *
 * Returns null when nothing qualifies — the server boots projectless and
 * the desktop UI prompts the user to pick.
 */
async function pickRecentInitializedProject(): Promise<string | null> {
  const claudeRoot = path.join(os.homedir(), '.claude', 'projects');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(claudeRoot, { withFileTypes: true });
  } catch { return null; }
  const slugIndex = buildClaudeSlugIndex();
  type Candidate = { decoded: string; lastTouched: number };
  const candidates: Candidate[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    const decoded =
      slugIndex.get(slug) ??
      sniffClaudeSlugCwd(claudeRoot, slug) ??
      (slug.startsWith('-') ? '/' + slug.slice(1).replace(/-/g, '/') : slug);
    try {
      const st = fs.statSync(decoded);
      if (!st.isDirectory()) continue;
    } catch { continue; }
    if (!isInitialized(decoded)) continue;
    // Use the newest .jsonl mtime in the slug dir as the activity signal.
    let lastTouched = 0;
    try {
      const files = fs.readdirSync(path.join(claudeRoot, slug), { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.toLowerCase().endsWith('.jsonl')) continue;
        try {
          const st = fs.statSync(path.join(claudeRoot, slug, f.name));
          if (st.mtimeMs > lastTouched) lastTouched = st.mtimeMs;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    candidates.push({ decoded, lastTouched });
  }
  candidates.sort((a, b) => b.lastTouched - a.lastTouched);
  return candidates[0]?.decoded ?? null;
}

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

// Block SpecShip on Node.js 25.x — V8's turboshaft WASM JIT has a Zone
// allocator bug that reliably crashes when compiling tree-sitter
// grammars (see #54, #81, #140). The previous behaviour was a soft
// console.warn that scrolls off-screen before the OOM crash 30 seconds
// later, leading to a steady stream of "what is this OOM" reports.
// Hard-exit before any WASM work; allow override via env var for users
// who patched V8 themselves or want to test a future fix.
const nodeVersion = process.versions.node;
const nodeMajor = parseInt(nodeVersion.split('.')[0] ?? '0', 10);
if (nodeMajor >= 25) {
  process.stderr.write(buildNode25BlockBanner(nodeVersion) + '\n');
  if (!process.env.SPECSHIP_ALLOW_UNSAFE_NODE) {
    process.exit(1);
  }
  // Override active — banner shown for visibility, continuing.
}
// Enforce the supported Node floor. `engines` in package.json only *warns* on
// install (unless engine-strict), so hard-block here to actually keep users off
// unsupported versions. Mirrors the 25+ block above. See package.json `engines`.
if (nodeMajor < MIN_NODE_MAJOR) {
  process.stderr.write(buildNodeTooOldBanner(nodeVersion) + '\n');
  if (!process.env.SPECSHIP_ALLOW_UNSAFE_NODE) {
    process.exit(1);
  }
  // Override active — banner shown for visibility, continuing.
}

// Re-exec with V8's `--liftoff-only` if it isn't already set, so tree-sitter's
// large WASM grammars never hit the turboshaft Zone OOM (`Fatal process out of
// memory: Zone`) on Node >= 22. No-op under the bundled launcher, which already
// passes the flag. Must run before any grammar (in the parse worker, which
// inherits this process's flags) is compiled. See ../extraction/wasm-runtime-flags.
relaunchWithWasmRuntimeFlagsIfNeeded(__filename);

// Check if running with no arguments - run installer
if (process.argv.length === 2) {
  import('../installer').then(({ runInstaller }) =>
    runInstaller()
  ).catch((err) => {
    console.error('Installation failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  // Normal CLI flow
  main();
}

process.on('uncaughtException', (error) => {
  console.error('[SpecShip] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[SpecShip] Unhandled rejection:', reason);
});

function main() {

const program = new Command();

// Version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')
);

// =============================================================================
// ANSI Color Helpers (avoid chalk ESM issues)
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const chalk = {
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  white: (s: string) => `${colors.white}${s}${colors.reset}`,
  gray: (s: string) => `${colors.gray}${s}${colors.reset}`,
};

program
  .name('specship')
  .description('Code intelligence and knowledge graph for any codebase')
  .version(packageJson.version);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve project path from argument or current directory
 * Walks up parent directories to find nearest initialized SpecShip project
 * (must have .specship/specship.db, not just .specship/lessons.db)
 */
function resolveProjectPath(pathArg?: string): string {
  const absolutePath = path.resolve(pathArg || process.cwd());

  // If exact path is initialized (has specship.db), use it
  if (isInitialized(absolutePath)) {
    return absolutePath;
  }

  // Walk up to find nearest parent with SpecShip initialized
  // Note: findNearestSpecShipRoot finds any .specship folder, but we need one with specship.db
  let current = absolutePath;
  const root = path.parse(current).root;

  while (current !== root) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;

    if (isInitialized(current)) {
      return current;
    }
  }

  // Not found - return original path (will fail later with helpful error)
  return absolutePath;
}

/**
 * Format a number with commas
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format duration in milliseconds to human readable
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

// Shimmer progress renderer (runs in a worker thread for smooth animation)
// Imported at top of file from '../ui/shimmer-progress'

/**
 * Create a plain-text progress callback for --verbose mode.
 * No animations, no ANSI tricks — just timestamped lines to stdout.
 */
function createVerboseProgress(): (progress: { phase: string; current: number; total: number; currentFile?: string }) => void {
  let lastPhase = '';
  let lastPct = -1;
  const startTime = Date.now();

  return (progress) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (progress.phase !== lastPhase) {
      lastPhase = progress.phase;
      lastPct = -1;
      console.log(`[${elapsed}s] Phase: ${progress.phase}`);
    }

    if (progress.total > 0) {
      const pct = Math.floor((progress.current / progress.total) * 100);
      // Log every 5% to keep output manageable
      if (pct >= lastPct + 5 || progress.current === progress.total) {
        lastPct = pct;
        console.log(`[${elapsed}s]   ${progress.current}/${progress.total} (${pct}%)${progress.currentFile ? ` ${getGlyphs().dash} ${progress.currentFile}` : ''}`);
      }
    } else if (progress.current > 0) {
      // Scanning phase (no total yet) — log periodically
      if (progress.current % 1000 === 0 || progress.current === 1) {
        console.log(`[${elapsed}s]   ${formatNumber(progress.current)} files found`);
      }
    }
  };
}

/**
 * Print success message
 */
function success(message: string): void {
  console.log(chalk.green(getGlyphs().ok) + ' ' + message);
}

/**
 * Print error message
 */
function error(message: string): void {
  console.error(chalk.red(getGlyphs().err) + ' ' + message);
}

/**
 * Print info message
 */
function info(message: string): void {
  console.log(chalk.blue(getGlyphs().info) + ' ' + message);
}

/**
 * Print warning message
 */
function warn(message: string): void {
  console.log(chalk.yellow(getGlyphs().warn) + ' ' + message);
}

/**
 * Render a smoke-check result (INSTALL-HANDSHAKE-DOC) as ✓/✗ lines with
 * remediation. A failing blocking item is red; a failing non-blocking item is a
 * yellow bullet. Shared by `install` (advisory) and `doctor` (gating).
 */
function renderSmokeCheck(result: import('../health/smoke-check').SmokeCheckResult): void {
  const g = getGlyphs();
  for (const item of result.items) {
    const mark = item.ok
      ? chalk.green(g.ok)
      : item.blocking
        ? chalk.red(g.err)
        : chalk.yellow(g.warn);
    console.log(`  ${mark} ${item.label.padEnd(26)} ${chalk.dim(item.detail)}`);
    if (!item.ok && item.remediation) console.log(chalk.dim(`        ${item.remediation}`));
  }
}

/**
 * Initialize + build the index for a project (REQ-HANDSHAKE-004 offer). Mirrors
 * the `init` command's default-index behaviour with the shimmer progress.
 */
async function buildProjectIndex(projectRoot: string): Promise<void> {
  const { default: SpecShip } = await loadSpecShip();
  const cg = await SpecShip.init(projectRoot, { index: false });
  const progress = createShimmerProgress();
  let stopped = false;
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      await progress.stop();
    }
  };
  try {
    await cg.indexAll({ onProgress: progress.onProgress });
    await stop();
    await printStarterPrompt(cg);
  } finally {
    await stop();
    cg.destroy();
  }
}

/**
 * Print the manufactured first-run flow/impact prompt (REQ-ACTIVATION-002.A1):
 * the closing line of `init` / the install index step. No-op when the graph
 * yields no confidently-good prompt.
 */
async function printStarterPrompt(cg: import('../index').SpecShip): Promise<void> {
  try {
    const { generateStarterPrompt } = await import('../activation/starter-prompt');
    const sp = generateStarterPrompt(cg);
    if (!sp) return;
    console.log();
    console.log(chalk.bold('Try this first — ask Claude:'));
    console.log('  ' + chalk.cyan(sp.prompt));
    console.log(chalk.dim("  (it'll explore the index instead of reading files)"));
  } catch {
    /* best effort — never block init on the suggestion */
  }
}

type IndexResult = {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  nodesCreated: number;
  edgesCreated: number;
  errors: Array<{ message: string; filePath?: string; severity: string; code?: string }>;
  durationMs: number;
};

/**
 * Print indexing results using clack log methods
 */
function printIndexResult(clack: typeof import('@clack/prompts'), result: IndexResult, projectPath?: string): void {
  const hasErrors = result.filesErrored > 0;

  // Surface non-file-level failures (e.g. lock-acquisition failure
  // when another indexer is running) before the file-count branches.
  // Without this the CLI falls through to "No files found to index",
  // which is actively misleading — the index DID run, it just couldn't
  // get the lock.
  //
  // If success is false but no severity:'error' entry exists in
  // `result.errors` (degenerate case — shouldn't happen in practice
  // but worth guarding because the result shape is plumbed through
  // multiple call sites), fall back to a generic message rather than
  // continuing to the misleading "No files found" branch or throwing.
  if (!result.success && !hasErrors && result.filesIndexed === 0) {
    const generic = result.errors.find((e) => e.severity === 'error');
    clack.log.error(generic?.message ?? `Indexing failed ${getGlyphs().dash} no further details available`);
    return;
  }

  if (result.filesIndexed > 0) {
    if (hasErrors) {
      clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} could not be parsed)`);
    } else {
      clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files`);
    }
    clack.log.info(`${formatNumber(result.nodesCreated)} nodes, ${formatNumber(result.edgesCreated)} edges in ${formatDuration(result.durationMs)}`);
  } else if (hasErrors) {
    clack.log.error(`Indexing failed ${getGlyphs().dash} all ${formatNumber(result.filesErrored)} files had errors`);
  } else {
    clack.log.warn('No files found to index');
  }

  if (hasErrors) {
    const errorsByCode = new Map<string, number>();
    for (const err of result.errors) {
      if (err.severity === 'error') {
        const code = err.code || 'unknown';
        errorsByCode.set(code, (errorsByCode.get(code) || 0) + 1);
      }
    }

    const codeLabels: Record<string, string> = {
      parse_error: 'files failed to parse',
      read_error: 'files could not be read',
      size_exceeded: 'files exceeded size limit',
      path_traversal: 'blocked paths',
      unsupported_language: 'unsupported language',
      parser_error: 'parser initialization failures',
    };

    const breakdown = Array.from(errorsByCode)
      .map(([code, count]) => `${formatNumber(count)} ${codeLabels[code] || code}`)
      .join('\n');
    clack.note(breakdown, 'Error breakdown');

    if (projectPath) {
      writeErrorLog(projectPath, result.errors);
      clack.log.info('See .specship/errors.log for details');
    }

    if (result.filesIndexed > 0) {
      clack.log.info(`The index is fully usable ${getGlyphs().dash} only the failed files are missing.`);
    }
  } else if (projectPath) {
    const logPath = path.join(getSpecShipDir(projectPath), 'errors.log');
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
  }
}

/**
 * Write detailed error log into the project's SpecShip data dir.
 * Path follows whichever layout is active (home folder by default).
 */
function writeErrorLog(projectPath: string, errors: Array<{ message: string; filePath?: string; severity: string; code?: string }>): void {
  const cgDir = getSpecShipDir(projectPath);
  if (!fs.existsSync(cgDir)) return;

  const logPath = path.join(cgDir, 'errors.log');

  // Group errors by file path
  const errorsByFile = new Map<string, Array<{ message: string; code?: string }>>();
  const noFileErrors: Array<{ message: string; code?: string }> = [];

  for (const err of errors) {
    if (err.severity !== 'error') continue;
    if (err.filePath) {
      let list = errorsByFile.get(err.filePath);
      if (!list) {
        list = [];
        errorsByFile.set(err.filePath, list);
      }
      list.push({ message: err.message, code: err.code });
    } else {
      noFileErrors.push({ message: err.message, code: err.code });
    }
  }

  const lines: string[] = [
    `SpecShip Error Log - ${new Date().toISOString()}`,
    `${errorsByFile.size} files with errors`,
    '',
  ];

  for (const [filePath, fileErrors] of errorsByFile) {
    for (const err of fileErrors) {
      lines.push(`${filePath}: ${err.message}`);
    }
  }

  for (const err of noFileErrors) {
    lines.push(err.message);
  }

  fs.writeFileSync(logPath, lines.join('\n') + '\n');
}

// =============================================================================
// Commands
// =============================================================================

/**
 * specship init [path]
 */
program
  .command('init [path]')
  .description('Initialize SpecShip in a project directory and build the initial index')
  .option('-i, --index', 'Deprecated: indexing now runs by default; flag accepted for backward compatibility')
  .option('-v, --verbose', 'Show detailed worker lifecycle and memory info')
  .action(async (pathArg: string | undefined, options: { index?: boolean; verbose?: boolean }) => {
    const projectPath = path.resolve(pathArg || process.cwd());
    const clack = await importESM('@clack/prompts');

    clack.intro('Initializing SpecShip');

    try {
      if (isInitialized(projectPath)) {
        clack.log.warn(`Already initialized in ${projectPath}`);
        clack.log.info('Use "specship index" to re-index or "specship sync" to update');
        try {
          const { offerWatchFallback } = await import('../installer');
          await offerWatchFallback(clack, projectPath);
        } catch { /* non-fatal */ }
        clack.outro('');
        return;
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.init(projectPath, { index: false });
      clack.log.success(`Initialized in ${projectPath}`);

      // Indexing runs by default now. The legacy -i/--index flag is still
      // accepted (so existing muscle memory and scripts don't break) but is a
      // no-op — initializing always builds the initial index.
      let result: IndexResult;
      if (options.verbose) {
        result = await cg.indexAll({
          onProgress: createVerboseProgress(),
          verbose: true,
        });
      } else {
        process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
        const progress = createShimmerProgress();
        result = await cg.indexAll({
          onProgress: progress.onProgress,
        });
        await progress.stop();
      }
      printIndexResult(clack, result, projectPath);

      try {
        const { offerWatchFallback } = await import('../installer');
        await offerWatchFallback(clack, projectPath);
      } catch { /* non-fatal */ }

      // Manufactured first-run moment (REQ-ACTIVATION-002.A1).
      await printStarterPrompt(cg);

      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      clack.log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship uninit [path]
 */
program
  .command('uninit [path]')
  .description('Remove SpecShip from a project (deletes .specship/ directory)')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (pathArg: string | undefined, options: { force?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        warn(`SpecShip is not initialized in ${projectPath}`);
        return;
      }

      if (!options.force) {
        // Confirm with user
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.yellow(`${getGlyphs().warn} This will permanently delete all SpecShip data. Continue? (y/N) `),
            resolve
          );
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Cancelled');
          return;
        }
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = SpecShip.openSync(projectPath);
      cg.uninitialize();

      // Clean up any git sync hooks we installed (no-op if none / not a repo).
      try {
        const { removeGitSyncHook } = await import('../sync/git-hooks');
        const removed = removeGitSyncHook(projectPath);
        if (removed.installed.length > 0) {
          info(`Removed git ${removed.installed.join(', ')} sync hook${removed.installed.length > 1 ? 's' : ''}`);
        }
      } catch { /* non-fatal */ }

      success(`Removed SpecShip from ${projectPath}`);
    } catch (err) {
      error(`Failed to uninitialize: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship index [path]
 */
program
  .command('index [path]')
  .description('Index all files in the project')
  .option('-f, --force', 'Force full re-index even if already indexed')
  .option('-q, --quiet', 'Suppress progress output')
  .option('-v, --verbose', 'Show detailed worker lifecycle and memory info')
  .action(async (pathArg: string | undefined, options: { force?: boolean; quiet?: boolean; verbose?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        info('Run "specship init" first');
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);

      if (options.quiet) {
        // Quiet mode: no UI, just run
        if (options.force) cg.clear();
        const result = await cg.indexAll();
        if (!result.success) process.exit(1);
        cg.destroy();
        return;
      }

      const clack = await importESM('@clack/prompts');
      clack.intro('Indexing project');

      if (options.force) {
        cg.clear();
        clack.log.info('Cleared existing index');
      }

      let result: IndexResult;

      if (options.verbose) {
        result = await cg.indexAll({
          onProgress: createVerboseProgress(),
          verbose: true,
        });
      } else {
        process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
        const progress = createShimmerProgress();
        result = await cg.indexAll({
          onProgress: progress.onProgress,
        });
        await progress.stop();
      }

      printIndexResult(clack, result, projectPath);

      if (!result.success) {
        process.exit(1);
      }

      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      error(`Failed to index: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship sync [path]
 */
program
  .command('sync [path]')
  .description('Sync changes since last index')
  .option('-q, --quiet', 'Suppress output (for git hooks); drift-transition notices still print')
  .option('--drift-summary', 'After syncing, print a one-line drifted-link summary when the queue is non-empty (for the SessionStart hook)')
  .action(async (pathArg: string | undefined, options: { quiet?: boolean; driftSummary?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    // One line per link that TRANSITIONED into drifted this sync
    // (REQ-DRIFT-PUSH-001). Deliberately printed even under --quiet — the
    // auto-sync hook runs with --quiet, and these notices are its payload.
    const pushDriftNotices = (result: { driftedTransitions?: Array<{ specId: string; fromState: string; axis: string; symbol: string }> }) => {
      for (const t of result.driftedTransitions ?? []) {
        console.log(
          `⚠ spec drift: ${t.specId} ${t.fromState}→drifted (${t.symbol} ${t.axis === 'spec' ? 'spec changed' : 'changed'}) — ` +
          `re-assert with specship_link_assert, or run /specship:check fix ${t.specId}`,
        );
      }
    };

    // JIRA push (REQ-JIRAPUB-006): a genuine drift transition on a JIRA-backed
    // spec is commented onto its issue — best-effort, transition events only
    // (so an ongoing drift never repeats a comment), never blocks the sync.
    const pushJiraDriftComments = async (
      cg: { getSpecQueries(): { getSpecById(id: string): { sourcePath: string } | null } },
      result: { driftedTransitions?: Array<{ specId: string; axis: string; symbol: string }> },
    ) => {
      const transitions = result.driftedTransitions ?? [];
      if (transitions.length === 0) return;
      try {
        const { loadJiraConfig, resolveJiraCredentials } = await import('../jira/config');
        if (!loadJiraConfig()) return; // not configured → no JIRA calls at all
        const { readSpecJiraKey } = await import('../jira/spec-writer');
        const { JiraClient } = await import('../jira/client');
        const { commentDriftTransitionsOnJira } = await import('../jira/publish');
        const notes = await commentDriftTransitionsOnJira({
          transitions,
          specPathFor: (specId) => {
            const rootId = specId.replace(/\.A\d+$/, '');
            const spec = cg.getSpecQueries().getSpecById(rootId);
            if (!spec) return null;
            return path.isAbsolute(spec.sourcePath)
              ? spec.sourcePath
              : path.join(projectPath, spec.sourcePath);
          },
          readKey: readSpecJiraKey,
          makeClient: () => new JiraClient(resolveJiraCredentials()),
        });
        for (const note of notes) console.log(`JIRA: ${note}`);
      } catch {
        /* a JIRA fault must never fail a sync */
      }
    };

    // One-line drift-queue summary, only when non-empty (REQ-DRIFT-PUSH-002).
    const pushDriftSummary = (cg: { getSpecQueries(): { getLinksByState(states: string[]): unknown[] } }) => {
      if (!options.driftSummary) return;
      const drifted = cg.getSpecQueries().getLinksByState(['drifted']).length;
      if (drifted > 0) {
        console.log(`⚠ ${drifted} spec link(s) drifted — review with /specship:check drifted`);
      }
    };

    try {
      if (!isInitialized(projectPath)) {
        if (!options.quiet) {
          error(`SpecShip not initialized in ${projectPath}`);
        }
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);

      if (options.quiet) {
        const result = await cg.sync();
        pushDriftNotices(result);
        await pushJiraDriftComments(cg, result);
        pushDriftSummary(cg);
        cg.destroy();
        return;
      }

      const clack = await importESM('@clack/prompts');
      clack.intro('Syncing SpecShip');

      process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
      const progress = createShimmerProgress();

      const result = await cg.sync({
        onProgress: progress.onProgress,
      });

      await progress.stop();

      const totalChanges = result.filesAdded + result.filesModified + result.filesRemoved;

      if (totalChanges === 0) {
        clack.log.info('Already up to date');
      } else {
        clack.log.success(`Synced ${formatNumber(totalChanges)} changed files`);
        const details: string[] = [];
        if (result.filesAdded > 0) details.push(`Added: ${result.filesAdded}`);
        if (result.filesModified > 0) details.push(`Modified: ${result.filesModified}`);
        if (result.filesRemoved > 0) details.push(`Removed: ${result.filesRemoved}`);
        clack.log.info(`${details.join(', ')} ${getGlyphs().dash} ${formatNumber(result.nodesUpdated)} nodes in ${formatDuration(result.durationMs)}`);
      }

      pushDriftNotices(result);
      await pushJiraDriftComments(cg, result);
      pushDriftSummary(cg);
      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      if (!options.quiet) {
        error(`Failed to sync: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

/**
 * specship status [path]
 */
program
  .command('status [path]')
  .description('Show index status and statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);
    // The directory the user actually ran from, before walking up to the index
    // root. Used to detect when the resolved index lives in a different git
    // working tree (e.g. a nested worktree borrowing the main checkout's index).
    const startPath = path.resolve(pathArg || process.cwd());
    const worktreeMismatch = detectWorktreeIndexMismatch(startPath, projectPath);

    try {
      if (!isInitialized(projectPath)) {
        if (options.json) {
          console.log(JSON.stringify({
            initialized: false,
            version: packageJson.version,
            projectPath,
            indexPath: getSpecShipDir(projectPath),
            lastIndexed: null,
          }));
          return;
        }
        console.log(chalk.bold('\nSpecShip Status\n'));
        info(`Project: ${projectPath}`);
        warn('Not initialized');
        info('Run "specship init" to initialize');
        return;
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const stats = cg.getStats();
      const changes = cg.getChangedFiles();
      const backend = cg.getBackend();
      const journalMode = cg.getJournalMode();

      // JSON output mode
      if (options.json) {
        const lastIndexedMs = cg.getLastIndexedAt();
        console.log(JSON.stringify({
          initialized: true,
          version: packageJson.version,
          projectPath,
          indexPath: getSpecShipDir(projectPath),
          lastIndexed: lastIndexedMs != null ? new Date(lastIndexedMs).toISOString() : null,
          fileCount: stats.fileCount,
          nodeCount: stats.nodeCount,
          edgeCount: stats.edgeCount,
          dbSizeBytes: stats.dbSizeBytes,
          backend,
          journalMode,
          nodesByKind: stats.nodesByKind,
          languages: Object.entries(stats.filesByLanguage).filter(([, count]) => count > 0).map(([lang]) => lang),
          pendingChanges: {
            added: changes.added.length,
            modified: changes.modified.length,
            removed: changes.removed.length,
          },
          worktreeMismatch: worktreeMismatch
            ? { worktreeRoot: worktreeMismatch.worktreeRoot, indexRoot: worktreeMismatch.indexRoot }
            : null,
        }));
        cg.destroy();
        return;
      }

      console.log(chalk.bold('\nSpecShip Status\n'));

      // Project info
      console.log(chalk.cyan('Project:'), projectPath);
      if (worktreeMismatch) {
        warn(worktreeMismatchWarning(worktreeMismatch));
      }
      console.log();

      // Index stats
      console.log(chalk.bold('Index Statistics:'));
      console.log(`  Files:     ${formatNumber(stats.fileCount)}`);
      console.log(`  Nodes:     ${formatNumber(stats.nodeCount)}`);
      console.log(`  Edges:     ${formatNumber(stats.edgeCount)}`);
      console.log(`  DB Size:   ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`);
      // Surface the active SQLite backend. Two paths:
      //   - 'node-sqlite'    → Node's built-in module (production: bundled Node 24 has FTS5).
      //   - 'better-sqlite3' → optional devDep that ships its own SQLite with FTS5.
      const backendLabel = backend === 'better-sqlite3'
        ? chalk.green(`better-sqlite3 ${getGlyphs().dash} ships its own SQLite (FTS5)`)
        : chalk.green(`node:sqlite ${getGlyphs().dash} built-in (full WAL)`);
      console.log(`  Backend:   ${backendLabel}`);
      // Effective journal mode: 'wal' means concurrent reads never block on a
      // writer; anything else means they can ("database is locked"). node:sqlite
      // supports WAL everywhere, so a non-wal mode means the filesystem can't
      // (network mounts, WSL2 /mnt). See issue #238.
      const journalLabel = journalMode === 'wal'
        ? chalk.green('wal')
        : chalk.yellow(`${journalMode || 'unknown'} ${getGlyphs().dash} WAL inactive; reads can block on writes`);
      console.log(`  Journal:   ${journalLabel}`);
      console.log();

      // Node breakdown
      console.log(chalk.bold('Nodes by Kind:'));
      const nodesByKind = Object.entries(stats.nodesByKind)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [kind, count] of nodesByKind) {
        console.log(`  ${kind.padEnd(15)} ${formatNumber(count)}`);
      }
      console.log();

      // Language breakdown
      console.log(chalk.bold('Files by Language:'));
      const filesByLang = Object.entries(stats.filesByLanguage)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [lang, count] of filesByLang) {
        console.log(`  ${lang.padEnd(15)} ${formatNumber(count)}`);
      }
      console.log();

      // Pending changes
      const totalChanges = changes.added.length + changes.modified.length + changes.removed.length;
      if (totalChanges > 0) {
        console.log(chalk.bold('Pending Changes:'));
        if (changes.added.length > 0) {
          console.log(`  Added:     ${changes.added.length} files`);
        }
        if (changes.modified.length > 0) {
          console.log(`  Modified:  ${changes.modified.length} files`);
        }
        if (changes.removed.length > 0) {
          console.log(`  Removed:   ${changes.removed.length} files`);
        }
        info('Run "specship sync" to update the index');
      } else {
        success('Index is up to date');
      }
      console.log();

      cg.destroy();
    } catch (err) {
      error(`Failed to get status: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship statusline
 *
 * Reads Claude Code's status-line JSON on stdin and prints ONE composable
 * segment on stdout (sync state · backend health · session calls · active
 * run). Resolves entirely from cache files — never opens the database — so it
 * stays within the sub-second status-line render budget (SHIP-STATUSLINE-DOC).
 * Append it to your own status-line script.
 */
program
  .command('statusline')
  .description('Print a SpecShip status-line segment (reads Claude Code JSON on stdin)')
  .action(async () => {
    const { buildSegment } = await import('../statusline/index');
    let raw = '';
    try {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      raw = Buffer.concat(chunks).toString('utf-8');
    } catch {
      /* no stdin — buildSegment falls back to cwd */
    }
    // buildSegment never throws; print the segment with no trailing newline so
    // a composing script controls line layout.
    process.stdout.write(buildSegment(raw));
  });

/**
 * specship query <search>
 */
program
  .command('query <search>')
  .description('Search for symbols in the codebase')
  .option('-p, --path <path>', 'Project path')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('-k, --kind <kind>', 'Filter by node kind (function, class, etc.)')
  .option('-j, --json', 'Output as JSON')
  .action(async (search: string, options: { path?: string; limit?: string; kind?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);

      const limit = parseInt(options.limit || '10', 10);
      const rawResults = cg.searchNodes(search, {
        limit,
        kinds: options.kind ? [options.kind as any] : undefined,
      });

      // Mirror the MCP search down-rank so the CLI also surfaces the
      // hand-written implementation before protobuf/gRPC scaffolding
      // when both share a name. See extraction/generated-detection.ts.
      const { isGeneratedFile } = await import('../extraction/generated-detection');
      const results = [...rawResults].sort((a, b) => {
        const aGen = isGeneratedFile(a.node.filePath) ? 1 : 0;
        const bGen = isGeneratedFile(b.node.filePath) ? 1 : 0;
        return aGen - bGen;
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          info(`No results found for "${search}"`);
        } else {
          console.log(chalk.bold(`\nSearch Results for "${search}":\n`));

          for (const result of results) {
            const node = result.node;
            const location = `${node.filePath}:${node.startLine}`;
            const score = chalk.dim(`(${(result.score * 100).toFixed(0)}%)`);

            console.log(
              chalk.cyan(node.kind.padEnd(12)) +
              chalk.white(node.name) +
              ' ' + score
            );
            console.log(chalk.dim(`  ${location}`));
            if (node.signature) {
              console.log(chalk.dim(`  ${node.signature}`));
            }
            console.log();
          }
        }
      }

      cg.destroy();
    } catch (err) {
      error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship files [path]
 */
program
  .command('files')
  .description('Show project file structure from the index')
  .option('-p, --path <path>', 'Project path')
  .option('--filter <dir>', 'Filter to files under this directory')
  .option('--pattern <glob>', 'Filter files matching this glob pattern')
  .option('--format <format>', 'Output format (tree, flat, grouped)', 'tree')
  .option('--max-depth <number>', 'Maximum directory depth for tree format')
  .option('--no-metadata', 'Hide file metadata (language, symbol count)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    path?: string;
    filter?: string;
    pattern?: string;
    format?: string;
    maxDepth?: string;
    metadata?: boolean;
    json?: boolean;
  }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      let files = cg.getFiles();

      if (files.length === 0) {
        info('No files indexed. Run "specship index" first.');
        cg.destroy();
        return;
      }

      // Filter by path prefix
      if (options.filter) {
        const filter = options.filter;
        files = files.filter(f => f.path.startsWith(filter) || f.path.startsWith('./' + filter));
      }

      // Filter by glob pattern
      if (options.pattern) {
        const regex = globToRegex(options.pattern);
        files = files.filter(f => regex.test(f.path));
      }

      if (files.length === 0) {
        info('No files found matching the criteria.');
        cg.destroy();
        return;
      }

      // JSON output
      if (options.json) {
        const output = files.map(f => ({
          path: f.path,
          language: f.language,
          nodeCount: f.nodeCount,
          size: f.size,
        }));
        console.log(JSON.stringify(output, null, 2));
        cg.destroy();
        return;
      }

      const includeMetadata = options.metadata !== false;
      const format = options.format || 'tree';
      const maxDepth = options.maxDepth ? parseInt(options.maxDepth, 10) : undefined;

      // Format output
      switch (format) {
        case 'flat':
          console.log(chalk.bold(`\nFiles (${files.length}):\n`));
          for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
            if (includeMetadata) {
              console.log(`  ${file.path} ${chalk.dim(`(${file.language}, ${file.nodeCount} symbols)`)}`);
            } else {
              console.log(`  ${file.path}`);
            }
          }
          break;

        case 'grouped':
          console.log(chalk.bold(`\nFiles by Language (${files.length} total):\n`));
          const byLang = new Map<string, typeof files>();
          for (const file of files) {
            const existing = byLang.get(file.language) || [];
            existing.push(file);
            byLang.set(file.language, existing);
          }
          const sortedLangs = [...byLang.entries()].sort((a, b) => b[1].length - a[1].length);
          for (const [lang, langFiles] of sortedLangs) {
            console.log(chalk.cyan(`${lang} (${langFiles.length}):`));
            for (const file of langFiles.sort((a, b) => a.path.localeCompare(b.path))) {
              if (includeMetadata) {
                console.log(`  ${file.path} ${chalk.dim(`(${file.nodeCount} symbols)`)}`);
              } else {
                console.log(`  ${file.path}`);
              }
            }
            console.log();
          }
          break;

        case 'tree':
        default:
          console.log(chalk.bold(`\nProject Structure (${files.length} files):\n`));
          printFileTree(files, includeMetadata, maxDepth, chalk);
          break;
      }

      console.log();
      cg.destroy();
    } catch (err) {
      error(`Failed to list files: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(escaped);
}

/**
 * Print files as a tree
 */
function printFileTree(
  files: { path: string; language: string; nodeCount: number }[],
  includeMetadata: boolean,
  maxDepth: number | undefined,
  chalk: { dim: (s: string) => string; cyan: (s: string) => string }
): void {
  interface TreeNode {
    name: string;
    children: Map<string, TreeNode>;
    file?: { language: string; nodeCount: number };
  }

  const root: TreeNode = { name: '', children: new Map() };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      if (!current.children.has(part)) {
        current.children.set(part, { name: part, children: new Map() });
      }
      current = current.children.get(part)!;

      if (i === parts.length - 1) {
        current.file = { language: file.language, nodeCount: file.nodeCount };
      }
    }
  }

  const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;

    const glyphs = getGlyphs();
    const connector = isLast ? glyphs.treeLast : glyphs.treeBranch;
    const childPrefix = isLast ? '    ' : glyphs.treePipe;

    if (node.name) {
      let line = prefix + connector + node.name;
      if (node.file && includeMetadata) {
        line += chalk.dim(` (${node.file.language}, ${node.file.nodeCount} symbols)`);
      }
      console.log(line);
    }

    const children = [...node.children.values()];
    children.sort((a, b) => {
      const aIsDir = a.children.size > 0 && !a.file;
      const bIsDir = b.children.size > 0 && !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const nextPrefix = node.name ? prefix + childPrefix : prefix;
      renderNode(child, nextPrefix, i === children.length - 1, depth + 1);
    }
  };

  renderNode(root, '', true, 0);
}

/**
 * specship reflect
 *
 * Run a reflection pass over the ingested Claude Code transcripts and print the
 * self-improvement proposals it surfaces (REQ-REFLECT-006.A1). Headless — no
 * dashboard required. With no usable transcript history, prints an empty state.
 */
program
  .command('reflect [path]')
  .description('Mine ingested transcripts for self-improvement proposals (memory rules, skills, hooks)')
  .option('-j, --json', 'Output as JSON')
  .option('--capture', 'Capture a routine as a skill proposal: --title required, content on stdin (LEARN-DOC)')
  .option('--title <title>', 'Title for --capture')
  .action(async (pathArg: string | undefined, options: { json?: boolean; capture?: boolean; title?: string }) => {
    const projectPath = resolveProjectPath(pathArg);
    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }
      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);

      // Explicit capture door (LEARN-DOC, REQ-LEARN-002): crystallize a
      // distilled routine into a human-gated skill proposal. Content on
      // stdin so multi-line routines survive shell quoting.
      if (options.capture) {
        if (!options.title || !options.title.trim()) {
          error('--capture requires --title "<what this routine does>"');
          process.exit(1);
        }
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) chunks.push(c as Buffer);
        const content = Buffer.concat(chunks).toString('utf-8').trim();
        if (!content) {
          error('--capture expects the routine content on stdin (pipe or heredoc)');
          process.exit(1);
        }
        const p = cg.reflectCapture({ title: options.title, content });
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          info(`Captured as proposal ${p.contentHash.slice(0, 12)} (${p.state}): ${p.title}`);
          info('Review and apply it from the dashboard Improvements page (preview-diff → confirm).');
        }
        cg.destroy();
        return;
      }

      const result = cg.reflectAnalyze();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        cg.destroy();
        return;
      }

      if (result.empty || result.open.length === 0) {
        info('No proposals yet — not enough signal in the ingested transcripts.');
        info('Tip: run the dashboard with `specship serve --ui --ingest` to build transcript history.');
        cg.destroy();
        return;
      }

      const sevColor: Record<string, (s: string) => string> = {
        high: chalk.red,
        warn: chalk.yellow,
        info: chalk.cyan,
      };
      const typeLabel: Record<string, string> = {
        memory_rule: 'memory/rule',
        skill: 'skill',
        hook: 'hook',
      };
      console.log(chalk.bold(`\nReflection proposals (${result.open.length}):\n`));
      for (const p of result.open) {
        const sev = (sevColor[p.severity] ?? chalk.white)(p.severity.toUpperCase().padEnd(5));
        console.log(`${sev} ${chalk.bold(p.title)}`);
        console.log(chalk.dim(`      ${typeLabel[p.type] ?? p.type} → ${p.targetPath}`));
        console.log(chalk.dim(`      ${p.evidence.detail}`));
        console.log(chalk.dim(`      ${p.body}`));
        console.log();
      }
      info('Review and apply proposals from the dashboard Improvements page (preview-diff → confirm).');
      cg.destroy();
    } catch (err) {
      error(`reflect failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship maintainability
 *
 * Report graph-derived maintainability signals (REQ-MAINT-003) — coupling, size
 * hotspots, dependency cycles, dead-code candidates. Advisory (exit 0); the
 * `--strict` flag is the gating-ready shape consumed later by enforcement mode.
 */
program
  .command('maintainability [path]')
  .alias('maint')
  .description('Report graph-derived maintainability signals (coupling, size, cycles, dead code)')
  .option('-j, --json', 'Output as JSON')
  .option('--deep', 'Also show lower-confidence findings (dead-code candidates, coupling). Hidden by default.')
  .option('--strict', 'Exit non-zero if any signal has findings (gating-ready; default advisory)')
  .action(async (pathArg: string | undefined, options: { json?: boolean; deep?: boolean; strict?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);
    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }
      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const r = cg.getMaintainability();

      // The report is tiered (HEALTH-GATEWAY-DOC). The high-precision classes —
      // oversized symbols, god files, dependency cycles — are demonstrably
      // accurate and shown by default. Dead-code and coupling are lower-confidence
      // (volume + name-collision artifacts) and surface only with --deep. `--json`
      // always returns the full set, labelled by tier, so CI/tooling can choose
      // what to gate on (REQ-HEALTH-001/002/003).
      const { HIGH_PRECISION_CLASSES, LOW_CONFIDENCE_CLASSES, highPrecisionClean } = await import('../graph/maintainability');

      if (options.json) {
        console.log(JSON.stringify({ ...r, precision: { highPrecision: HIGH_PRECISION_CLASSES, lowConfidence: LOW_CONFIDENCE_CLASSES } }, null, 2));
        cg.destroy();
        if (options.strict && !r.clean) process.exit(1);
        return;
      }

      const deep = options.deep === true;
      const highClean = highPrecisionClean(r);
      const lowCount = r.coupling.length + r.deadCode.length;

      const CAP = 10;
      const section = (title: string, count: number) => console.log(chalk.bold(`\n${title} (${count})`));
      const overflow = (n: number) => { if (n > CAP) console.log(chalk.dim(`  …and ${n - CAP} more`)); };

      // High-precision tier — always shown (REQ-HEALTH-001).
      if (r.oversized.length) {
        section('Oversized symbols', r.oversized.length);
        for (const o of r.oversized.slice(0, CAP)) console.log(chalk.dim('  ') + `${o.name} ${chalk.dim(`(${o.reason}) — ${o.filePath}`)}`);
        overflow(r.oversized.length);
      }
      if (r.godFiles.length) {
        section('God files', r.godFiles.length);
        for (const f of r.godFiles.slice(0, CAP)) console.log(chalk.dim('  ') + `${f.filePath} ${chalk.dim(`(${f.reason})`)}`);
        overflow(r.godFiles.length);
      }
      if (r.cycles.length) {
        section('Dependency cycles', r.cycles.length);
        for (const c of r.cycles.slice(0, CAP)) console.log(chalk.dim('  ') + c.files.join(' → '));
        overflow(r.cycles.length);
      }

      if (highClean && !deep) {
        success('Maintainability: clean — no high-precision findings past threshold.');
        if (lowCount > 0) info(`${lowCount} lower-confidence finding(s) hidden (dead-code: ${r.deadCode.length}, coupling: ${r.coupling.length}) — run \`specship maintainability --deep\` to include them.`);
        cg.destroy();
        return;
      }

      // Low-confidence tier — opt-in via --deep (REQ-HEALTH-002), each finding
      // attributed to a single concrete definition (file + qualified symbol).
      if (deep) {
        if (r.coupling.length) {
          section('Coupling hotspots (lower-confidence)', r.coupling.length);
          for (const c of r.coupling.slice(0, CAP)) console.log(chalk.dim('  ') + `${c.qualifiedName} ${chalk.dim(`(${c.reason}) — ${c.filePath}`)}`);
          overflow(r.coupling.length);
        }
        if (r.deadCode.length) {
          section('Dead-code candidates (lower-confidence)', r.deadCode.length);
          for (const d of r.deadCode.slice(0, CAP)) console.log(chalk.dim('  ') + `${d.qualifiedName} ${chalk.dim(`— ${d.filePath}:${d.startLine}`)}`);
          overflow(r.deadCode.length);
        }
      } else if (lowCount > 0) {
        console.log();
        info(`${lowCount} lower-confidence finding(s) hidden (dead-code: ${r.deadCode.length}, coupling: ${r.coupling.length}) — run \`specship maintainability --deep\` to include them.`);
      }

      console.log();
      info(`Thresholds: highDegree=${r.thresholds.highDegree} largeSymbolLines=${r.thresholds.largeSymbolLines} godFileSymbols=${r.thresholds.godFileSymbols} — override in specship.config.json`);
      cg.destroy();
      // --strict gates on what's shown: high-precision by default, the full set with --deep.
      if (options.strict && (deep ? !r.clean : !highClean)) process.exit(1);
    } catch (err) {
      error(`maintainability failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship fitness
 *
 * Evaluate the project's architecture-fitness rules (specship.config.json
 * `fitness.rules`) against the graph (REQ-FITNESS-003). Headless CI gate: exits
 * non-zero on any violation OR config error (a no-match rule is a config error,
 * never a silent pass).
 */
program
  .command('fitness [path]')
  .description('Check architecture-fitness rules against the code graph (CI gate; exits non-zero on violation)')
  .option('-j, --json', 'Output as JSON')
  .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);
    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }
      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const r = cg.getFitness();
      const fail = r.violations.length > 0 || r.configErrors.length > 0;

      if (options.json) {
        console.log(JSON.stringify(r, null, 2));
        cg.destroy();
        process.exit(fail ? 1 : 0);
      }

      if (r.ruleCount === 0) {
        info('No architecture-fitness rules declared. Add a `fitness.rules` array to specship.config.json.');
        cg.destroy();
        return;
      }
      if (r.clean) {
        success(`Architecture fitness: all ${r.ruleCount} rule(s) pass.`);
        cg.destroy();
        return;
      }
      if (r.configErrors.length) {
        console.log(chalk.bold(chalk.red(`\nConfig errors (${r.configErrors.length}):`)));
        for (const e of r.configErrors) console.log(chalk.red(`  ✗ ${e.rule}: ${e.message}`));
      }
      if (r.violations.length) {
        console.log(chalk.bold(chalk.red(`\nViolations (${r.violations.length}):`)));
        for (const v of r.violations.slice(0, 50)) {
          console.log(`  ${chalk.red('✗')} [${v.rule}] ${v.source} → ${v.target}`);
          console.log(chalk.dim(`      ${v.detail} — ${v.location}`));
        }
        if (r.violations.length > 50) console.log(chalk.dim(`  …and ${r.violations.length - 50} more`));
      }
      cg.destroy();
      process.exit(1);
    } catch (err) {
      error(`fitness failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship check
 *
 * The enforcement gate (REQ-ENFORCE-001/002/003): runs the harness checks
 * (drift + fitness + maintainability + behaviour) and exits non-zero if any
 * GATING check fails. Which checks gate vs advise is configured in
 * specship.config.json `enforce.gate`; with no config every check is advisory
 * and the command exits 0 (opt-in — never breaks an existing repo).
 *
 * The graduation ramp (REQ-ENFORCE-004): `--strict` gates every check for
 * one run; `--enable-gate <checks...>` persists gating into the config and
 * then runs; an advisory run with would-be-gating findings ends by printing
 * the exact `--enable-gate` command that turns the gate on.
 */
program
  .command('check [path]')
  .description('Run the enforcement gate (drift + fitness + maintainability + behaviour); exits non-zero on a gating failure')
  .option('-j, --json', 'Output as JSON')
  .option('--strict', 'Treat every check as gating for this run only (nothing read from or written to config)')
  .option('--enable-gate <checks...>', 'Persist gating for the named checks into specship.config.json, then run the gate')
  .action(async (pathArg: string | undefined, options: { json?: boolean; strict?: boolean; enableGate?: string[] }) => {
    const projectPath = resolveProjectPath(pathArg);
    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }
      const enforce = await import('../enforce/enforce');

      // --enable-gate writes the opt-in config, then falls through to a
      // normal run so the user immediately sees the gate with teeth
      // (REQ-ENFORCE-004.A1).
      if (options.enableGate?.length) {
        const invalid = options.enableGate.filter(
          (c) => !(enforce.ALL_CHECKS as string[]).includes(c),
        );
        if (invalid.length) {
          error(`Unknown check(s): ${invalid.join(', ')}. Valid: ${enforce.ALL_CHECKS.join(', ')}`);
          process.exit(1);
        }
        const enabled = enforce.enableGateChecks(
          projectPath,
          options.enableGate as typeof enforce.ALL_CHECKS,
        );
        if (enabled.length) {
          success(`Gating enabled for ${enabled.join(', ')} — written to specship.config.json.`);
        }
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      // --strict gates everything for this run only (REQ-ENFORCE-004.A2).
      const r = options.strict ? cg.getEnforce(enforce.strictEnforceConfig()) : cg.getEnforce();

      if (options.json) {
        console.log(JSON.stringify(r, null, 2));
        cg.destroy();
        process.exit(r.passed ? 0 : 1);
      }

      console.log(chalk.bold('\nEnforcement gate\n'));
      for (const c of r.checks) {
        const tag = c.gating ? chalk.dim('[gating]') : chalk.dim('[advisory]');
        const mark = c.passed ? chalk.green('✓') : (c.gating ? chalk.red('✗') : chalk.yellow('•'));
        console.log(`  ${mark} ${c.check.padEnd(16)} ${tag} ${c.passed ? 'pass' : `${c.findings.length} finding(s)`}`);
        if (!c.passed) for (const f of c.findings.slice(0, 8)) console.log(chalk.dim(`        ${f}`));
        if (!c.passed && c.findings.length > 8) console.log(chalk.dim(`        …and ${c.findings.length - 8} more`));
      }
      console.log();
      if (r.passed) {
        success(r.gatedFailures.length === 0 && r.checks.some((c) => c.gating)
          ? 'All gating checks pass.'
          : 'Pass (no gating checks failed).');
        // The advisory sell (REQ-ENFORCE-004.A1): findings that would fail
        // a gated run end the report with the exact opt-in command.
        const wouldGate = r.checks.filter((c) => !c.gating && !c.passed).map((c) => c.check);
        if (wouldGate.length) {
          const total = r.checks
            .filter((c) => wouldGate.includes(c.check))
            .reduce((n, c) => n + c.findings.length, 0);
          console.log(
            chalk.dim(
              `\n  ${total} advisory finding(s) would fail a gated run.` +
              `\n  Enable: specship check --enable-gate ${wouldGate.join(' ')}\n`,
            ),
          );
        }
        cg.destroy();
        return;
      }
      error(`Gating checks failed: ${r.gatedFailures.join(', ')}`);
      cg.destroy();
      process.exit(1);
    } catch (err) {
      error(`check failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship serve
 */
program
  .command('serve')
  .description('Start SpecShip as an MCP server for AI assistants, an HTTP API for the desktop UI, or both')
  .option('-p, --path <path>', 'Project path (optional for MCP mode, uses rootUri from client)')
  .option('--mcp', 'Run as MCP server (stdio transport)')
  .option('--ui', 'Run as HTTP API server for the SpecShip Desktop UI (binds 127.0.0.1)')
  .option('--port <n>', 'HTTP port when --ui is set (default 4242)')
  .option('--host <h>', 'HTTP bind host when --ui is set (default 127.0.0.1)')
  .option('--ingest', 'Enable Claude Code JSONL transcript watcher (only when --ui is set)')
  .option('--web-dir <path>', 'Path to a built desktop SPA (index.html lives here); auto-detected by default from the bundled ui/dist')
  .option('--no-web', 'Run --ui headless (API only, no SPA)')
  .option('--no-watch', 'Disable the file watcher (no auto-sync; useful on slow filesystems like WSL2 /mnt drives)')
  .action(async (options: { path?: string; mcp?: boolean; ui?: boolean; port?: string; host?: string; ingest?: boolean; webDir?: string; web?: boolean; watch?: boolean }) => {
    const projectPath = options.path ? resolveProjectPath(options.path) : undefined;

    // Commander sets watch=false when --no-watch is passed. Route it through
    // the same env-var chokepoint the watcher and MCP server already honor.
    if (options.watch === false) {
      process.env.SPECSHIP_NO_WATCH = '1';
    }

    try {
      if (options.ui) {
        // HTTP API mode. Boots the specship server + optional JSONL
        // ingest watcher. Optionally also starts MCP stdio in parallel.
        //
        // Project root resolution:
        //   1. `-p <path>` if passed.
        //   2. The current cwd if it has been `specship init`-ed.
        //   3. Most-recently-touched initialized project under
        //      ~/.claude/projects/ — so a user who runs `specship serve --ui`
        //      from anywhere lands on the project they were last active in.
        //   4. None — server boots projectless, the desktop picker prompts
        //      the user to choose one (analytics endpoints return 409 until
        //      a primary exists).
        let root: string | null = null;
        if (projectPath) {
          root = projectPath;
          if (!isInitialized(root)) {
            error(`SpecShip not initialized in ${root}. Run \`specship init -i\` first.`);
            process.exit(1);
          }
        } else if (isInitialized(process.cwd())) {
          root = process.cwd();
        } else {
          root = await pickRecentInitializedProject();
        }

        const port = options.port ? parseInt(options.port, 10) : 4242;
        const host = options.host ?? '127.0.0.1';

        // Lazy-load the server package via dist path. The npm bin is
        // packaged with the server already built under
        // node_modules/@specship/specship-server, OR (dev) the
        // sibling server/dist directory.
        const { createServer } = await loadServerPackage();

        // The dashboard is the built desktop SPA, served in-process by the
        // server itself (REQ-DESKTOP-033 — the server-rendered dashboard
        // retired). `--no-web` opts out to run API-only.
        const serveUi = options.web !== false;
        // Resolve the SPA static dir:
        //   - headless (--no-web): no SPA.
        //   - otherwise the built SPA — explicit --web-dir, else auto-detect
        //     the bundled ui/dist (webDir === undefined triggers the probe).
        const webDir = !serveUi ? null : (options.webDir ?? undefined);

        // The JSONL ingest watcher now starts in-process inside createServer
        // when `ingest: true`. The server owns its lifecycle; CLI just toggles.
        const handle = await createServer({
          projectRoot: root ?? undefined,
          host,
          port,
          ingest: options.ingest !== false,
          webDir,
          verbose: false,
        });
        console.error(chalk.bold('\nSpecShip Desktop server\n'));
        console.error(chalk.green(getGlyphs().ok) + ` HTTP API: ${handle.url}`);
        if (root) {
          console.error(chalk.dim(`  project: ${root}`));
        } else {
          console.error(chalk.yellow(getGlyphs().warn) + ' no primary project — pick one in the dashboard');
          console.error(chalk.dim('  analytics endpoints will return 409 until one is selected'));
        }
        if (serveUi) {
          console.error(chalk.green(getGlyphs().ok) + ` Dashboard: ${handle.url}/`);
        }
        if (options.ingest !== false) {
          console.error(chalk.dim('  Claude Code transcript ingest watcher active'));
        }
        if (options.mcp) {
          if (!root) {
            console.error(chalk.yellow(getGlyphs().warn) + ' --mcp needs an initialized project — skipping MCP stdio');
          } else {
            // Also start MCP stdio in this process. The two are unrelated
            // surfaces hitting the same specship instance, both safe under WAL.
            const { MCPServer } = await import('../mcp/index');
            const mcp = new MCPServer(root);
            void mcp.start();
            console.error(chalk.green(getGlyphs().ok) + ' MCP stdio: running');
          }
        }

        const shutdown = async () => {
          console.error(chalk.dim('shutting down…'));
          await handle.stop();
          process.exit(0);
        };
        process.on('SIGINT', () => { void shutdown(); });
        process.on('SIGTERM', () => { void shutdown(); });
        // Server now runs until terminated.
        return;
      }
      if (options.mcp) {
        // Start MCP server - it handles initialization lazily based on rootUri from client
        const { MCPServer } = await import('../mcp/index');
        const server = new MCPServer(projectPath);
        await server.start();
        // Server will run until terminated
      } else {
        // Default: show info about MCP mode.
        // Use stderr so stdout stays clean for any piped/stdio usage.
        console.error(chalk.bold('\nSpecShip MCP Server\n'));
        console.error(chalk.blue(getGlyphs().info) + ' Use --mcp flag to start the MCP server');
        console.error('\nTo use with Claude Code, add to your MCP configuration:');
        console.error(chalk.dim(`
{
  "mcpServers": {
    "specship": {
      "command": "specship",
      "args": ["serve", "--mcp"]
    }
  }
}
`));
        console.error('Available tools:');
        console.error(chalk.cyan('  specship_explore') + '   - Primary: source of the relevant symbols for any question');
        console.error(chalk.cyan('  specship_search') + '    - Search for code symbols');
        console.error(chalk.cyan('  specship_callers') + '   - Find callers of a symbol');
        console.error(chalk.cyan('  specship_callees') + '   - Find what a symbol calls');
        console.error(chalk.cyan('  specship_impact') + '    - Analyze impact of changes');
        console.error(chalk.cyan('  specship_node') + '      - Get symbol details');
        console.error(chalk.cyan('  specship_files') + '     - Get project file structure');
        console.error(chalk.cyan('  specship_status') + '    - Get index status');
      }
    } catch (err) {
      error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship unlock [path]
 */
program
  .command('unlock [path]')
  .description('Remove a stale lock file that is blocking indexing')
  .action(async (pathArg: string | undefined) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        return;
      }

      const lockPath = path.join(getSpecShipDir(projectPath), 'specship.lock');

      if (!fs.existsSync(lockPath)) {
        info(`No lock file found ${getGlyphs().dash} nothing to do`);
        return;
      }

      fs.unlinkSync(lockPath);
      success('Removed lock file. You can now run indexing again.');
    } catch (err) {
      error(`Failed to remove lock: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship callers <symbol>
 *
 * CLI parity with the MCP graph tools (specship_callers/callees/impact) so the
 * traversal queries work in scripts, CI, and git hooks without a running MCP
 * server.
 */
program
  .command('callers <symbol>')
  .description('Find all functions/methods that call a specific symbol')
  .option('-p, --path <path>', 'Project path')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { path?: string; limit?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const limit = parseInt(options.limit || '20', 10);

      const matches = cg.searchNodes(symbol, { limit: 50 });
      if (matches.length === 0) {
        info(`Symbol "${symbol}" not found`);
        cg.destroy();
        return;
      }

      const seen = new Set<string>();
      const allCallers: Array<{ name: string; kind: string; filePath: string; startLine?: number }> = [];

      for (const match of matches) {
        const exactMatch = match.node.name === symbol || match.node.name.endsWith(`.${symbol}`) || match.node.name.endsWith(`::${symbol}`);
        if (!exactMatch && matches.length > 1) continue;
        for (const c of cg.getCallers(match.node.id)) {
          if (!seen.has(c.node.id)) {
            seen.add(c.node.id);
            allCallers.push({ name: c.node.name, kind: c.node.kind, filePath: c.node.filePath, startLine: c.node.startLine });
          }
        }
      }

      // Fallback: if exact filter removed everything, use the top match
      if (allCallers.length === 0 && matches[0]) {
        for (const c of cg.getCallers(matches[0].node.id)) {
          if (!seen.has(c.node.id)) {
            seen.add(c.node.id);
            allCallers.push({ name: c.node.name, kind: c.node.kind, filePath: c.node.filePath, startLine: c.node.startLine });
          }
        }
      }

      const limited = allCallers.slice(0, limit);

      if (options.json) {
        console.log(JSON.stringify({ symbol, callers: limited }, null, 2));
      } else if (limited.length === 0) {
        info(`No callers found for "${symbol}"`);
      } else {
        console.log(chalk.bold(`\nCallers of "${symbol}" (${limited.length}):\n`));
        for (const node of limited) {
          const loc = node.startLine ? `:${node.startLine}` : '';
          console.log(
            chalk.cyan(node.kind.padEnd(12)) +
            chalk.white(node.name)
          );
          console.log(chalk.dim(`  ${node.filePath}${loc}`));
          console.log();
        }
      }

      cg.destroy();
    } catch (err) {
      error(`callers failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship callees <symbol>
 */
program
  .command('callees <symbol>')
  .description('Find all functions/methods that a specific symbol calls')
  .option('-p, --path <path>', 'Project path')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { path?: string; limit?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const limit = parseInt(options.limit || '20', 10);

      const matches = cg.searchNodes(symbol, { limit: 50 });
      if (matches.length === 0) {
        info(`Symbol "${symbol}" not found`);
        cg.destroy();
        return;
      }

      const seen = new Set<string>();
      const allCallees: Array<{ name: string; kind: string; filePath: string; startLine?: number }> = [];

      for (const match of matches) {
        const exactMatch = match.node.name === symbol || match.node.name.endsWith(`.${symbol}`) || match.node.name.endsWith(`::${symbol}`);
        if (!exactMatch && matches.length > 1) continue;
        for (const c of cg.getCallees(match.node.id)) {
          if (!seen.has(c.node.id)) {
            seen.add(c.node.id);
            allCallees.push({ name: c.node.name, kind: c.node.kind, filePath: c.node.filePath, startLine: c.node.startLine });
          }
        }
      }

      if (allCallees.length === 0 && matches[0]) {
        for (const c of cg.getCallees(matches[0].node.id)) {
          if (!seen.has(c.node.id)) {
            seen.add(c.node.id);
            allCallees.push({ name: c.node.name, kind: c.node.kind, filePath: c.node.filePath, startLine: c.node.startLine });
          }
        }
      }

      const limited = allCallees.slice(0, limit);

      if (options.json) {
        console.log(JSON.stringify({ symbol, callees: limited }, null, 2));
      } else if (limited.length === 0) {
        info(`No callees found for "${symbol}"`);
      } else {
        console.log(chalk.bold(`\nCallees of "${symbol}" (${limited.length}):\n`));
        for (const node of limited) {
          const loc = node.startLine ? `:${node.startLine}` : '';
          console.log(
            chalk.cyan(node.kind.padEnd(12)) +
            chalk.white(node.name)
          );
          console.log(chalk.dim(`  ${node.filePath}${loc}`));
          console.log();
        }
      }

      cg.destroy();
    } catch (err) {
      error(`callees failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship impact <symbol>
 */
program
  .command('impact <symbol>')
  .description('Analyze what code is affected by changing a symbol')
  .option('-p, --path <path>', 'Project path')
  .option('-d, --depth <number>', 'Traversal depth', '2')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { path?: string; depth?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const depth = Math.min(Math.max(parseInt(options.depth || '2', 10), 1), 10);

      const matches = cg.searchNodes(symbol, { limit: 50 });
      if (matches.length === 0) {
        info(`Symbol "${symbol}" not found`);
        cg.destroy();
        return;
      }

      // Merge impact subgraphs across all exact-matching symbols
      const mergedNodes = new Map<string, { name: string; kind: string; filePath: string; startLine?: number }>();
      const seenEdges = new Set<string>();
      let edgeCount = 0;

      for (const match of matches) {
        const exactMatch = match.node.name === symbol || match.node.name.endsWith(`.${symbol}`) || match.node.name.endsWith(`::${symbol}`);
        if (!exactMatch && matches.length > 1) continue;
        const impact = cg.getImpactRadius(match.node.id, depth);
        for (const [id, n] of impact.nodes) {
          mergedNodes.set(id, { name: n.name, kind: n.kind, filePath: n.filePath, startLine: n.startLine });
        }
        for (const e of impact.edges) {
          const key = `${e.source}->${e.target}:${e.kind}`;
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            edgeCount++;
          }
        }
      }

      // Fallback to top match if exact filter removed everything
      if (mergedNodes.size === 0 && matches[0]) {
        const impact = cg.getImpactRadius(matches[0].node.id, depth);
        for (const [id, n] of impact.nodes) {
          mergedNodes.set(id, { name: n.name, kind: n.kind, filePath: n.filePath, startLine: n.startLine });
        }
        edgeCount = impact.edges.length;
      }

      if (options.json) {
        console.log(JSON.stringify({
          symbol,
          depth,
          nodeCount: mergedNodes.size,
          edgeCount,
          affected: Array.from(mergedNodes.values()),
        }, null, 2));
      } else if (mergedNodes.size === 0) {
        info(`No affected symbols found for "${symbol}"`);
      } else {
        console.log(chalk.bold(`\nImpact of changing "${symbol}" — ${mergedNodes.size} affected symbols:\n`));

        // Group by file
        const byFile = new Map<string, Array<{ name: string; kind: string; startLine?: number }>>();
        for (const node of mergedNodes.values()) {
          const list = byFile.get(node.filePath) || [];
          list.push({ name: node.name, kind: node.kind, startLine: node.startLine });
          byFile.set(node.filePath, list);
        }

        for (const [file, nodes] of byFile) {
          console.log(chalk.cyan(file));
          for (const node of nodes) {
            const loc = node.startLine ? `:${node.startLine}` : '';
            console.log(`  ${chalk.dim(node.kind.padEnd(12))}${node.name}${chalk.dim(loc)}`);
          }
          console.log();
        }
      }

      cg.destroy();
    } catch (err) {
      error(`impact failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship affected [files...]
 *
 * Find test files affected by the given source files.
 * Traces dependency edges transitively to find test files that depend on changed code.
 *
 * Usage:
 *   git diff --name-only | specship affected --stdin
 *   specship affected src/lib/components/Editor.svelte src/routes/+page.svelte
 */
program
  .command('affected [files...]')
  .description('Find test files affected by changed source files')
  .option('-p, --path <path>', 'Project path')
  .option('--stdin', 'Read file list from stdin (one per line)')
  .option('-d, --depth <number>', 'Max dependency traversal depth', '5')
  .option('-f, --filter <glob>', 'Custom glob filter for test files (e.g. "e2e/*.spec.ts")')
  .option('-j, --json', 'Output as JSON')
  .option('-q, --quiet', 'Only output file paths, no decoration')
  .action(async (fileArgs: string[], options: { path?: string; stdin?: boolean; depth?: string; filter?: string; json?: boolean; quiet?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`SpecShip not initialized in ${projectPath}`);
        process.exit(1);
      }

      // Collect changed files from args or stdin
      let changedFiles: string[] = [...(fileArgs || [])];

      if (options.stdin) {
        const stdinData = fs.readFileSync(0, 'utf-8');
        const stdinFiles = stdinData.split('\n').map(f => f.trim()).filter(Boolean);
        changedFiles.push(...stdinFiles);
      }

      if (changedFiles.length === 0) {
        if (!options.quiet) info('No files provided. Use file arguments or --stdin.');
        process.exit(0);
      }

      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectPath);
      const maxDepth = parseInt(options.depth || '5', 10);

      // Common test file patterns
      const defaultTestPatterns = [
        /\.spec\./,
        /\.test\./,
        /\/__tests__\//,
        /\/tests?\//,
        /\/e2e\//,
        /\/spec\//,
      ];

      // Custom filter pattern
      let customFilter: RegExp | null = null;
      if (options.filter) {
        // Convert glob to regex: ** → .+, * → [^/]*, . → \.
        const regex = options.filter
          .replace(/[+[\]{}()^$|\\]/g, '\\$&')
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.+')
          .replace(/\*/g, '[^/]*');
        customFilter = new RegExp(regex);
      }

      function isTestFile(filePath: string): boolean {
        if (customFilter) return customFilter.test(filePath);
        return defaultTestPatterns.some(p => p.test(filePath));
      }

      // BFS to find all transitive dependents of changed files, filtered to test files
      const affectedTests = new Set<string>();
      const allDependents = new Set<string>();

      for (const file of changedFiles) {
        // If the changed file is itself a test file, include it
        if (isTestFile(file)) {
          affectedTests.add(file);
          continue;
        }

        // BFS through dependents
        const queue: Array<{ file: string; depth: number }> = [{ file, depth: 0 }];
        const visited = new Set<string>();
        visited.add(file);

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current.depth >= maxDepth) continue;

          const dependents = cg.getFileDependents(current.file);
          for (const dep of dependents) {
            if (visited.has(dep)) continue;
            visited.add(dep);
            allDependents.add(dep);

            if (isTestFile(dep)) {
              affectedTests.add(dep);
            } else {
              queue.push({ file: dep, depth: current.depth + 1 });
            }
          }
        }
      }

      const sortedTests = Array.from(affectedTests).sort();

      // Output
      if (options.json) {
        console.log(JSON.stringify({
          changedFiles,
          affectedTests: sortedTests,
          totalDependentsTraversed: allDependents.size,
        }, null, 2));
      } else if (options.quiet) {
        for (const t of sortedTests) console.log(t);
      } else {
        if (sortedTests.length === 0) {
          info('No test files affected by the changed files.');
        } else {
          console.log(chalk.bold(`\nAffected test files (${sortedTests.length}):\n`));
          for (const t of sortedTests) {
            console.log('  ' + chalk.cyan(t));
          }
          console.log();
        }
      }

      cg.destroy();
    } catch (err) {
      error(`Affected analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship install
 */
program
  .command('install')
  .description('Install specship MCP server into Claude Code')
  .option('-l, --location <where>', 'Install location: "global" or "local". Default: prompt (local)')
  .option('-y, --yes', 'Non-interactive: defaults to --location=local, auto-allow on')
  .option('--no-permissions', 'Skip writing the auto-allow permissions list')
  .option('--sdd', '(default) Install the spec-driven-development governance tier (spec/authoring/review/design commands + the spec-author nudge hook)')
  .option('--no-sdd', 'Skip the governance tier — retrieval-only install (the pre-0.18 default)')
  .option('--path <repo>', 'Target repo to wire and initialize (default: current directory). Project-local files and the .specship index land there')
  .option('--with-jira', 'Enable the optional JIRA integration (talks to your Atlassian instance; off by default — the core install is 100% local)')
  .option('--with-designer', 'Enable the optional Designer integration (EXPERIMENTAL — drives claude.ai/design via a debug Chrome session and may break without notice; off by default)')
  .option('--statusline', 'Wire the SpecShip status-line segment into Claude (skips the prompt; never overwrites an existing status line)')
  .option('--skip-statusline', 'Do not add the status-line segment (skips the prompt)')
  .option('--skip-index', 'Do not offer to index the current project (an explicit opt-out for automation)')
  .option('--print-config', 'Print MCP config snippet for Claude Code and exit (no file writes)')
  // -t/--target is vestigial — kept so existing `--target claude` / `--target auto`
  // invocations (including our own offline-install scripts) keep working.
  .option('-t, --target <ids>', '(vestigial) accepted: "claude" | "auto" | "all" | "none"')
  .action(async (opts: {
    target?: string;
    location?: string;
    yes?: boolean;
    permissions?: boolean;
    sdd?: boolean;
    withJira?: boolean;
    withDesigner?: boolean;
    statusline?: boolean;
    skipStatusline?: boolean;
    skipIndex?: boolean;
    printConfig?: boolean;
    path?: string;
  }) => {
    if (opts.printConfig) {
      const { claudeTarget } = await import('../installer/targets/claude');
      const loc = (opts.location === 'local' ? 'local' : 'global') as 'global' | 'local';
      process.stdout.write(claudeTarget.printConfig(loc));
      return;
    }

    // Target repo (INSTALL-SCOPE-DOC, REQ-SCOPE-002): the project-local
    // wiring and the .specship index land in --path, not wherever the
    // command happened to run. Same semantics as the bundle installer's
    // --path — implemented the same way (the local writers are cwd-based).
    if (opts.path) {
      const target = path.resolve(opts.path);
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        error(`--path '${opts.path}' is not a directory`);
        process.exit(1);
      }
      process.chdir(target);
    }

    const { runInstallerWithOptions } = await import('../installer');
    if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
      error(`--location must be "global" or "local" (got "${opts.location}").`);
      process.exit(1);
    }
    try {
      // Commander's `--no-permissions` makes `opts.permissions === false`;
      // omitting the flag leaves it `true` (the positive-form default).
      // We MUST treat the default-true as "user did not override — let
      // the orchestrator prompt" and only forward an explicit `false`
      // (or `true` when --yes implies it). Otherwise the auto-allow
      // prompt is silently skipped on every interactive run.
      const explicitNoPermissions = opts.permissions === false;
      const autoAllow: boolean | undefined = explicitNoPermissions
        ? false
        : opts.yes
          ? true
          : undefined;

      // Status-line opt-in: `--statusline` forces on, `--skip-statusline`
      // forces off (both skip the prompt); neither ⇒ undefined ⇒ ask
      // interactively (default no). Distinct flag names dodge commander's
      // `--no-*` default-true coupling that would auto-install.
      const statusLine: boolean | undefined = opts.statusline
        ? true
        : opts.skipStatusline
          ? false
          : undefined;

      // The governance tier is opt-in (INSTALL-WEDGE-DOC): `--sdd` makes
      // `opts.sdd === true`; omitting it leaves it undefined → retrieval-only.
      // Forward `true` only when the user explicitly opted in.
      await runInstallerWithOptions({
        target: opts.target,
        location: opts.location as 'global' | 'local' | undefined,
        autoAllow,
        // SDD/governance is default-ON (INSTALL-WEDGE-DOC v2): commander's
        // --no-sdd sets opts.sdd=false; otherwise install the full surface.
        sdd: opts.sdd === false ? false : true,
        withJira: opts.withJira === true ? true : undefined,
        withDesigner: opts.withDesigner === true ? true : undefined,
        statusLine,
        yes: opts.yes,
      });

      // Offer to index the current project (REQ-HANDSHAKE-004) before the smoke
      // check, so an accepted index is reflected by the index-queryable item.
      const cwd = process.cwd();
      const { decideInstallInit } = await import('../installer/init-offer');
      const { isGitRepo } = await import('../sync/git-hooks');
      const initDecision = decideInstallInit({
        isGitRepo: isGitRepo(cwd),
        isInitialized: isInitialized(cwd),
        yes: opts.yes === true,
        skipIndex: opts.skipIndex === true,
      });
      let doIndex = initDecision === 'auto-index';
      if (initDecision === 'offer') {
        const clack = await importESM('@clack/prompts');
        const ans = await clack.confirm({
          message: `Index this project (${cwd}) now, so Claude can explore it?`,
        });
        doIndex = ans === true; // a cancel (symbol) or "no" both decline (REQ-HANDSHAKE-004.A2)
      }
      if (doIndex) {
        console.log();
        info(`Indexing ${cwd} …`);
        try {
          await buildProjectIndex(cwd);
          success('Project indexed.');
        } catch (e) {
          warn(`Indexing failed (run \`specship init -i\` later): ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Post-install smoke check (REQ-HANDSHAKE-002). Advisory: report failing
      // items but never exit non-zero (REQ-HANDSHAKE-002.A4), so a provisioning
      // script is never broken by it — the gating equivalent is `specship doctor`.
      const { runSmokeCheck } = await import('../health/smoke-check');
      const smoke = await runSmokeCheck({ projectRoot: process.cwd() });
      console.log('\n' + chalk.bold('Install check'));
      renderSmokeCheck(smoke);
      if (!smoke.ok) {
        console.log(chalk.dim('  (advisory — diagnose anytime with `specship doctor`)'));
      }

      // Restart reminder (REQ-HANDSHAKE-001): an MCP server added to the config
      // is NOT visible to a Claude Code session that was already open.
      console.log();
      info('Restart Claude Code (or run `/mcp`) to load the SpecShip server — it is not visible in a session that is already open.');
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

/**
 * specship doctor — diagnose an install (REQ-HANDSHAKE-003). Read-only: runs the
 * same checks as the post-install smoke check and writes nothing. Exits non-zero
 * on a usage-blocking failure so it can gate a script or CI step.
 */
program
  .command('doctor [path]')
  .description('Diagnose a SpecShip install (runtime · FTS5 · MCP boot · index). Exits non-zero on a usage-blocking failure.')
  .option('-j, --json', 'Output as JSON')
  .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectRoot = path.resolve(pathArg ?? process.cwd());
    const { runSmokeCheck, doctorExitCode } = await import('../health/smoke-check');
    const result = await runSmokeCheck({ projectRoot });
    const code = doctorExitCode(result);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(code);
    }

    console.log(chalk.bold('\nSpecShip doctor\n'));
    renderSmokeCheck(result);
    console.log();
    if (code === 0) {
      success('No usage-blocking problems detected.');
    } else {
      error(`Usage-blocking checks failed: ${result.blockingFailures.map((i) => i.id).join(', ')}`);
    }
    process.exit(code);
  });

/**
 * specship starter-prompt — print the manufactured first-run flow/impact prompt
 * (ACTIVATION-DOC). The single delivery mechanism for the bare `/specship:explore`
 * door: it self-gates (prints nothing if the index can't be queried —
 * REQ-ACTIVATION-004) and self-retires (prints nothing once a real specship
 * lookup has been recorded this session — REQ-ACTIVATION-003).
 */
program
  .command('starter-prompt [path]')
  .description('Print a suggested first flow/impact prompt for this project (used by the /specship:explore door).')
  .option('-j, --json', 'Output as JSON')
  .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectRoot = path.resolve(pathArg ?? process.cwd());
    // Not indexed → nothing (REQ-ACTIVATION-004.A2: the door shows its own guidance).
    if (!isInitialized(projectRoot)) return;

    // Retire once the agent has actually used retrieval this session
    // (REQ-ACTIVATION-003) — the per-session marker counts specship lookups.
    try {
      const { readSessionMarker } = await import('../statusline/session-marker');
      const marker = readSessionMarker(projectRoot);
      if (marker && marker.calls > 0) return;
    } catch {
      /* no marker yet → not retired */
    }

    try {
      const { default: SpecShip } = await loadSpecShip();
      const cg = await SpecShip.open(projectRoot);
      try {
        const { generateStarterPrompt } = await import('../activation/starter-prompt');
        const sp = generateStarterPrompt(cg);
        if (!sp) return; // can't generate (unqueryable index / empty graph) → nothing (REQ-ACTIVATION-004)
        if (options.json) {
          console.log(JSON.stringify(sp));
        } else {
          console.log(sp.prompt);
        }
      } finally {
        cg.destroy();
      }
    } catch {
      // Index unreadable / FTS5 missing → print nothing (REQ-ACTIVATION-004.A1).
    }
  });

/**
 * specship spec-nudge  (internal — installed as a UserPromptSubmit hook)
 *
 * Reads the UserPromptSubmit JSON payload from stdin and, when the prompt
 * looks like feature/bug work, prints a non-blocking reminder (as
 * `hookSpecificOutput.additionalContext`) to author the spec via spec-author
 * first. Always exits 0 so the prompt proceeds. Conservative: skips clear
 * questions / read-only asks so it doesn't nag (SDD-INSTALL-DOC, REQ-SDD-002).
 */
program
  .command('spec-nudge')
  .description('Internal hook: nudge toward spec-author on feature/bug intent (UserPromptSubmit)')
  .action(async () => {
    const shouldNudge = (prompt: string): boolean => {
      const text = (prompt || '').trim();
      if (text.length < 12) return false;
      if (/[?]\s*$/.test(text)) return false; // a question
      const lower = text.toLowerCase();
      // Read-only / interrogative openers — never spec-shaped.
      if (/^(what|why|how|where|who|when|is|are|does|do|can|could|should|explain|show|list|describe|tell|summar|read|find|search|look|run|why)\b/.test(lower)) return false;
      // Feature / bug-shaped intent verbs.
      return /\b(add|implement|build|create|introduce|support|enhance|fix|bug|broken|refactor|rewrite|migrate|change|modify|update|wire|integrate|feature|spec out)\b/.test(lower);
    };

    const chunks: Buffer[] = [];
    try {
      for await (const c of process.stdin) chunks.push(c as Buffer);
    } catch { /* no stdin — nothing to nudge */ }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    let prompt = '';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        prompt = typeof parsed?.prompt === 'string' ? parsed.prompt : raw;
      } catch {
        prompt = raw; // not JSON — treat as the raw prompt text
      }
    }

    if (shouldNudge(prompt)) {
      const additionalContext =
        'This repo uses spec-driven development (SpecShip). Before any brainstorming or ' +
        'planning skill, FIRST invoke spec-author to author the spec under specs/ for this ' +
        'work — the spec is the contract; implement from it with /specship:spec implement.';
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }) + '\n',
      );
    }
    process.exit(0);
  });

/**
 * specship steer-nudge (STEER-HOOK-DOC)
 *
 * Internal UserPromptSubmit hook command: inject the one-line retrieval
 * steering nudge — the high-salience channel that measurably fixes
 * specship-tool adoption. Exits 0 with empty output when the project has no
 * `.specship/` index or `SPECSHIP_NO_STEERING=1` is set (REQ-STEER-002).
 */
program
  .command('steer-nudge')
  .description('Internal hook: steer flow/structure questions to specship_explore (UserPromptSubmit)')
  .action(async () => {
    // Prefer the hook payload's cwd (Claude Code sends it on stdin) so the
    // check targets the project the prompt belongs to, not wherever the hook
    // process happened to spawn.
    let cwd = process.cwd();
    let transcriptPath: string | null = null;
    const chunks: Buffer[] = [];
    try {
      for await (const c of process.stdin) chunks.push(c as Buffer);
    } catch { /* no stdin — fall back to process.cwd() */ }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.cwd === 'string' && parsed.cwd.length > 0) cwd = parsed.cwd;
        if (typeof parsed?.transcript_path === 'string' && parsed.transcript_path.length > 0) {
          transcriptPath = parsed.transcript_path;
        }
      } catch { /* not JSON — keep process.cwd() */ }
    }

    // Record the session's model from the transcript tail (MODCTX-DOC,
    // REQ-MODCTX-001.A4) — the primary detection channel, present on every
    // default install. Fires per prompt so mid-session /model switches
    // track; runs even when the steering text is suppressed, but only in
    // initialized projects. Best-effort: never fails the hook.
    if (transcriptPath && fs.existsSync(path.join(cwd, '.specship'))) {
      try {
        const { readModelFromTranscript, recordSessionModel } = await import('../mcp/model-context');
        const model = readModelFromTranscript(transcriptPath);
        if (model) recordSessionModel(cwd, model);
      } catch { /* telemetry must never break the hook */ }
    }

    const { buildSteeringNudge } = await import('../activation/steering');
    const additionalContext = buildSteeringNudge(cwd);
    if (additionalContext) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }) + '\n',
      );
    }
    process.exit(0);
  });

/**
 * specship uninstall
 *
 * Inverse of `install`. Removes the specship MCP server entry and
 * permissions from Claude Code. Prompts global-vs-local when not
 * given. Does NOT delete the `.specship/` index — that's
 * `specship uninit`.
 */
program
  .command('uninstall')
  .description('Completely remove SpecShip (wiring, indexes, ~/.specship data, and the binary)')
  .option('-y, --yes', 'Skip the confirmation prompt (also: --force)')
  .option('-f, --force', 'Alias for --yes')
  .option('--keep-data', 'Only unwire from Claude Code; keep the indexes, ~/.specship data, and the binary')
  .option('-l, --location <where>', 'With --keep-data: which wiring to remove ("global" or "local")')
  // vestigial — kept so existing `--target claude` invocations keep working.
  .option('-t, --target <ids>', '(vestigial) accepted: "claude" | "auto" | "all" | "none"')
  .action(async (opts: {
    target?: string;
    location?: string;
    yes?: boolean;
    force?: boolean;
    keepData?: boolean;
  }) => {
    const { runUninstaller } = await import('../installer');
    if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
      error(`--location must be "global" or "local" (got "${opts.location}").`);
      process.exit(1);
    }
    // Resolve the purge env the same way `specship update` does: the running
    // binary's dir anchors install-method detection; SPECSHIP_* env overrides
    // the bundle install/bin locations.
    const installDir = process.env.SPECSHIP_INSTALL_DIR || path.join(os.homedir(), '.specship');
    const binDir = process.env.SPECSHIP_BIN_DIR || path.join(os.homedir(), '.local', 'bin');
    try {
      await runUninstaller({
        target: opts.target,
        location: opts.location as 'global' | 'local' | undefined,
        yes: opts.yes || opts.force,
        keepData: opts.keepData,
        purgeEnv: {
          cwd: process.cwd(),
          homedir: os.homedir(),
          installDir,
          binDir,
          method: detectInstallMethod(__dirname, installDir),
        },
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================================================
// Spec layer / Workflow engine commands (v5)
// =============================================================================

program
  .command('drifted [path]')
  .description('List spec links in concerning states (drifted, broken, orphaned).')
  .option('-s, --state <list>', 'comma-separated states (default: drifted,broken,orphaned)')
  .option('-l, --limit <n>', 'max links to print (default: 50)')
  .option('--fail-on <list>', 'comma-separated states that cause non-zero exit (CI gate)')
  .option('--json', 'emit JSON')
  .action(async (
    pathArg: string | undefined,
    options: { state?: string; limit?: string; failOn?: string; json?: boolean }
  ) => {
    const projectRoot = path.resolve(pathArg ?? process.cwd());
    if (!isInitialized(projectRoot)) {
      error(`SpecShip not initialized in ${projectRoot}. Run \`specship init -i\` first.`);
      process.exit(1);
    }
    const { SpecShip } = await loadSpecShip();
    const cg = await SpecShip.open(projectRoot);
    try {
      const states = (options.state ?? 'drifted,broken,orphaned')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as Array<'drafted' | 'implementing' | 'implemented' | 'verified' | 'drifted' | 'broken' | 'orphaned'>;
      const limit = options.limit ? Math.max(1, parseInt(options.limit, 10) || 50) : 50;
      const links = cg.getSpecQueries().getLinksByState(states).slice(0, limit);

      if (options.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ count: links.length, links }, null, 2));
      } else if (links.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`No links in states: ${states.join(', ')}. ✨ Drift queue is clean.`);
      } else {
        for (const link of links) {
          const drift = link.driftAxis ? ` [drift=${link.driftAxis}]` : '';
          // eslint-disable-next-line no-console
          console.log(
            `#${link.id} [${link.state}${drift}] ${link.specId} → ${link.targetFilePath}:${link.targetQualifiedName} <${link.provenance}>`
          );
        }
      }

      if (options.failOn) {
        const failStates = options.failOn.split(',').map((s) => s.trim()).filter(Boolean);
        const offending = links.filter((l) => failStates.includes(l.state));
        if (offending.length > 0) {
          process.exit(1);
        }
      }
    } finally {
      cg.close();
    }
  });

// @implements REQ-DOMAIN-003
// Thin surface over the read-only gap-seed pass (SpecShip.getDomainGapSeed,
// REQ-DOMAIN-003) so the `/specship:spec domain` capture command can cite the SAME real
// undocumented entities/specs the library computes (REQ-DOMAIN-004.A4) without a
// new MCP tool (REQ-DOMAIN-005) or a runtime package import. Writes nothing.
program
  .command('domain-gaps [path]')
  .description('List code entities and specs not yet covered by a domain fact (the domain gap-seed). Feeds the /specship:spec domain capture interview.')
  .option('-l, --limit <n>', 'max entities and specs to print in text mode (default: 50)')
  .option('--json', 'emit JSON')
  .action(async (pathArg: string | undefined, options: { limit?: string; json?: boolean }) => {
    const projectRoot = path.resolve(pathArg ?? process.cwd());
    if (!isInitialized(projectRoot)) {
      error(`SpecShip not initialized in ${projectRoot}. Run \`specship init -i\` first.`);
      process.exit(1);
    }
    const { default: SpecShip } = await loadSpecShip();
    const cg = await SpecShip.open(projectRoot);
    try {
      const seed = cg.getDomainGapSeed();

      if (options.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(seed, null, 2));
        return;
      }

      const limit = options.limit ? Math.max(1, parseInt(options.limit, 10) || 50) : 50;
      const { documented, gaps } = seed.coverage;
      const total = documented + gaps;
      /* eslint-disable no-console */
      console.log(`Domain coverage: ${documented}/${total} documented · ${gaps} gap${gaps === 1 ? '' : 's'}`);
      if (gaps === 0) {
        console.log('✨ Every in-scope entity and spec is covered by a domain fact.');
      } else {
        if (seed.entities.length > 0) {
          console.log(`\nUndocumented entities (${seed.entities.length}):`);
          for (const e of seed.entities.slice(0, limit)) {
            console.log(`  [${e.kind}] ${e.qualifiedName} — ${e.filePath}`);
          }
          if (seed.entities.length > limit) console.log(`  … and ${seed.entities.length - limit} more`);
        }
        if (seed.specs.length > 0) {
          console.log(`\nUndocumented specs (${seed.specs.length}):`);
          for (const s of seed.specs.slice(0, limit)) {
            console.log(`  [${s.kind}] ${s.id} — ${s.title}`);
          }
          if (seed.specs.length > limit) console.log(`  … and ${seed.specs.length - limit} more`);
        }
        console.log(`\nCapture a fact for any of these with \`/specship:spec domain\`.`);
      }
      /* eslint-enable no-console */
    } finally {
      cg.close();
    }
  });

// @implements REQ-FUNNEL-004
program
  .command('spec [id]')
  .description('Spec lifecycle funnel (idea → spec → implemented). With an id, show that spec/brief detail.')
  .option('--json', 'emit JSON')
  .action(async (id: string | undefined, options: { json?: boolean }) => {
    const projectRoot = path.resolve(process.cwd());
    if (!isInitialized(projectRoot)) {
      error(`SpecShip not initialized in ${projectRoot}. Run \`specship init -i\` first.`);
      process.exit(1);
    }
    const { default: SpecShip } = await loadSpecShip();
    const { summarizeBriefFunnel, resolveBriefLink, findBriefsForSpec } = await import(
      '../resolution/brief-link-resolver'
    );
    const cg = await SpecShip.open(projectRoot);
    try {
      const sq = cg.getSpecQueries();

      // Implementation rollup for a document's requirements.
      const docRollup = (docId: string) => {
        const reqs = sq.getSpecsByParent(docId).filter((s) => s.kind === 'requirement');
        const r = { requirements: reqs.length, implemented: 0, verified: 0, drifted: 0, broken: 0, orphaned: 0 };
        for (const req of reqs) {
          for (const lk of sq.getLinksBySpec(req.id)) {
            if (lk.state === 'implemented') r.implemented++;
            else if (lk.state === 'verified') r.verified++;
            else if (lk.state === 'drifted') r.drifted++;
            else if (lk.state === 'broken') r.broken++;
            else if (lk.state === 'orphaned') r.orphaned++;
          }
        }
        return r;
      };
      const degraded = (r: { drifted: number; broken: number; orphaned: number }) =>
        r.drifted + r.broken + r.orphaned;

      // ---- Detail view (an id was given) ----
      if (id) {
        const spec = sq.getSpecById(id);
        if (!spec) {
          if (options.json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({ error: 'not_found', id }, null, 2));
          } else {
            error(`No spec or brief with id "${id}".`);
          }
          process.exit(1);
        }
        if (spec!.kind === 'brief') {
          const entry = summarizeBriefFunnel(sq, spec!);
          const link = resolveBriefLink(sq, spec!);
          if (options.json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({ ...entry, briefSide: link.briefSide, specSide: link.specSide }, null, 2));
          } else {
            /* eslint-disable no-console */
            console.log(`${spec!.id}  (brief)  ${spec!.title}`);
            console.log(`  state: ${entry.state}`);
            if (entry.state === 'conflict') {
              console.log(`  ⚠ conflict: brief → ${link.briefSide}, spec → ${link.specSide} (resolve the mismatched pointer)`);
            } else if (entry.linkedSpecId) {
              console.log(`  linked spec: ${entry.linkedSpecId}`);
            }
            if (entry.rollup) {
              const r = entry.rollup;
              console.log(`  rollup: ${r.requirements} reqs · ${r.implemented} implemented · ${r.verified} verified · ${degraded(r)} degraded`);
            }
            /* eslint-enable no-console */
          }
        } else {
          const links = sq.getLinksBySpec(spec!.id);
          const briefs = spec!.kind === 'document' ? findBriefsForSpec(sq, spec!.id) : [];
          if (options.json) {
            const detail: Record<string, unknown> = { id: spec!.id, kind: spec!.kind, title: spec!.title, links };
            if (spec!.kind === 'document') detail.rollup = docRollup(spec!.id);
            detail.briefs = briefs.map((b) => b.briefId);
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(detail, null, 2));
          } else {
            /* eslint-disable no-console */
            console.log(`${spec!.id}  (${spec!.kind})  ${spec!.title}`);
            if (spec!.kind === 'document') {
              const r = docRollup(spec!.id);
              console.log(`  rollup: ${r.requirements} reqs · ${r.implemented} implemented · ${r.verified} verified · ${degraded(r)} degraded`);
              if (briefs.length) console.log(`  from briefs: ${briefs.map((b) => b.briefId).join(', ')}`);
            }
            for (const lk of links) {
              console.log(`  [${lk.state}] → ${lk.targetFilePath}:${lk.targetQualifiedName}`);
            }
            /* eslint-enable no-console */
          }
        }
        return;
      }

      // ---- Funnel view (no id) ----
      const all = sq.getAllSpecs();
      const briefs = all.filter((s) => s.kind === 'brief');
      const documents = all.filter((s) => s.kind === 'document');
      const requirements = all.filter((s) => s.kind === 'requirement');
      const entries = briefs.map((b) => summarizeBriefFunnel(sq, b));
      const byState = (st: string) => entries.filter((e) => e.state === st);
      const links = sq.getAllLinks();
      const lc = (st: string) => links.filter((l) => l.state === st).length;

      if (all.length === 0) {
        if (options.json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ summary: { ideas: 0, specified: 0, conflicts: 0, documents: 0, requirements: 0 }, specs: [], briefs: [] }, null, 2));
        } else {
          // eslint-disable-next-line no-console
          console.log('No specs or briefs found. Author one with /specship:spec new.');
        }
        return;
      }

      if (options.json) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              summary: {
                ideas: byState('idea').length,
                specified: byState('specified').length,
                conflicts: byState('conflict').length,
                documents: documents.length,
                requirements: requirements.length,
                links: { implemented: lc('implemented'), verified: lc('verified'), drifted: lc('drifted'), broken: lc('broken'), orphaned: lc('orphaned') },
              },
              specs: documents.map((d) => ({ id: d.id, title: d.title, rollup: docRollup(d.id) })),
              briefs: entries,
            },
            null,
            2
          )
        );
        return;
      }

      /* eslint-disable no-console */
      console.log('Spec lifecycle funnel');
      console.log(`  ideas        ${byState('idea').length}`);
      console.log(`  specified    ${byState('specified').length}`);
      if (byState('conflict').length) console.log(`  conflicts    ${byState('conflict').length}  ⚠`);
      console.log(`  documents    ${documents.length}`);
      console.log(`  requirements ${requirements.length}   (implemented ${lc('implemented')} · verified ${lc('verified')} · degraded ${lc('drifted') + lc('broken') + lc('orphaned')})`);
      if (documents.length) {
        console.log('\nDocuments:');
        for (const d of documents) {
          const r = docRollup(d.id);
          console.log(`  ${d.id}  —  ${d.title}   [${r.requirements} reqs · ${r.implemented} impl · ${r.verified} ver${degraded(r) ? ` · ${degraded(r)} degraded` : ''}]`);
        }
      }
      const ideas = byState('idea');
      if (ideas.length) {
        console.log('\nIdeas (unlinked briefs):');
        for (const e of ideas) {
          const b = sq.getSpecById(e.briefId);
          console.log(`  ${e.briefId}  —  ${b?.title ?? ''}`);
        }
      }
      const conflicts = byState('conflict');
      if (conflicts.length) {
        console.log('\nConflicts (mismatched brief↔spec pointers):');
        for (const e of conflicts) console.log(`  ${e.briefId}  ⚠`);
      }
      /* eslint-enable no-console */
    } finally {
      cg.close();
    }
  });

program
  .command('workflow <action> [arg]')
  .description('Workflow engine: list | run <name> | resume <runId> | cancel <runId> | approve <runId> | reject <runId> | purge <runId> | runs')
  .option('-i, --input <kv...>', 'workflow inputs as KEY=VALUE (repeatable)')
  .option('--path <projectRoot>', 'project root (default: cwd)')
  .option('--comment <text>', 'comment for approve/reject')
  .option('--reason <text>', 'reason for cancel/reject')
  .option('--json', 'emit JSON where applicable')
  .action(async (
    action: string,
    arg: string | undefined,
    options: { input?: string[]; path?: string; comment?: string; reason?: string; json?: boolean }
  ) => {
    const projectRoot = path.resolve(options.path ?? process.cwd());
    if (!isInitialized(projectRoot)) {
      error(`SpecShip not initialized in ${projectRoot}. Run \`specship init -i\` first.`);
      process.exit(1);
    }
    const { SpecShip } = await loadSpecShip();
    const { discoverWorkflows, loadWorkflowByName } = await import('../workflows/discovery');
    const { WorkflowExecutor } = await import('../workflows/executor');
    const { WorktreeProvider } = await import('../isolation/worktree');
    const { handleJiraRunCompletion } = await import('../mcp/jira-tools');

    const cg = await SpecShip.open(projectRoot);
    try {
      const specQueries = cg.getSpecQueries();
      const worktrees = new WorktreeProvider(specQueries);
      // On completion, a JIRA-started run raises its PR (REQ-JIRA-006); the hook
      // is a silent no-op for any run without `metadata.jira`.
      const executor = new WorkflowExecutor(
        specQueries,
        worktrees,
        projectRoot,
        async (run) => {
          await handleJiraRunCompletion(run, {
            getIsolationEnvById: (id) => specQueries.getIsolationEnvById(id),
            projectRoot,
            // eslint-disable-next-line no-console
            log: (m) => console.log(m),
          });
        },
      );

      switch (action) {
        case 'list': {
          const result = discoverWorkflows(projectRoot);
          if (options.json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({
              workflows: result.workflows.map((w) => ({
                name: w.workflow.name,
                scope: w.scope,
                sourcePath: w.sourcePath,
                description: w.workflow.description,
                nodes: w.workflow.nodes.length,
                requires: w.workflow.requires,
              })),
              errors: result.errors,
            }, null, 2));
          } else {
            for (const w of result.workflows) {
              // eslint-disable-next-line no-console
              console.log(`  [${w.scope}] ${w.workflow.name} (${w.workflow.nodes.length} nodes) — ${w.workflow.description ?? ''}`);
            }
            if (result.errors.length > 0) {
              // eslint-disable-next-line no-console
              console.error(`\n${result.errors.length} workflow file(s) had errors:`);
              for (const e of result.errors) {
                // eslint-disable-next-line no-console
                console.error(`  ${e.sourcePath}:`);
                for (const er of e.errors) {
                  // eslint-disable-next-line no-console
                  console.error(`    ${er.path}: ${er.message}`);
                }
              }
            }
          }
          break;
        }

        case 'run': {
          if (!arg) {
            error('workflow run requires a workflow name');
            process.exit(1);
          }
          const loaded = loadWorkflowByName(projectRoot, arg);
          if (!loaded) {
            error(`Workflow "${arg}" not found. Use \`specship workflow list\` to see available workflows.`);
            process.exit(1);
          }
          const inputs: Record<string, string> = {};
          for (const kv of options.input ?? []) {
            const eqIdx = kv.indexOf('=');
            if (eqIdx <= 0) {
              error(`--input must be KEY=VALUE (got "${kv}")`);
              process.exit(1);
            }
            inputs[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
          }
          // Check required inputs.
          for (const inp of loaded.workflow.inputs ?? []) {
            if (inp.required && !(inp.name in inputs)) {
              error(`Required input missing: --input ${inp.name}=...`);
              process.exit(1);
            }
          }
          // Apply declared defaults for any optional input not passed. This
          // makes the schema's `default` field actually take effect and means
          // a `$INPUT.X` reference to a declared-but-omitted optional input
          // resolves to its default (or "") instead of throwing OutputRefError
          // mid-run. Required inputs are already enforced above.
          for (const inp of loaded.workflow.inputs ?? []) {
            if (!(inp.name in inputs)) {
              inputs[inp.name] = inp.default ?? '';
            }
          }
          const result = await executor.start(loaded.workflow, {
            projectRoot,
            inputs,
            variables: {
              ARTIFACTS_DIR: path.join(getSpecShipDir(projectRoot), 'artifacts'),
              CONTEXT: projectRoot,
            },
          });
          if (options.json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({
              runId: result.run.id,
              status: result.run.status,
              isolationEnvId: result.run.isolationEnvId,
              nodeStates: Object.fromEntries(result.nodeStates),
            }, null, 2));
          } else {
            // eslint-disable-next-line no-console
            console.log(`Run ${result.run.id} → ${result.run.status}`);
            if (result.run.isolationEnvId) {
              // eslint-disable-next-line no-console
              console.log(`Worktree: ${result.run.isolationEnvId}`);
            }
            if (result.run.errorMessage) {
              // eslint-disable-next-line no-console
              console.log(`Error: ${result.run.errorMessage}`);
            }
          }
          if (result.run.status === 'failed') process.exit(1);
          break;
        }

        case 'resume': {
          if (!arg) {
            error('workflow resume requires a runId');
            process.exit(1);
          }
          const run = specQueries.getWorkflowRunById(arg);
          if (!run) {
            error(`Run ${arg} not found`);
            process.exit(1);
          }
          const loaded = loadWorkflowByName(projectRoot, run.workflowName);
          if (!loaded) {
            error(`Workflow "${run.workflowName}" no longer exists`);
            process.exit(1);
          }
          const result = await executor.resume(loaded.workflow, arg, {
            projectRoot,
            inputs: run.inputs,
            variables: {
              ARTIFACTS_DIR: path.join(getSpecShipDir(projectRoot), 'artifacts'),
              CONTEXT: projectRoot,
            },
          });
          // eslint-disable-next-line no-console
          console.log(`Run ${result.run.id} → ${result.run.status}`);
          if (result.run.status === 'failed') process.exit(1);
          break;
        }

        case 'cancel': {
          if (!arg) {
            error('workflow cancel requires a runId');
            process.exit(1);
          }
          executor.cancel(arg, options.reason ?? 'cancelled via CLI');
          // eslint-disable-next-line no-console
          console.log(`Run ${arg} cancelled`);
          break;
        }

        case 'approve': {
          if (!arg) {
            error('workflow approve requires a runId');
            process.exit(1);
          }
          executor.approve(arg, options.comment);
          // eslint-disable-next-line no-console
          console.log(`Run ${arg} approved. Call \`specship workflow resume ${arg}\` to continue.`);
          break;
        }

        case 'reject': {
          if (!arg) {
            error('workflow reject requires a runId');
            process.exit(1);
          }
          executor.reject(arg, options.reason ?? options.comment);
          // eslint-disable-next-line no-console
          console.log(
            `Run ${arg} rejected — parked with its worktree and artifacts intact.\n` +
            `  Revise:  specship workflow resume ${arg}   (runs the gate's on_reject prompt with your feedback, then re-pauses for review)\n` +
            `  Discard: specship workflow purge ${arg}    (removes the worktree — the only way anything is deleted)`
          );
          break;
        }

        case 'purge': {
          if (!arg) {
            error('workflow purge requires a runId');
            process.exit(1);
          }
          const purged = executor.purge(arg);
          // eslint-disable-next-line no-console
          console.log(
            purged.worktreeRemoved
              ? `Run ${arg} purged — worktree removed (${purged.workingPath ?? 'path unknown'}). Artifacts and the run record are kept.`
              : `Run ${arg} had no worktree — nothing to remove. Artifacts and the run record are kept.`
          );
          break;
        }

        case 'runs': {
          const runs = specQueries.getAllWorkflowRuns(50);
          if (options.json) {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(runs, null, 2));
          } else if (runs.length === 0) {
            // eslint-disable-next-line no-console
            console.log('No runs yet.');
          } else {
            for (const r of runs) {
              const dur = r.completedAt
                ? `${Math.round((r.completedAt - (r.startedAt ?? r.createdAt)) / 1000)}s`
                : '—';
              // eslint-disable-next-line no-console
              console.log(`${r.id.substring(0, 8)} [${r.status}] ${r.workflowName} (${dur})`);
            }
          }
          break;
        }

        default:
          error(`Unknown workflow action "${action}". Use: list | run | resume | cancel | approve | reject | purge | runs`);
          process.exit(1);
      }
    } finally {
      cg.close();
    }
  });

/**
 * specship update — self-update to the latest release (CLI-UPDATE-DOC).
 */
program
  .command('update')
  .description('Update SpecShip to the latest released version')
  .option('--check', 'Report whether an update is available without installing anything')
  .action(async (options: { check?: boolean }) => {
    const installDir = process.env.SPECSHIP_INSTALL_DIR || path.join(os.homedir(), '.specship');
    const binDir = process.env.SPECSHIP_BIN_DIR || path.join(os.homedir(), '.local', 'bin');

    const result = await runUpdate(
      {
        currentVersion: packageJson.version,
        // __dirname is the resolved location of the running specship.js —
        // under ~/.specship for a bundle install, under node_modules for npm.
        detect: (): InstallMethod => detectInstallMethod(__dirname, installDir),
        resolveLatest: (method) => resolveLatestVersion(method),
        runInstaller: (method) => runInstaller(method, { installDir, binDir }),
        installDir,
        binDir,
      },
      { check: options.check },
    );

    for (const line of result.lines) {
      if (result.exitCode === 0) info(line);
      else warn(line);
    }
    if (result.exitCode !== 0) process.exit(result.exitCode);
  });

/**
 * specship jira — connect SpecShip to a JIRA instance (REQ-JIRA-001).
 *
 * Two subcommands:
 *   - `configure` — collect base URL + credentials, infer the deployment,
 *     save to `~/.specship/jira.json` (0600, user-level only), then probe.
 *   - `test` — resolve the stored/env credentials and probe `/myself`.
 *
 * SECURITY: the token/PAT is NEVER echoed — not in a confirmation, not in
 * `test` output, not in an error message. On success we print only
 * "connected as <displayName>". Errors from the jira module are already
 * scrubbed of secrets (REQ-JIRA-009 builds on this).
 */
const jira = program
  .command('jira')
  .description('Connect SpecShip to a JIRA instance (Cloud or Data Center).');

jira
  .command('configure')
  .description('Save JIRA credentials to ~/.specship/jira.json (0600) and test the connection.')
  .option('--base-url <url>', 'JIRA base URL, e.g. https://acme.atlassian.net')
  .option('--email <email>', 'Cloud: account email (paired with --api-token)')
  .option('--api-token <token>', 'Cloud: API token (paired with --email)')
  .option('--pat <token>', 'Data Center: personal access token')
  .option('--deployment <kind>', 'Deployment kind: "cloud" or "datacenter" (inferred if omitted)')
  .option('--ca-cert <pem>', 'Path to a PEM CA bundle for a corporate/self-signed certificate (Data Center)')
  .option('--insecure-tls', 'Disable TLS certificate verification for JIRA requests only (last resort)')
  .option('--project <key>', 'Default project for spec→JIRA publishing (interactive setup offers your accessible projects)')
  .action(async (opts: {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    pat?: string;
    deployment?: string;
    caCert?: string;
    insecureTls?: boolean;
    project?: string;
  }) => {
    const {
      saveJiraConfig,
      resolveJiraCredentials,
      inferDeployment,
      jiraConfigPath,
      JiraClient,
      JiraAuthError,
    } = await import('../jira');
    type JiraConfigShape = import('../jira').JiraConfig;

    const clack = await importESM('@clack/prompts');
    const cancelled = (v: unknown): boolean => clack.isCancel(v);

    // Fully-flagged (non-interactive) path: base URL + a complete credential set.
    const flagged = Boolean(
      opts.baseUrl && (opts.pat || (opts.email && opts.apiToken)),
    );

    clack.intro('Configure JIRA');
    try {
      let config: JiraConfigShape;

      if (flagged) {
        const deployment = inferDeployment({
          deployment: opts.deployment as any,
          email: opts.email,
          apiToken: opts.apiToken,
          pat: opts.pat,
        });
        config = {
          baseUrl: opts.baseUrl!.trim(),
          deployment,
          email: opts.email,
          apiToken: opts.apiToken,
          pat: opts.pat,
        };
      } else {
        const baseUrl = opts.baseUrl ?? (await clack.text({
          message: 'JIRA base URL (include the context path if your instance has one, e.g. https://host:8443/jira)',
          placeholder: 'https://acme.atlassian.net',
          validate: (v: string) => (v && v.trim() ? undefined : 'Required'),
        }));
        if (cancelled(baseUrl)) { clack.cancel('Cancelled — nothing saved.'); return; }

        const deployment = (opts.deployment ?? (await clack.select({
          message: 'Deployment',
          options: [
            { value: 'cloud', label: 'Cloud (email + API token)' },
            { value: 'datacenter', label: 'Data Center / Server (personal access token)' },
          ],
        }))) as 'cloud' | 'datacenter';
        if (cancelled(deployment)) { clack.cancel('Cancelled — nothing saved.'); return; }

        config = { baseUrl: String(baseUrl).trim(), deployment };

        if (deployment === 'cloud') {
          const email = opts.email ?? (await clack.text({
            message: 'Account email',
            validate: (v: string) => (v && v.trim() ? undefined : 'Required'),
          }));
          if (cancelled(email)) { clack.cancel('Cancelled — nothing saved.'); return; }
          const apiToken = opts.apiToken ?? (await clack.password({
            message: 'API token (input hidden, never printed)',
            validate: (v: string) => (v ? undefined : 'Required'),
          }));
          if (cancelled(apiToken)) { clack.cancel('Cancelled — nothing saved.'); return; }
          config.email = String(email).trim();
          config.apiToken = String(apiToken);
        } else {
          const pat = opts.pat ?? (await clack.password({
            message: 'Personal access token (input hidden, never printed)',
            validate: (v: string) => (v ? undefined : 'Required'),
          }));
          if (cancelled(pat)) { clack.cancel('Cancelled — nothing saved.'); return; }
          config.pat = String(pat);
        }
      }

      // Corporate TLS opt-ins (REQ-JIRATLS-001) — flags apply on both the
      // flagged and interactive paths.
      if (opts.caCert) {
        const caPath = opts.caCert.trim();
        if (!fs.existsSync(caPath)) {
          clack.log.error(`CA certificate not found: ${caPath}`);
          process.exit(1);
        }
        config.caCertPath = caPath;
      }
      if (opts.insecureTls) {
        config.insecureTls = true;
        clack.log.warn(
          'TLS certificate verification is DISABLED for JIRA requests. ' +
            'Prefer --ca-cert with your corporate CA bundle when possible.',
        );
      }

      saveJiraConfig(config);
      // NOTE: never print the credential — only the path.
      clack.log.success(`Saved credentials to ${jiraConfigPath()} (permissions 0600).`);

      // Probe the connection so the user knows immediately whether it works.
      const client = new JiraClient(resolveJiraCredentials());
      const result = await client.testConnection();
      clack.log.success(`Connected as ${result.displayName ?? 'unknown user'}.`);

      // Publish project (REQ-JIRAPUB-009.A3): an explicit --project saves
      // directly; otherwise the interactive path offers the projects this
      // account can actually browse, so the user picks instead of typing.
      if (opts.project) {
        config.project = opts.project.trim().toUpperCase();
        saveJiraConfig(config);
        clack.log.success(`Default publish project: ${config.project}.`);
      } else if (!flagged) {
        try {
          const projects = await client.listProjects();
          if (projects.length > 0) {
            const NONE = '__none__';
            const chosen = await clack.select({
              message: 'Default project for spec→JIRA publishing (specship_jira_publish)',
              options: [
                ...projects.map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })),
                { value: NONE, label: 'Skip — choose per publish' },
              ],
            });
            if (!cancelled(chosen) && chosen !== NONE) {
              config.project = String(chosen);
              saveJiraConfig(config);
              clack.log.success(`Default publish project: ${config.project}.`);
            }
          }
        } catch {
          // Listing projects is a convenience — a fault here never fails
          // an otherwise-successful configure.
        }
      }
      clack.outro('JIRA is configured.');
    } catch (err) {
      // Messages from the jira module are already scrubbed of the secret.
      const msg = err instanceof Error ? err.message : String(err);
      const label = err instanceof JiraAuthError ? 'Authentication failed' : 'Connection failed';
      clack.log.error(`${label}: ${msg}`);
      process.exit(1);
    }
  });

jira
  .command('test')
  .description('Test the configured JIRA connection (uses ~/.specship/jira.json or SPECSHIP_JIRA_* env).')
  .action(async () => {
    const { resolveJiraCredentials, JiraClient, JiraAuthError } = await import('../jira');
    try {
      const creds = resolveJiraCredentials();
      const client = new JiraClient(creds);
      const result = await client.testConnection();
      const kind = creds.deployment === 'cloud' ? 'JIRA Cloud' : 'JIRA Data Center';
      // Never print the credential — only the resolved identity.
      success(`Connected to ${kind} as ${result.displayName ?? 'unknown user'}.`);

      // Validate the configured lifecycle transition names against a live
      // workflow so a name the workflow can't fire is visible now, not a
      // silent skip at completion time (REQ-JIRATRANS-002).
      const { validateConfiguredTransitions } = await import('../mcp/jira-tools');
      const v = await validateConfiguredTransitions(client, creds.transitions ?? {});
      if (!v.verified) {
        info('Configured transitions: could not verify (no accessible issue to sample).');
      } else {
        info(
          `Configured transitions (checked against ${v.sampleKey}; available from its ` +
            `current state: ${v.available.join(', ') || 'none'}):`,
        );
        for (const c of v.checks) {
          if (c.found) info(`  ✓ ${c.role} "${c.configured}"`);
          else
            warn(
              `  ✗ ${c.role} "${c.configured}" — not offered from ${v.sampleKey}'s current state`,
            );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const label = err instanceof JiraAuthError ? 'Authentication failed' : 'Connection failed';
      error(`${label}: ${msg}`);
      process.exit(1);
    }
  });

/**
 * specship jira transition — move a tracked issue to a target state, or list
 * the transitions it currently offers (REQ-JIRATRANS-001). Reuses the client's
 * skip-tolerant transition: a target the workflow doesn't offer is reported
 * with the available states and nothing is written.
 */
jira
  .command('transition <key> [state]')
  .description(
    'Transition a JIRA issue to <state>, or list its available transitions when <state> is omitted (or with --list).',
  )
  .option('--list', 'list the available transitions instead of applying one')
  .action(async (key: string, state: string | undefined, options: { list?: boolean }) => {
    const { resolveJiraCredentials, JiraClient } = await import('../jira');
    try {
      const creds = resolveJiraCredentials();
      const client = new JiraClient(creds);
      if (options.list || !state) {
        const names = (await client.listTransitions(key)).map((t) => t.name);
        success(
          names.length
            ? `${key} can transition to: ${names.join(', ')}.`
            : `${key} has no available transitions from its current state.`,
        );
        return;
      }
      const res = await client.transitionIssue(key, state);
      if ('transitioned' in res) {
        success(`Moved ${key} to "${res.transitioned}".`);
      } else {
        warn(`Did not transition ${key} — ${res.reason}.`);
      }
    } catch (err) {
      error(`JIRA transition failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * specship jira track — read-only tracking view (REQ-JIRA-008). Joins each
 * picked issue's SpecShip work-state (from its workflow run) with its LIVE JIRA
 * status (a fresh read at track time). Never re-picks or re-starts anything.
 */
jira
  .command('track')
  .description('Show each picked JIRA issue with its SpecShip work-state + live JIRA status.')
  .option('--project <key>', 'narrow the live JIRA read to a project (e.g., "PROJ")')
  .option('--path <projectRoot>', 'project root (default: cwd)')
  .action(async (options: { project?: string; path?: string }) => {
    const projectRoot = path.resolve(options.path ?? process.cwd());
    if (!isInitialized(projectRoot)) {
      error(`SpecShip not initialized in ${projectRoot}. Run \`specship init -i\` first.`);
      process.exit(1);
    }
    const { SpecShip } = await loadSpecShip();
    const { handleSpecshipJiraTrack } = await import('../mcp/jira-tools');
    const cg = await SpecShip.open(projectRoot);
    try {
      const result = await handleSpecshipJiraTrack(
        { project: options.project },
        { specQueries: cg.getSpecQueries(), projectRoot },
      );
      const out = result.content.map((c) => c.text).join('\n');
      // eslint-disable-next-line no-console
      console.log(out);
      if (result.isError) process.exit(1);
    } finally {
      cg.close();
    }
  });

/**
 * specship jira release — stamp a released version onto issues
 * (REQ-JIRAPUB-007): ensure the project version exists, add it as fixVersion
 * on each issue, and add one shipped-in comment. Idempotent — a re-run
 * creates no duplicate version, fixVersion, or comment.
 */
jira
  .command('release <version>')
  .description('Set <version> as fixVersion on JIRA issues (creating the project version if missing) with a shipped-in comment.')
  .option('--keys <keys>', 'comma-separated issue keys (e.g., "PROJ-1,PROJ-2"); default: every published spec\'s jira_issue key')
  .option('--project <key>', 'JIRA project key the version belongs to (default: the configured publish project)')
  .option('--path <projectRoot>', 'project root whose specs/ supplies the default keys (default: cwd)')
  .action(async (version: string, options: { keys?: string; project?: string; path?: string }) => {
    const { resolveJiraCredentials, JiraClient } = await import('../jira');
    const { releaseIssues } = await import('../jira/publish');
    const { readSpecJiraKey } = await import('../jira/spec-writer');
    try {
      const creds = resolveJiraCredentials();
      const projectKey = options.project ?? creds.project;
      if (!projectKey) {
        error('No JIRA project configured. Pass --project, set SPECSHIP_JIRA_PROJECT, or add "project" to your jira config.');
        process.exit(1);
      }

      let keys = (options.keys ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (keys.length === 0) {
        // Default: every spec under <root>/specs with a jira_issue key.
        const projectRoot = path.resolve(options.path ?? process.cwd());
        const specsDir = path.join(projectRoot, 'specs');
        try {
          for (const name of fs.readdirSync(specsDir)) {
            if (!name.toLowerCase().endsWith('.md')) continue;
            const key = readSpecJiraKey(path.join(specsDir, name));
            if (key) keys.push(key);
          }
        } catch {
          /* no specs dir → empty keys, handled below */
        }
        keys = [...new Set(keys)];
      }
      if (keys.length === 0) {
        error('No issue keys to release — pass --keys or publish specs first (specship_jira_publish).');
        process.exit(1);
      }

      const client = new JiraClient(creds);
      const result = await releaseIssues(client, projectKey, version, keys);
      const stamped = result.issues.filter((i) => i.fixVersionAdded).length;
      const commented = result.issues.filter((i) => i.commented).length;
      success(
        `Version ${version}${result.versionCreated ? ' created' : ' already existed'} in ${projectKey}; ` +
          `fixVersion added to ${stamped}/${keys.length} issue(s), shipped-in comment added to ${commented}.`,
      );
    } catch (err) {
      error(`JIRA release failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Parse and run
program.parse();

} // end main()
