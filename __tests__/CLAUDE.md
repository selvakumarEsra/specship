# Test suite

<!-- Inherits all rules from the root CLAUDE.md. This file adds
     test-suite and cross-platform guidance for __tests__/. -->

## Conventions worth following

- Tests mirror the module they cover. Temp dirs via `fs.mkdtempSync`,
  cleaned in `afterEach`; real files and real SQLite — no DB mocking.
- Notable suites: `installer-targets.test.ts` (parameterized contract
  suite), `evaluation/` (`npm run eval`, not part of `npm test`),
  `sqlite-backend.test.ts` (native + wasm fallback),
  `pr19-improvements.test.ts` / `frameworks-integration.test.ts`
  (regression anchors — don't rename; the names anchor to git history).
- DB-flavored failures (`Could not locate the bindings file` /
  `no such module: fts5`) mean the optional `better-sqlite3` isn't built —
  `npm rebuild better-sqlite3` or run on node 24, not a logic bug.

## Windows-gated tests

Platform-divergent behavior (path resolution, drive letters,
`SENSITIVE_PATHS`, `%APPDATA%`, CRLF) must be gated, not assumed:
`it.runIf(process.platform === 'win32')(...)` for Windows-only assertions,
`it.runIf(process.platform !== 'win32')(...)` for POSIX-only ones — e.g.
`/etc` is sensitive on POSIX but resolves to a non-existent `C:\etc` on
Windows. Don't merge a Windows-gated test you haven't seen run.

## Cross-platform validation

The dev machine (and default `npm test` target) is macOS. When a change is
platform-sensitive (file watching, sockets/named pipes, path & symlink
handling, process lifecycle, inotify budget), validate the other platforms
for real:

### Linux (Docker)

- `FROM node:22-bookworm`; `COPY` the repo with a `.dockerignore` excluding
  `node_modules`/`dist`/`.git`/`.specship`; `RUN npm ci && npm run build`.
  Don't reuse the Mac `node_modules` — `esbuild`/`rollup` ship
  platform-specific binaries.
- Run with **`docker run --rm --init`** — `--init` is load-bearing for
  process-lifecycle tests (daemon reaping, the #277 PPID watchdog): without
  a zombie-reaping PID 1, an exited process still reports alive to
  `process.kill(pid, 0)` and exit-detection assertions false-fail.
- Count inotify watches via `/proc/<pid>/fdinfo/*` (sum `^inotify ` lines on
  the fd whose `readlink` is `anon_inode:inotify`).

### Windows (Parallels VM + SSH)

- Connection details live in the gitignored `.parallels` file (VM name,
  guest IP, SSH user/key). `prlctl exec` is unavailable — SSH is the bridge.
  For multi-line work, pipe PowerShell over stdin and refresh PATH from the
  registry first (sshd sessions have a stale PATH after winget installs).
- Clone fresh into a Windows-local path (`C:\dev\specship`) and `npm ci`
  there — never run npm against the shared Mac repo.
- Guest toolchain (winget): Node LTS, Git, and the VC++ ARM64
  redistributable (required by `@rollup/rollup-win32-arm64-msvc`).
- Fetch a contributor PR head straight from their fork
  (`git fetch <fork-url> <branch>` → `git checkout -f FETCH_HEAD`).
- Known pre-existing Windows failures (reproduce on `main` — confirm against
  `origin/main` before blaming a PR): the security symlink-resistance test
  (symlink creation needs privileges), and `mcp-initialize.test.ts` /
  `mcp-roots.test.ts` failing in `afterEach` with `EPERM` removing the temp
  dir (a spawned `serve --mcp` grandchild still holds the cwd — a Windows
  file-locking quirk).
