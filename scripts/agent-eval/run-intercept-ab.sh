#!/usr/bin/env bash
# Search-interceptor A/B (STEER-HOOK-DOC, REQ-STEER-006). Both arms run WITH
# the specship MCP; the ONLY variable is the PreToolUse Grep|Glob hook
# (`specship search-intercept`) injected via --settings in the hook arm.
# Neither arm has the UserPromptSubmit prompt-steer hook (project-level
# settings are not loaded in either arm), so the interceptor is measured as
# the point-of-use channel on its own.
#
# Usage: run-intercept-ab.sh <repo-path> "<question>" <label>
# Env:   CG_BIN         specship binary (default: dist/bin/specship.js via node)
#        AGENT_EVAL_OUT output dir (default: /tmp/agent-eval-intercept)
#        EVAL_MODEL     model for BOTH arms (default: opus)
set -uo pipefail

REPO="${1:?usage: run-intercept-ab.sh <repo-path> \"<question>\" <label>}"
Q="${2:?question required}"
LABEL="${3:?label required}"
HARNESS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HARNESS/../.." && pwd)"
CG_BIN="${CG_BIN:-$ROOT/dist/bin/specship.js}"
OUT="${AGENT_EVAL_OUT:-/tmp/agent-eval-intercept}"
EVAL_MODEL="${EVAL_MODEL:-opus}"
NODE_BIN="$(command -v node)"
mkdir -p "$OUT"

[ -d "$REPO/.specship" ] || { echo "no .specship index at $REPO — index it first"; exit 1; }

cat > "$OUT/mcp-specship.json" <<JSON
{"mcpServers":{"specship":{"command":"$NODE_BIN","args":["$CG_BIN","serve","--mcp","--path","$REPO"]}}}
JSON

# The hook arm's settings: exactly the PreToolUse group the installer writes.
cat > "$OUT/settings-intercept.json" <<JSON
{"hooks":{"PreToolUse":[{"matcher":"Grep|Glob","hooks":[{"type":"command","command":"$NODE_BIN $CG_BIN search-intercept"}]}]}}
JSON
echo '{}' > "$OUT/settings-empty.json"

run() {
  local arm="$1" settings="$2"
  local log="$OUT/run-$LABEL-$arm.jsonl"
  echo "############ [$LABEL / $arm / $EVAL_MODEL] ############"
  ( cd "$REPO" && claude -p "$Q" \
      --output-format stream-json --verbose \
      --permission-mode bypassPermissions \
      --model "$EVAL_MODEL" \
      --max-budget-usd 4 \
      --settings "$settings" \
      --strict-mcp-config --mcp-config "$OUT/mcp-specship.json" \
      > "$log" 2>"$OUT/run-$LABEL-$arm.err" )
  echo "exit $? -> $log"
  # Did the interceptor actually fire in this run?
  if grep -q 'indexed code graph' "$log" 2>/dev/null; then
    echo "interceptor: FIRED"
  else
    echo "interceptor: silent"
  fi
  node "$HARNESS/parse-run.mjs" "$log" 2>&1 || true
  echo
}

run "nohook-r1" "$OUT/settings-empty.json"
run "hook-r1"   "$OUT/settings-intercept.json"
run "nohook-r2" "$OUT/settings-empty.json"
run "hook-r2"   "$OUT/settings-intercept.json"
echo "############ COMPLETE: $LABEL ############"
