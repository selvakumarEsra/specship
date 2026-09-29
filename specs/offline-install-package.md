---
id: OFFLINE-INSTALL-DOC
title: Offline / air-gapped installation package
owner: "@selvakumar"
priority: high
version: 2
---

<!-- id: OFFLINE-INSTALL-DOC -->
# Offline / air-gapped installation package

SpecShip must be installable on a machine that has **no npm, no compiler
toolchain, and no network access** — by carrying a single self-contained
artifact onto the machine and running one command.

This contract exists because the script historically pointed at for this
purpose, `scripts/offline-install.sh`, is named "offline" but is actually a
*build-from-source-against-a-reachable-registry* flow: it runs `npm ci` and
`npm run build` on the target, so it needs npm and a TypeScript/native
toolchain and fails on a genuinely air-gapped or toolchain-free box.

The capability already exists at the runtime layer — `scripts/build-bundle.sh`
produces `release/specship-<target>.tar.gz`: the compiled app plus
pure-JS/wasm dependencies, which runs with no native build and no npm. The
bundle is **self-installing offline**: an installer baked inside the archive
places the launcher on PATH and wires Claude Code, and
`scripts/offline-install.sh` consumes a pre-built bundle instead of compiling.

**Version 2 (2026-09-29): the bundle no longer vendors a Node runtime.**
Earlier bundles shipped an official Node 24 binary inside the archive
(`<bundle>/node`). In practice macOS kills the vendored, unsigned binary
(`Killed: 9` under Gatekeeper), leaving the install broken with
`$DEST/node: No such file or directory`, and the binary tripled archive size.
The bundle now uses the **Node already installed on the machine** — resolved
from PATH by the launcher and the installer (REQ-OFFLINE-006). "Offline"
therefore means: no npm, no compilation, no network — but a suitable Node
(>= 22.5, < 25) MUST already be present on the target machine.

Scope is the offline install path only. The existing online installers (root
`install.sh` / `install.ps1`, which download the bundle from GitHub Releases)
and the npm shim package are out of scope and must keep working unchanged.

<!-- id: REQ-OFFLINE-001 -->
## The release bundle MUST be self-installing offline with no npm, no compilation, and no network

Each per-platform release archive (`specship-<target>.tar.gz`, and
`specship-<target>.zip` on Windows) MUST contain an installer script at its
root — `install.sh` for unix targets, `install.ps1` for Windows — that, when
run from the extracted bundle directory, installs SpecShip using only files
already present in the archive. It MUST NOT invoke npm, MUST NOT compile any
source, and MUST NOT reach the network.

The installer places the bundled launcher (`bin/specship`, which execs the
machine's Node resolved per REQ-OFFLINE-006) onto the user's PATH using the
same conventions as the online installer: copy/relocate the extracted bundle to a
stable location and symlink the launcher into the bin directory
(`SPECSHIP_INSTALL_DIR` / `SPECSHIP_BIN_DIR` honored as in the root
`install.sh`). `scripts/build-bundle.sh` is responsible for staging this
installer into the archive during step 4 (alongside the launcher), so the
shipped bundle is self-installing by construction.

The build step that copies the launcher into the staged archive
(`scripts/build-bundle.sh`) and the bundle-local installer template
(`scripts/bundle-install.sh` / `scripts/bundle-install.ps1`) are the
implementation sites — shell scripts the graph does not symbolize, so this
requirement carries no `implementations:` block; the Claude wiring it then
performs is covered by REQ-OFFLINE-002.

## Acceptance
<!-- id: REQ-OFFLINE-001.A1 -->
- Extracting `specship-<target>.tar.gz` on a host with **no npm, no
  C/TypeScript toolchain, and no network** (but with Node >= 22.5 < 25
  installed) and running the bundle's own `./install.sh` exits 0 and leaves
  `specship --version` printing the bundle's version.
<!-- id: REQ-OFFLINE-001.A2 -->
- The bundle-local installer makes **zero** calls to `npm`, to a compiler
  (`tsc`, `node-gyp`, `cc`/`gcc`), and to the network (`curl`/`wget`/registry)
  — verified by running it with those tools removed from PATH and with
  outbound network blocked.
<!-- id: REQ-OFFLINE-001.A3 -->
- `scripts/build-bundle.sh <target>` emits an archive whose top-level
  `specship-<target>/` directory contains `install.sh` (unix targets) or
  `install.ps1` (`win32-*` targets) in addition to `bin/` and `lib/` — and
  contains **no** `node` / `node.exe` binary (all platforms).
<!-- id: REQ-OFFLINE-001.A4 -->
- Re-running the bundle's `./install.sh` over an existing install (same or
  newer version) succeeds and re-points the PATH symlink without error
  (idempotent upgrade), and an `--uninstall` flag removes the install
  directory and the PATH symlink.

