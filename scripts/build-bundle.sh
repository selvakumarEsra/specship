#!/usr/bin/env bash
#
# Build a SpecShip bundle: the compiled app + its production deps, run by the
# machine's own Node (>= 22.5, < 25) — NO vendored runtime and NO native build.
# node:sqlite, which replaced better-sqlite3, is built into that Node.
# One archive per platform (REQ-OFFLINE-006).
#
# Because dropping better-sqlite3 left zero native addons, the recipe is pure
# file-packaging (copy the app, archive) — so any platform's bundle can be
# built on any OS. No cross-compile, no native runners, no nodejs.org access.
#
# Usage:
#   scripts/build-bundle.sh <target>
#     target:        darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64
#                  | win32-x64 | win32-arm64
#
# Output:
#   unix:    release/specship-<target>.tar.gz   (launcher: bin/specship)
#   windows: release/specship-<target>.zip      (launcher: bin/specship.cmd)
set -euo pipefail

TARGET="${1:?usage: build-bundle.sh <target>}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

OSFAM="${TARGET%-*}"   # darwin | linux | win32

echo "[bundle] target=${TARGET}"

# 1. Build the app (compiled JS + copied wasm/schema assets).
#    `npm run clean` first: `npm run build` overwrites but never deletes, so a
#    renamed/deleted source file's stale compiled `.js` would otherwise linger in
#    dist/ and ride into the bundle. Cleaning guarantees a wholly fresh dist/.
echo "[bundle] building app"
( cd "$ROOT" && npm run clean >/dev/null && npm run build >/dev/null )

# 2. Stage: app + production-only deps (pure JS/wasm → portable across platforms).
STAGE="$WORK/specship-${TARGET}"
mkdir -p "$STAGE/lib" "$STAGE/bin"
cp -R "$ROOT/dist" "$STAGE/lib/dist"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/lib/"
echo "[bundle] installing production dependencies"
( cd "$STAGE/lib" && npm ci --omit=dev --ignore-scripts >/dev/null 2>&1 )
rm -f "$STAGE/lib/package-lock.json"

# 3. Launcher. It resolves `node` from PATH at run time and gates the version
#    to >= 22.5 < 25 (REQ-OFFLINE-006) — no runtime is vendored or downloaded.
#
# `--liftoff-only`: keep tree-sitter's large WASM grammars on V8's Liftoff
# baseline compiler so they never reach the turboshaft optimizing tier, whose
# per-compilation Zone arena OOMs the whole process (`Fatal process out of
# memory: Zone`) on Node >= 22 — even with tens of GB free. The flag is read at
# V8 engine init so it must be on node's command line; the parse worker inherits
# it. See issues #293/#298 and src/extraction/wasm-runtime-flags.ts. (The CLI
# also self-relaunches with this flag when launched without it, so non-bundled
# runs are covered too; passing it here avoids that extra spawn.)
if [ "$OSFAM" = "win32" ]; then
  # CRLF line endings: .cmd files are parsed by cmd.exe, which needs them.
  awk '{ printf "%s\r\n", $0 }' > "$STAGE/bin/specship.cmd" <<'CMD'
@echo off
setlocal
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
  echo specship: Node.js is required ^(^>^= 22.5.0, ^< 25.0.0^) but no 'node' was found on PATH.>&2
  echo specship: install it from https://nodejs.org>&2
  exit /b 1
)
set "NODEVER="
rem Query the version through PATH (`node`, not "%NODE%") so a Program Files
rem path with spaces doesn't hit cmd's nested-quote parsing — `where node`
rem already proved PATH resolves to this same executable.
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
set "NMAJ="
set "NMIN="
for /f "tokens=1,2 delims=v." %%a in ("%NODEVER%") do (
  set "NMAJ=%%a"
  set "NMIN=%%b"
)
if not defined NMAJ goto :badnode
if %NMAJ% LSS 22 goto :badnode
if %NMAJ% GEQ 25 goto :badnode
if %NMAJ% EQU 22 if %NMIN% LSS 5 goto :badnode
rem --liftoff-only: avoid the V8 turboshaft WASM Zone OOM (issues #293/#298).
"%NODE%" --liftoff-only "%~dp0..\lib\dist\bin\specship.js" %*
exit /b %ERRORLEVEL%
:badnode
echo specship: Node.js ^>^= 22.5.0 and ^< 25.0.0 is required (found %NODEVER% at %NODE%).>&2
echo specship: install a supported version from https://nodejs.org>&2
exit /b 1
CMD
  # Self-installing offline installer at the archive root (no npm, no compile).
  cp "$ROOT/scripts/bundle-install.ps1" "$STAGE/install.ps1"
else
  cat > "$STAGE/bin/specship" <<'LAUNCH'
#!/bin/sh
# Resolve symlinks (e.g. the ~/.local/bin/specship link install.sh creates) so
# we find the real bundle dir, not the symlink's location.
SELF="$0"
while [ -L "$SELF" ]; do
  target="$(readlink "$SELF")"
  case "$target" in
    /*) SELF="$target" ;;
    *) SELF="$(dirname "$SELF")/$target" ;;
  esac
done
DIR="$(cd "$(dirname "$SELF")/.." && pwd)"

# Resolve the machine's Node and gate its version (REQ-OFFLINE-006): the
# bundle ships no runtime, so a missing or unsupported node must fail loudly
# rather than crash deep inside the app.
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  echo "specship: Node.js is required (>= 22.5.0, < 25.0.0) but no 'node' was found on PATH." >&2
  echo "specship: install it from https://nodejs.org" >&2
  exit 1
fi
NODE_VER="$("$NODE" -v 2>/dev/null || true)"   # vMAJOR.MINOR.PATCH
_v="${NODE_VER#v}"
_maj="${_v%%.*}"
_rest="${_v#*.}"
_min="${_rest%%.*}"
case "$_maj" in ''|*[!0-9]*) _maj=0 ;; esac
case "$_min" in ''|*[!0-9]*) _min=0 ;; esac
if [ "$_maj" -lt 22 ] || { [ "$_maj" -eq 22 ] && [ "$_min" -lt 5 ]; } || [ "$_maj" -ge 25 ]; then
  echo "specship: Node.js >= 22.5.0 and < 25.0.0 is required (found ${NODE_VER:-unknown} at $NODE)." >&2
  echo "specship: install a supported version from https://nodejs.org" >&2
  exit 1
fi

# --liftoff-only: avoid the V8 turboshaft WASM Zone OOM (issues #293/#298).
exec "$NODE" --liftoff-only "$DIR/lib/dist/bin/specship.js" "$@"
LAUNCH
  chmod +x "$STAGE/bin/specship"
  # Self-installing offline installer at the archive root (no npm, no compile).
  cp "$ROOT/scripts/bundle-install.sh" "$STAGE/install.sh"
  chmod +x "$STAGE/install.sh"
fi

# 4. Archive (.zip for Windows, .tar.gz otherwise).
mkdir -p "$OUT"
if [ "$OSFAM" = "win32" ]; then
  ARCHIVE="$OUT/specship-${TARGET}.zip"
  rm -f "$ARCHIVE"
  ( cd "$WORK" && zip -rqX "$ARCHIVE" "specship-${TARGET}" )
else
  ARCHIVE="$OUT/specship-${TARGET}.tar.gz"
  # --no-xattrs: don't embed macOS xattrs that make GNU tar warn on Linux.
  tar --no-xattrs -czf "$ARCHIVE" -C "$WORK" "specship-${TARGET}"
fi
echo "[bundle] wrote ${ARCHIVE} ($(du -h "$ARCHIVE" | cut -f1))"
