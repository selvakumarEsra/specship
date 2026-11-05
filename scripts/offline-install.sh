#!/usr/bin/env bash
#
# Offline / air-gapped install of SpecShip from a PRE-BUILT bundle. No npm, no
# compiler, no network — nothing is built on the target machine. The target
# must already have Node >= 22.5 < 25 on PATH; the bundle ships no runtime.
#
# This is NOT a build-from-source flow. Point it at a release bundle for the
# target's platform — an extracted `specship-<target>/` directory, or a
# `specship-<target>.tar.gz` / `.zip` archive — and it delegates to the
# installer baked inside that bundle (which symlinks the launcher onto PATH and
# wires the chosen coding agent via the machine's Node). The agent is
# --target claude|gemini; with no --target the bundle installer picks the agent
# whose shell runs it (GEMINI_CLI=1 means Gemini CLI), else Claude Code, and
# reinstalls every agent already recorded as installed first.
#
# Get a bundle from the GitHub Releases page on a connected machine, or build
# one with scripts/build-bundle.sh. To install from a source checkout instead
# (requires a toolchain), see the "install from source" docs.
#
# Usage:
#   ./scripts/offline-install.sh <bundle>                   # install + wire the agent
#   ./scripts/offline-install.sh <bundle> --target gemini   # wire Gemini CLI
#   ./scripts/offline-install.sh <bundle> --global          # wire globally (all projects)
#   ./scripts/offline-install.sh <bundle> --path <repo>     # wire one repo (project-local)
#   ./scripts/offline-install.sh <bundle> --skip-wire       # install only (alias: --skip-claude)
#   ./scripts/offline-install.sh --undo                     # reverse the install
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
# Flags are forwarded to the bundle's install.sh as separate words (a --path
# value may contain spaces), so they are collected into the positional list.
BUNDLE_ARG=""
TARGET_ARG=""
GLOBAL_ARG=0
PATH_ARG=""
SKIP_ARG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-claude|--skip-wire) SKIP_ARG=1 ;;
    --global) GLOBAL_ARG=1 ;;
    --target)
      shift
      [ $# -gt 0 ] || { echo "offline-install: --target requires claude or gemini" >&2; exit 1; }
      TARGET_ARG="$1" ;;
    --target=*) TARGET_ARG="${1#--target=}" ;;
    --path)
      shift
      [ $# -gt 0 ] || { echo "offline-install: --path requires a directory" >&2; exit 1; }
      PATH_ARG="$1" ;;
    --path=*) PATH_ARG="${1#--path=}" ;;
    -*) echo "offline-install: unknown option '$1'" >&2; exit 1 ;;
    *) BUNDLE_ARG="$1" ;;
  esac
  shift
done

case "$TARGET_ARG" in
  ''|claude|gemini) ;;
  *) echo "offline-install: --target must be claude or gemini (got '$TARGET_ARG')" >&2; exit 1 ;;
esac

set --
[ -n "$TARGET_ARG" ] && set -- "$@" --target "$TARGET_ARG"
[ "$GLOBAL_ARG" -eq 1 ] && set -- "$@" --global
[ -n "$PATH_ARG" ] && set -- "$@" --path "$PATH_ARG"
[ "$SKIP_ARG" -eq 1 ] && set -- "$@" --skip-wire

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
  sh "$BUNDLE_DIR/install.sh" "$@"