<!-- id: REQ-OFFLINE-002 -->
## The offline installer MUST wire Claude Code via the resolved machine Node, with an opt-out

After placing the launcher on PATH, the bundle-local installer MUST wire
SpecShip into Claude Code by invoking the bundled app's `install` command
through the machine's Node resolved per REQ-OFFLINE-006 — equivalent to
`node --liftoff-only "<bundle>/lib/dist/bin/specship.js" install
--target claude -y` — so the MCP server entry, auto-allow permissions, slash
commands, and auto-sync hooks are written with no npm and no network.

The installer MUST accept a `--skip-claude` flag (and `-SkipClaude` on
PowerShell) that performs the PATH install only and leaves Claude Code
untouched.

implementations:
  - src/installer/targets/claude.ts:ClaudeCodeTarget.install

## Acceptance
<!-- id: REQ-OFFLINE-002.A1 -->
- After a default offline install, the Claude Code config gains SpecShip's MCP
  server entry and its auto-allow permissions, written via the machine's Node
  with no npm and no network access.
<!-- id: REQ-OFFLINE-002.A2 -->
- Running the installer with `--skip-claude` (or `-SkipClaude`) puts `specship`
  on PATH but makes no change to any Claude Code config file.
<!-- id: REQ-OFFLINE-002.A3 -->
- The Claude-wiring step uses the same Node executable the launcher resolves
  (REQ-OFFLINE-006), and passes `--liftoff-only` on its command line.

<!-- id: REQ-OFFLINE-003 -->
## `scripts/offline-install.sh` MUST consume a pre-built bundle and MUST NOT compile or run npm on the target

`scripts/offline-install.sh` and `scripts/offline-install.ps1` MUST be
repurposed so the documented "offline install" no longer builds from source.
They MUST NOT run `npm ci`, `npm install`, `npm link`, or `npm run build` on
the target. The machine's Node (>= 22.5) provides `node:sqlite` with FTS5
built in, so no native compile or FTS5 probe-and-build step is needed.

The repurposed scripts operate on a pre-built bundle (an extracted
`specship-<target>/` directory or an archive path passed as an argument) and
delegate to the bundle-local installer from REQ-OFFLINE-001 / REQ-OFFLINE-002.
The `--undo` / `-Undo` paths MUST reverse the install (remove the PATH symlink;
optionally the install directory) without npm.

## Acceptance
<!-- id: REQ-OFFLINE-003.A1 -->
- Running `scripts/offline-install.sh` against a pre-built bundle on a host
  with no npm and no compiler succeeds — it never shells out to `npm` or a
  compiler (verified by trace / by removing them from PATH).
<!-- id: REQ-OFFLINE-003.A2 -->
- The script no longer contains `npm ci`, `npm install`, `npm link`, or
  `npm run build` invocations.
<!-- id: REQ-OFFLINE-003.A3 -->
- `scripts/offline-install.sh --undo` removes the PATH symlink and leaves the
  host with no `specship` on PATH, using no npm.

<!-- id: REQ-OFFLINE-004 -->
## The offline path MUST be documented as the no-compile route and the source-build route relabeled

The "Offline / air-gapped install" documentation MUST describe the
self-installing bundle as the supported no-npm / no-compile path: download the
matching `specship-<target>` archive on a connected machine, copy it across,
extract, and run the bundle's own `install.sh` / `install.ps1`. The README and
`site` installation page MUST stop presenting `scripts/offline-install.sh` as
"runs npm install … builds … npm link" for the air-gapped case; any remaining
source-build flow MUST be labeled "install from source" so it is not mistaken
for the no-compile path.

## Acceptance
<!-- id: REQ-OFFLINE-004.A1 -->
- `README.md` and `site/src/content/docs/getting-started/installation.md`
  describe the self-installing bundle (extract → run bundled `install.sh`) as
  the offline / air-gapped path, with no step that compiles on the target,
  and state the prerequisite: Node >= 22.5 < 25 already installed on the
  machine.
