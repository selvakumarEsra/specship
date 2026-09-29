#!/bin/sh
#
# SpecShip offline / air-gapped installer (bundled into the release archive).
#
# Runs from inside an extracted bundle. Places the launcher on PATH and wires
# Claude Code using ONLY files already in this bundle (the compiled app and the
# launcher) plus the machine's own Node. No package manager, no compiler, no
# network access.
#
# Requires Node >= 22.5.0 and < 25.0.0 on PATH — the bundle ships no runtime
# (REQ-OFFLINE-006).
#
# Usage (from the extracted bundle directory):
#   ./install.sh                 install; asks where to wire Claude Code
#   ./install.sh --global        wire Claude Code globally (all projects)
#   ./install.sh --path <repo>   wire a specific repo (project-local + index)
#   ./install.sh --skip-claude   install only (leave Claude Code config alone)
#   ./install.sh --uninstall     remove the PATH symlink + install directory
#
# Environment:
#   SPECSHIP_INSTALL_DIR   bundle location   (default: ~/.specship)
#   SPECSHIP_BIN_DIR       symlink location  (default: ~/.local/bin)
set -eu

# Bundle root = the directory holding this script.
BUNDLE="$(cd "$(dirname "$0")" && pwd)"

# Resolve the machine's Node and gate its version (REQ-OFFLINE-006). The floor
# guarantees the built-in node:sqlite (FTS5); the ceiling matches the Node 25
# hard exit in the CLI. Called before anything is installed or wired, so an
# unsuitable machine is left untouched.
resolve_node() {
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
}

INSTALL_DIR="${SPECSHIP_INSTALL_DIR:-$HOME/.specship}"
BIN_DIR="${SPECSHIP_BIN_DIR:-$HOME/.local/bin}"
DEST="$INSTALL_DIR/current"

SKIP_CLAUDE=0
UNINSTALL=0
WIRE_GLOBAL=0
WIRE_PATH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-claude) SKIP_CLAUDE=1 ;;
    --uninstall)   UNINSTALL=1 ;;
    --global)      WIRE_GLOBAL=1 ;;
    --path)
      shift
      [ $# -gt 0 ] || { echo "specship: --path requires a directory" >&2; exit 1; }
      WIRE_PATH="$1"
      ;;
    *) echo "specship: unknown option '$1'" >&2; exit 1 ;;
  esac
  shift
done

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f "$BIN_DIR/specship"
  rm -rf "$INSTALL_DIR"
  echo "SpecShip uninstalled (removed $INSTALL_DIR and $BIN_DIR/specship)."
  exit 0
fi

# Gate on the machine's Node before touching anything (REQ-OFFLINE-006.A3):
# an unsupported machine gets no install dir, no symlink, and no wiring.
resolve_node

# 1. Relocate the bundle into a stable install dir (overwritten on upgrade),
#    unless this script is already running from that location.
if [ "$BUNDLE" != "$DEST" ]; then
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$BUNDLE/." "$DEST/"
fi

# 2. Symlink the launcher onto PATH. The launcher resolves this symlink back to
#    the bundle and execs the machine's Node against the bundled app.
mkdir -p "$BIN_DIR"
ln -sf "$DEST/bin/specship" "$BIN_DIR/specship"

echo "Installed to $DEST"
echo "Linked     $BIN_DIR/specship"

# 3. Wire Claude Code via the machine's resolved Node (no npm, no network).
#    REQ-OFFLINE-005: the wiring target is asked, never assumed — a blind
#    project-local install from here would land in the bundle directory.
if [ "$SKIP_CLAUDE" -eq 0 ]; then
  if [ "$WIRE_GLOBAL" -eq 0 ] && [ -z "$WIRE_PATH" ]; then
    if [ -t 0 ]; then
      echo ""
      echo "Wire Claude Code:"
      echo "  [1] globally  — SpecShip loads in every project (~/.claude.json)"
      echo "  [2] one repo  — project-local, indexes that repo (./.mcp.json)"
      echo "  [s] skip      — wire later with: specship install"
      printf "Choice [1/2/s] (default 1): "
      read -r choice || choice=1
      case "$choice" in
        2)
          printf "Repo path: "
          read -r WIRE_PATH
          ;;
        s|S) SKIP_CLAUDE=1 ;;
        *) WIRE_GLOBAL=1 ;;
      esac
    else
      # No TTY, no flags: global is the only safe default — never local
      # into the bundle directory (REQ-OFFLINE-005.A2).
      WIRE_GLOBAL=1
    fi
  fi
fi

if [ "$SKIP_CLAUDE" -eq 0 ]; then
  if [ -n "$WIRE_PATH" ]; then
    if [ ! -d "$WIRE_PATH" ]; then
      echo "specship: --path '$WIRE_PATH' is not a directory" >&2
      exit 1
    fi
    echo "Wiring Claude Code for $WIRE_PATH ..."
    ( cd "$WIRE_PATH" && "$NODE" --liftoff-only "$DEST/lib/dist/bin/specship.js" install --target claude -y --location local )
  else
    echo "Wiring Claude Code globally..."
    "$NODE" --liftoff-only "$DEST/lib/dist/bin/specship.js" install --target claude -y --location global --skip-index
  fi
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "$BIN_DIR is not on your PATH. Add it:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
echo ""
echo "Done. Run: specship --help"
