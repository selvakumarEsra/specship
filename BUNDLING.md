# Distribution: prebuilt bundles

SpecShip ships **prebuilt app bundles** that run on the Node.js already
installed on the machine — **>= 22.5.0 and < 25.0.0** (REQ-OFFLINE-006). Node
22.5+ has a built-in real SQLite (`node:sqlite`, with WAL + FTS5), so:

- **No native build** — `better-sqlite3` is gone, so there are zero native addons
  to compile or rebuild.
- **No wasm fallback** — and therefore no more `database is locked` (issue #238).
- **No vendored runtime** — bundles used to ship their own Node binary, but
  macOS Gatekeeper kills the unsigned vendored binary (`Killed: 9`) and it
  tripled archive size. The launcher and installers now resolve `node` from
  `PATH`, gate it against the supported range, and fail with a clear
  message + nodejs.org pointer when it's missing or out of range.

## What's in a bundle

Built by [`scripts/build-bundle.sh`](scripts/build-bundle.sh) — one archive per
platform, identical recipe:

```
specship-<target>/
  lib/
    dist/                  # compiled app (+ tree-sitter .wasm grammars, schema.sql)
    node_modules/          # production deps only (pure JS / wasm — portable)
  bin/
    specship | specship.cmd   # launcher → resolves the machine's node, gates the
                              # version range, runs the app with --liftoff-only
```

Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`,
`win32-arm64`. Unix targets produce `.tar.gz` (shell launcher); Windows produces
`.zip` (a `.cmd` launcher).

```bash
scripts/build-bundle.sh linux-x64            # -> release/specship-linux-x64.tar.gz
scripts/build-bundle.sh win32-x64            # -> release/specship-win32-x64.zip
```

Because dropping better-sqlite3 left **zero native addons**, building a bundle is
pure file-packaging — **any** target builds on **any** OS (the whole matrix builds
on one Linux runner, with no nodejs.org downloads at all). Cross-compilation isn't
a concern; only *run-testing* a bundle needs the target platform (or emulation,
e.g. `docker run --platform linux/amd64`).

## Install channels (all deliver the same bundle)

1. **`curl | sh`** ([`install.sh`](install.sh)) — ideal for a fresh Linux VPS
   over SSH (Node 22.5–24.x must be installed). Detects os/arch, pulls the
   archive from GitHub Releases, symlinks `specship` onto PATH. Re-run to
   upgrade; `--uninstall` to remove.
2. **npm** ([`scripts/npm-shim.js`](scripts/npm-shim.js)) — preserves
   `npm i -g @specship/specship`. The main package is a tiny shim; the
   bundles ship as per-platform `optionalDependencies`
   (`@specship/specship-<target>` with `os`/`cpu`), so npm installs only the
   matching one. The shim — run by the user's Node — launches the bundle on
   that same Node after gating the version range. On Windows it invokes
   `process.execPath` against the app entry directly (not the `.cmd`
   launcher) — modern Node throws `EINVAL` when asked to spawn a `.cmd`/`.bat`.
3. **Windows** ([`install.ps1`](install.ps1)) — `irm … | iex`; same flow as
   install.sh (detect arch, pull the `.zip` from Releases, add to PATH).
4. **Homebrew / Scoop** — TODO (tap + cask pointing at the Release archives).

## Release pipeline

[`.github/workflows/release.yml`](.github/workflows/release.yml) — manually
triggered. Reads the version from `package.json`, builds every platform bundle on
one runner, creates the GitHub Release (notes from `CHANGELOG.md`), and publishes
the npm shim + per-platform packages. Requires the `NPM_TOKEN` repo secret.

Still TODO:
- Re-wire `npm uninstall` cleanup (the agent-config `preuninstall`) through the
  shim — the generated main package doesn't carry it.
