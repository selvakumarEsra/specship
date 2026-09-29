#!/usr/bin/env bash
# Gemini CLI A/B eval runner (LOWEND-DOC REQ-LOWEND-005).
#
# Same methodology as run-all.sh, different host: with-specship vs
# without-specship, ≥2 runs per arm, metrics normalized to the shared schema
# by parse-run-gemini.mjs so a gemini-3.5-flash row is comparable with a
# Claude row. run-all.sh is untouched (REQ-LOWEND-005.A3).
#
# Why this writes settings instead of passing flags: Gemini CLI has no
# --mcp-config/--strict-mcp-config. MCP servers come from
# <repo>/.gemini/settings.json, so each arm is produced by WRITING that file
# (with = mcpServers.specship, without = none) and pinning the allowed server
# set on the command line. Any pre-existing file is backed up and restored on
# exit.
#
# Flags and output schema verified against @google/gemini-cli 0.28.0
# (`gemini --help`; core `dist/src/output/types.d.ts`): `-m`, `-p`, `--yolo`,
# `--allowed-mcp-server-names`, and `--output-format stream-json` — the
# stream form is what carries the ORDERED tool sequence the pass bar counts.
#
# Usage: run-all-gemini.sh <repo-path> "<question>"
# Env:   CG_BIN             specship binary (default: command -v specship)
#        AGENT_EVAL_OUT     output dir (default: /tmp/agent-eval-gemini)
#        GEMINI_EVAL_MODEL  model for BOTH arms (default: gemini-3.5-flash)
#        SPECSHIP_MODEL     tier override handed to the MCP server — set to
#                           `lite` or `standard` to run REQ-LOWEND-002's two
#                           candidate-tier arms; unset = auto-detection.
#        EVAL_RUNS          iterations per arm (default: 2 — never conclude
#                           from n=1; run-to-run variance is large)
set -uo pipefail

REPO="${1:?usage: run-all-gemini.sh <repo-path> \"<question>\"}"
Q="${2:?question required}"
CG_BIN="${CG_BIN:-$(command -v specship)}"
OUT="${AGENT_EVAL_OUT:-/tmp/agent-eval-gemini}"
GEMINI_EVAL_MODEL="${GEMINI_EVAL_MODEL:-gemini-3.5-flash}"
EVAL_RUNS="${EVAL_RUNS:-2}"
HARNESS="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_DIR="$REPO/.gemini"
SETTINGS="$SETTINGS_DIR/settings.json"
BACKUP="$OUT/settings.json.bak"
HAD_SETTINGS=0
mkdir -p "$OUT"

[ -n "$CG_BIN" ] || { echo "no specship binary on PATH (set CG_BIN)"; exit 1; }
[ -d "$REPO/.specship" ] || { echo "no .specship index at $REPO — index it first"; exit 1; }

# --- preflight (REQ-LOWEND-005.A2): a missing or unauthenticated gemini is a
# --- hard failure. Never a skip, never recorded as a pass.
preflight() {
  command -v gemini >/dev/null 2>&1 || {
    echo "prerequisite missing: the 'gemini' CLI is not on PATH."
    echo "  install: npm i -g @google/gemini-cli"
    exit 1
  }
  echo "###### preflight: gemini $(gemini --version 2>/dev/null | head -1)"
  local smoke
  smoke="$(gemini -m "$GEMINI_EVAL_MODEL" -p 'reply OK' 2>&1)"
  local rc=$?
  if [ $rc -ne 0 ] || printf '%s' "$smoke" | grep -qiE 'auth|api key|credential|unauthenticated|permission denied'; then
    echo "gemini is installed but not usable (exit $rc):"
    printf '%s\n' "$smoke" | tail -5
    echo "  authenticate first: run 'gemini' once interactively (Google login) or export GEMINI_API_KEY."
    exit 1
  fi
}

settings_arm() {
  local arm="$1"
  mkdir -p "$SETTINGS_DIR"
  if [ "$arm" = with ]; then
    # Mirrors src/installer/targets/gemini.ts:geminiEntry — no `type` field
    # (Gemini restricts it to sse|http), and SPECSHIP_HOST=gemini so the
    # host-gated tier detection leg fires (REQ-LOWEND-001).
    local model_env=""
    [ -n "${SPECSHIP_MODEL:-}" ] && model_env=",\"SPECSHIP_MODEL\":\"$SPECSHIP_MODEL\""
    cat > "$SETTINGS" <<JSON
{"mcpServers":{"specship":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"],"env":{"SPECSHIP_HOST":"gemini"$model_env}}}}
JSON
  else
    echo '{"mcpServers":{}}' > "$SETTINGS"
  fi
}

restore_settings() {
  if [ "$HAD_SETTINGS" = 1 ]; then
    cp "$BACKUP" "$SETTINGS"
  else
    rm -f "$SETTINGS"
    rmdir "$SETTINGS_DIR" 2>/dev/null
  fi
}

if [ -f "$SETTINGS" ]; then HAD_SETTINGS=1; cp "$SETTINGS" "$BACKUP"; fi
trap restore_settings EXIT

preflight

echo "###### specship: $CG_BIN"
echo "###### repo:      $REPO"
echo "###### question:  $Q"
echo "###### model:     $GEMINI_EVAL_MODEL"
echo "###### tier:      ${SPECSHIP_MODEL:-auto-detect}"
echo "###### runs/arm:  $EVAL_RUNS"
echo

# One arm run. Exit codes propagate — an arm invocation is never suffixed
# with an ignore-failure clause, so a crashed run can never be tallied as a
# clean zero-tool answer.
arm() {
  local label="$1" arm_kind="$2"
  local log="$OUT/run-gemini-$label.jsonl"
  settings_arm "$arm_kind"
  echo "############################## GEMINI [$label] ##############################"
  # --allowed-mcp-server-names pins the server set so a globally-installed
  # specship entry (~/.gemini/settings.json) can't leak into either arm:
  # the without-arm allows only a name that does not exist.
  local allow=specship
  [ "$arm_kind" = with ] || allow=__none__
  ( cd "$REPO" && gemini -m "$GEMINI_EVAL_MODEL" -p "$Q" \
      --yolo --output-format stream-json \
      --allowed-mcp-server-names "$allow" \
      > "$log" 2>"$OUT/run-gemini-$label.err" )
  local rc=$?
  echo "exit $rc -> $log ($(wc -l < "$log" | tr -d ' ') lines)"
  tail -2 "$OUT/run-gemini-$label.err" 2>/dev/null
  node "$HARNESS/parse-run-gemini.mjs" "$log"
  local prc=$?
  echo
  [ $rc -eq 0 ] && [ $prc -eq 0 ] || { echo "[arm $label FAILED: gemini exit $rc, parse exit $prc]"; FAILED=1; }
}

FAILED=0
for i in $(seq 1 "$EVAL_RUNS"); do arm "with-$i" with; done
for i in $(seq 1 "$EVAL_RUNS"); do arm "without-$i" without; done

echo "############################## RUN-ALL-GEMINI COMPLETE ##############################"
[ "$FAILED" = 0 ] || { echo "one or more arms failed — do not record these numbers"; exit 1; }
