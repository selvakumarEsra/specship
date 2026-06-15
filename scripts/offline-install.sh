#!/usr/bin/env bash
#
# Offline / air-gapped install of SpecShip from this source folder.
#
# Assumes the client workstation has:
#   - Node.js (>=18 <25) and npm on PATH
#   - npm configured against a registry it CAN reach (e.g. a private mirror)
#   - No git, no public GitHub access required
#
# Does NOT call git, does NOT download anything from github.com. Dependencies
# are pulled from whatever registry npm is already pointed at.
#
# Usage:
#   ./scripts/offline-install.sh                    # build, link, wire Claude Code
#   ./scripts/offline-install.sh --skip-claude      # build + link only
#   ./scripts/offline-install.sh --undo             # unlink the global symlink
#
# After install:  `specship --version` should print the package.json version.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"

PKG=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

# --- undo path ---------------------------------------------------------------
if [ "${1:-}" = "--undo" ]; then
  echo "[offline-install] unlinking ${PKG}"
  npm unlink -g "${PKG}" >/dev/null 2>&1 || true
  echo "[offline-install] done"
  exit 0
fi

SKIP_CLAUDE=0
[ "${1:-}" = "--skip-claude" ] && SKIP_CLAUDE=1

# --- Node version gate -------------------------------------------------------
# Tighter than package.json engines (>=18 <25): the runtime needs node:sqlite
# (Node 22.5+) AND that SQLite must have FTS5 compiled in. SpecShip's own
# release bundle pins v24.16.0 for that reason; older Node builds either lack
# node:sqlite entirely or ship SQLite without FTS5.
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] \
  || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; } \
  || [ "$NODE_MAJOR" -ge 25 ]; then
  echo "[offline-install] error: Node $(node --version) is unsupported. Requires >=22.5 <25 (Node 24.x recommended)." >&2
  exit 1
fi

# --- FTS5 capability probe ---------------------------------------------------
# Fail fast with a clear remediation message instead of letting `specship init`
# die with a cryptic "no such module: fts5" deep inside indexing. node:sqlite
# is present from 22.5+, but FTS5 is only enabled in newer Node builds —
# Node 22.x typically ships SQLite without it.
PROBE=$(node -e "
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');
    console.log('OK');
  } catch (e) {
    console.log('FAIL:' + e.message);
  }
" 2>/dev/null)
case "$PROBE" in
  OK) ;;
  FAIL:*)
    cat >&2 <<EOF
[offline-install] error: SQLite probe failed: ${PROBE#FAIL:}

SpecShip requires Node.js whose bundled SQLite has FTS5 enabled. Your Node
($(node --version)) does not. Install Node 24.x and re-run:

  nvm install 24 && nvm use 24
  ./scripts/offline-install.sh

(SpecShip's release bundle pins v24.16.0 as the known-good version.)
EOF
    exit 1
    ;;
  *)
    echo "[offline-install] error: unable to probe node:sqlite. Need Node >=22.5 (24.x recommended)." >&2
    exit 1
    ;;
esac

echo "[offline-install] repo:    ${REPO}"
echo "[offline-install] package: ${PKG}@${VERSION}"
echo "[offline-install] node:    $(node --version)"
echo "[offline-install] registry: $(npm config get registry)"

# --- install deps (offline-friendly: respects whatever registry npm is on) ---
#
# --ignore-scripts skips native-module postinstalls (notably better-sqlite3,
# whose node-gyp rebuild needs a C toolchain that an air-gapped workstation
# usually doesn't have). SpecShip treats better-sqlite3 as optional anyway —
# without it the wasm SQLite path takes over, which is what the offline-
# install flow expects.
if [ -f package-lock.json ]; then
  echo "[offline-install] npm ci --ignore-scripts"
  npm ci --ignore-scripts
else
  echo "[offline-install] npm install --ignore-scripts"
  npm install --ignore-scripts
fi

# --- build -------------------------------------------------------------------
# Skip the build when this is a pre-compiled drop (no tsconfig.json + a
# populated dist/ already on disk). The release tarball is shipped pre-built;
# only a source checkout has tsconfig.json and needs `npm run build`.
if [ -f tsconfig.json ]; then
  echo "[offline-install] npm run build"
  npm run build
else
  echo "[offline-install] skipping build (pre-compiled dist/ found)"
fi

# --- link as global specship ------------------------------------------------
echo "[offline-install] npm link"
npm link

LINKED=$(command -v specship || echo "(not on PATH)")
echo "[offline-install] specship -> ${LINKED}"

# --- wire Claude Code (non-interactive) --------------------------------------
# Invoke the just-built binary directly instead of relying on `specship` being
# visible on PATH in this shell session — `npm link`'s shim may not be picked
# up until the user opens a new shell.
if [ "$SKIP_CLAUDE" -eq 0 ]; then
  echo "[offline-install] wiring Claude Code"
  node "$REPO/dist/bin/specship.js" install --target claude -y
fi

cat <<EOF

✓ SpecShip ${VERSION} installed offline from source.
  binary:    ${LINKED}
  source:    ${REPO}

Next:
  specship --version
  cd <your-project> && specship init && specship index

To uninstall:
  ./scripts/offline-install.sh --undo
EOF
