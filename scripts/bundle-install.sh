#!/bin/sh
#
# SpecShip offline / air-gapped installer (bundled into the release archive).
#
# Runs from inside an extracted self-contained bundle. Places the launcher on
# PATH and wires Claude Code using ONLY files already in this bundle: the
# vendored Node runtime, the compiled app, and the launcher. No package
# manager, no compiler, no network access.
#
# Usage (from the extracted bundle directory):
#   ./install.sh                 install + wire Claude Code
#   ./install.sh --skip-claude   install only (leave Claude Code config alone)
#   ./install.sh --uninstall     remove the PATH symlink + install directory
#
# Environment:
#   SPECSHIP_INSTALL_DIR   bundle location   (default: ~/.specship)
#   SPECSHIP_BIN_DIR       symlink location  (default: ~/.local/bin)
set -eu

# Bundle root = the directory holding this script.
BUNDLE="$(cd "$(dirname "$0")" && pwd)"

INSTALL_DIR="${SPECSHIP_INSTALL_DIR:-$HOME/.specship}"
BIN_DIR="${SPECSHIP_BIN_DIR:-$HOME/.local/bin}"
DEST="$INSTALL_DIR/current"

SKIP_CLAUDE=0
UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --skip-claude) SKIP_CLAUDE=1 ;;
    --uninstall)   UNINSTALL=1 ;;
    *) echo "specship: unknown option '$a'" >&2; exit 1 ;;
  esac
done

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f "$BIN_DIR/specship"
  rm -rf "$INSTALL_DIR"
  echo "SpecShip uninstalled (removed $INSTALL_DIR and $BIN_DIR/specship)."
  exit 0
fi

# 1. Relocate the bundle into a stable install dir (overwritten on upgrade),
#    unless this script is already running from that location.
if [ "$BUNDLE" != "$DEST" ]; then
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$BUNDLE/." "$DEST/"
fi

# 2. Symlink the launcher onto PATH. The launcher resolves this symlink back to
#    the bundle and execs the vendored Node by relative path.
mkdir -p "$BIN_DIR"
ln -sf "$DEST/bin/specship" "$BIN_DIR/specship"

echo "Installed to $DEST"
echo "Linked     $BIN_DIR/specship"

# 3. Wire Claude Code via the VENDORED Node (no system Node, no network). This
#    writes the MCP server entry, the auto-allow permissions, the slash
#    commands, and the auto-sync hooks.
if [ "$SKIP_CLAUDE" -eq 0 ]; then
  echo "Wiring Claude Code..."
  "$DEST/node" --liftoff-only "$DEST/lib/dist/bin/specship.js" install --target claude -y
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