<!-- id: REQ-OFFLINE-004.A2 -->
- Any documented `scripts/offline-install.sh` source-build flow is explicitly
  titled "install from source" (or removed), distinct from the offline bundle
  path.
<!-- id: REQ-OFFLINE-004.A3 -->
- A `CHANGELOG.md` entry under `## [Unreleased]` notes the offline bundle is
  now self-installing with no npm or compilation, in user-facing language.

<!-- id: REQ-OFFLINE-005 -->
## The bundle installer MUST ask where to wire Claude Code

`install.sh` / `install.ps1` run from the extracted bundle directory, so a
blind project-local `specship install -y` writes the MCP entry into the
bundle folder itself — useless wiring. Instead, after placing the launcher on
PATH, the installer resolves the wiring target:

- **Interactive (TTY):** ask — wire **globally** (all projects), wire **a
  specific repo** (prompt for its path, which must exist; the install runs
  project-local from that directory, indexing it), or **skip** wiring.
- **Non-interactive flags:** `--global`, or `--path <repo>` (project-local in
  that repo); `--skip-claude` retained. Without a TTY and without flags, the
  default is **global** — never a local install into the bundle directory.

implementations:
  - scripts/bundle-install.sh
  - scripts/bundle-install.ps1

## Acceptance
<!-- id: REQ-OFFLINE-005.A1 -->
- `./install.sh --path <repo>` wires `<repo>/.mcp.json` +
  `<repo>/.claude/settings.json` and initializes that repo's index; nothing
  Claude-related is written into the bundle or install directory.
<!-- id: REQ-OFFLINE-005.A2 -->
- `./install.sh --global` (and the no-TTY no-flag default) wires the global
  `~/.claude.json` + `~/.claude/settings.json`.
<!-- id: REQ-OFFLINE-005.A3 -->
- A nonexistent `--path` fails with a clear message before any wiring.

<!-- id: REQ-OFFLINE-006 -->
## The bundle MUST use the machine's installed Node, never a vendored runtime

Release bundles MUST NOT contain a Node binary. On every platform
(`darwin-*`, `linux-*`, `win32-*`), the bundle's launcher (`bin/specship` /
`bin/specship.cmd`) and its installer (`install.sh` / `install.ps1`) MUST
resolve the Node executable from the machine — `node` on `PATH` — and run the
compiled app through it, always passing `--liftoff-only` on Node's command
line (the V8 flag must be on the node invocation itself; see
`src/extraction/wasm-runtime-flags.ts`).

The resolved Node MUST satisfy **>= 22.5.0 and < 25.0.0** — the floor
guarantees the built-in `node:sqlite` (FTS5) that replaced `better-sqlite3`;
the ceiling matches the Node 25 hard exit in
`src/bin/node-version-check.ts`. When no `node` is found, or the found
version is outside the range, the launcher and the installer MUST fail with a
non-zero exit and a clear message that names the required range and points to
https://nodejs.org — they MUST NOT attempt to download a runtime.

`scripts/build-bundle.sh` MUST stop downloading the Node distribution
entirely (the download step, not just the copy), so bundle builds themselves
need no nodejs.org access and archives shrink accordingly.

implementations:
  - scripts/bundle-install.sh
  - scripts/bundle-install.ps1
  - scripts/build-bundle.sh

## Acceptance
<!-- id: REQ-OFFLINE-006.A1 -->
- No release archive for any target contains a file named `node` or
  `node.exe`; `scripts/build-bundle.sh` makes no request to `nodejs.org`.
<!-- id: REQ-OFFLINE-006.A2 -->
- On a machine with Node 22.5–24.x on PATH, the installed `specship` launcher
  runs the app via that Node with `--liftoff-only` on the node command line.
<!-- id: REQ-OFFLINE-006.A3 -->
- With no `node` on PATH, `./install.sh` (and the launcher) exits non-zero
  printing the required range (>= 22.5 < 25) and a nodejs.org pointer, and
  performs no Claude Code wiring.
<!-- id: REQ-OFFLINE-006.A4 -->
- With Node 20.x (or 25.x) on PATH, the same clear version-range failure is
  printed instead of a crash or a silent broken install.
<!-- id: REQ-OFFLINE-006.A5 -->
- A `CHANGELOG.md` entry under `## [Unreleased]` states, in user-facing
  language, that bundles no longer ship a Node runtime and now require
  Node 22.5+ installed on the machine.
