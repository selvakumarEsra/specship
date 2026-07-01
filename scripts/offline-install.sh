#!/usr/bin/env bash
#
# Offline / air-gapped install of SpecShip from a PRE-BUILT self-contained
# bundle. No npm, no compiler, no network — the bundle vendors its own Node
# runtime, so nothing is built on the target machine.
#
# This is NOT a build-from-source flow. Point it at a release bundle for the
# target's platform — an extracted `specship-<target>/` directory, or a
# `specship-<target>.tar.gz` / `.zip` archive — and it delegates to the
# installer baked inside that bundle (which symlinks the launcher onto PATH and
# wires Claude Code via the vendored Node).
#
# Get a bundle from the GitHub Releases page on a connected machine, or build
# one with scripts/build-bundle.sh. To install from a source checkout instead
# (requires a toolchain), see the "install from source" docs.
#
# Usage:
#   ./scripts/offline-install.sh <bundle>                 # install + wire Claude Code
#   ./scripts/offline-install.sh <bundle> --skip-claude   # install only
#   ./scripts/offline-install.sh --undo                   # reverse the install
#
# Environment:
#   SPECSHIP_INSTALL_DIR  install location  (default: ~/.specship)
#   SPECSHIP_BIN_DIR      symlink location  (default: ~/.local/bin)

set -euo pipefail

INSTALL_DIR="${SPECSHIP_INSTALL_DIR:-$HOME/.specship}"
BIN_DIR="${SPECSHIP_BIN_DIR:-$HOME/.local/bin}"

# --- undo --------------------------------------------------------------------
if [ "${1:-}" = "--undo" ] || [ "${1:-}" = "--uninstall" ]; then
  if [ -x "$INSTALL_DIR/current/install.sh" ]; then
    SPECSHIP_INSTALL_DIR="$INSTALL_DIR" SPECSHIP_BIN_DIR="$BIN_DIR" \
      sh "$INSTALL_DIR/current/install.sh" --uninstall
  else
    rm -f "$BIN_DIR/specship"
    rm -rf "$INSTALL_DIR"
    echo "SpecShip uninstalled (removed $INSTALL_DIR and $BIN_DIR/specship)."
  fi
  exit 0
fi

# --- parse args: <bundle> plus passthrough flags -----------------------------
BUNDLE_ARG=""
PASS=""
for a in "$@"; do
  case "$a" in
    --skip-claude) PASS="$PASS --skip-claude" ;;
    -*) echo "offline-install: unknown option '$a'" >&2; exit 1 ;;
    *) BUNDLE_ARG="$a" ;;
  esac
done

if [ -z "$BUNDLE_ARG" ]; then
  cat >&2 <<'EOF'
offline-install: need a pre-built bundle (no npm, no compiler required).

Point this at a release bundle for the target machine:
  ./scripts/offline-install.sh path/to/specship-<target>.tar.gz
  ./scripts/offline-install.sh path/to/specship-<target>/      # extracted dir

Bundles come from the GitHub Releases page, or scripts/build-bundle.sh on a
connected machine. (Building from a source checkout requires a toolchain and is
a different flow.)
EOF
  exit 1
fi

# --- resolve the bundle dir (extract if it's an archive) ---------------------
CLEANUP=""
cleanup() { [ -n "$CLEANUP" ] && rm -rf "$CLEANUP"; return 0; }
trap cleanup EXIT

if [ -d "$BUNDLE_ARG" ]; then
  BUNDLE_DIR="$(cd "$BUNDLE_ARG" && pwd)"
else
  case "$BUNDLE_ARG" in
    *.tar.gz|*.tgz)
      CLEANUP="$(mktemp -d)"
      tar -xzf "$BUNDLE_ARG" -C "$CLEANUP"
      BUNDLE_DIR="$(find "$CLEANUP" -maxdepth 1 -type d -name 'specship-*' | head -n1)"
      [ -n "$BUNDLE_DIR" ] || BUNDLE_DIR="$CLEANUP"
      ;;
    *.zip)
      CLEANUP="$(mktemp -d)"
      unzip -q "$BUNDLE_ARG" -d "$CLEANUP"
      BUNDLE_DIR="$(find "$CLEANUP" -maxdepth 1 -type d -name 'specship-*' | head -n1)"
      [ -n "$BUNDLE_DIR" ] || BUNDLE_DIR="$CLEANUP"
      ;;
    *)
      echo "offline-install: '$BUNDLE_ARG' is not a directory or a .tar.gz/.zip bundle." >&2
      exit 1
      ;;
  esac
fi

# --- sanity: does this look like a SpecShip bundle? --------------------------
if [ ! -f "$BUNDLE_DIR/install.sh" ] || [ ! -e "$BUNDLE_DIR/bin/specship" ]; then
  echo "offline-install: '$BUNDLE_DIR' is not a SpecShip bundle (missing install.sh / bin/specship)." >&2
  exit 1
fi

# --- delegate to the bundle's own offline installer --------------------------
echo "[offline-install] installing from bundle: $BUNDLE_DIR"
SPECSHIP_INSTALL_DIR="$INSTALL_DIR" SPECSHIP_BIN_DIR="$BIN_DIR" \
  sh "$BUNDLE_DIR/install.sh" $PASS
