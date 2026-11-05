#!/bin/bash
# Model-driven end-to-end (REQ-AGENTSWITCH-005/008/010): a Claude-only SpecShip
# install → switch detected from a Gemini shell → the REAL gemini binary runs a
# headless prompt whose model (scripts/e2e/fake-gemini-model.mjs, a scripted
# stand-in on GOOGLE_GEMINI_BASE_URL) calls SpecShip's explore tool; Gemini CLI
# executes it through SpecShip's MCP server and hands the result back.
# Needs no Google credentials or billing.
#   npm run build && scripts/e2e/gemini-model-loop.sh
#   SPECSHIP_E2E_NODE_BIN / SPECSHIP_E2E_GEMINI_BIN as in gemini-switch.sh
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
N24=${SPECSHIP_E2E_NODE_BIN:-$(dirname "$(command -v node)")}
N22=${SPECSHIP_E2E_GEMINI_BIN:-$(dirname "$(command -v gemini)")}
W=$(mktemp -d); export HOME=$W/home; mkdir -p $HOME/bin
P=$W/project; mkdir -p $P/src
cat > $P/src/scene.ts <<'TS'
export function renderScene(width: number): string {
  return layoutRows(width).join('\n');
}
function layoutRows(width: number): string[] {
  return [`row:${width}`];
}
TS
printf '#!/bin/sh\nexec %s/node %s/dist/bin/specship.js "$@"\n' "$N24" "$REPO" > $HOME/bin/specship; chmod +x $HOME/bin/specship
export PATH=$HOME/bin:$N24:$N22:/usr/bin:/bin
unset CLAUDECODE GEMINI_CLI GEMINI_API_KEY GOOGLE_API_KEY
cd $P && git init -q
specship install --target claude --location local --yes --skip-index >/dev/null 2>&1
specship init . >/dev/null 2>&1; specship index . >/dev/null 2>&1
echo "== switch from a Gemini shell"
GEMINI_CLI=1 specship status 2>&1 | grep -a "SpecShip: set up" | cut -c1-120
LOG=$W/model.jsonl
"$N24/node" "$REPO/scripts/e2e/fake-gemini-model.mjs" 0 "$LOG" > $W/model.out 2>&1 &
MP=$!
for i in $(seq 1 50); do PORT=$(grep -o 'listening on [0-9]*' $W/model.out | grep -o '[0-9]*$'); [ -n "$PORT" ] && break; sleep 0.1; done
GH=$W/gemini-home; mkdir -p $GH/.gemini
printf '{"security":{"auth":{"selectedType":"gemini-api-key"}}}\n' > $GH/.gemini/settings.json
# Trust the project folder the way the user would (REQ-AGENTSWITCH-018) —
# Gemini CLI 0.33.0+ loads nothing from an untrusted folder.
RP=$(cd "$P" && pwd -P)  # macOS: /var → /private/var
printf '{"%s":"TRUST_FOLDER","%s":"TRUST_FOLDER"}\n' "$P" "$RP" > $GH/.gemini/trustedFolders.json
# The tool name the installed Gemini CLI uses (renamed in 0.33.0).
GV=$("$N22/gemini" --version 2>/dev/null | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)
TOOL=$("$N24/node" -e 'const [a,b]=process.argv[1].split(".").map(Number); console.log(a>0||b>=33 ? "mcp_specship_specship_explore" : "specship__specship_explore")' "${GV:-9.9.9}")
echo "== Gemini CLI ${GV:-unknown}: SpecShip's explore tool is $TOOL"
echo "== headless Gemini session against the scripted model (port $PORT)"
GEMINI_CLI_HOME=$GH GEMINI_API_KEY=stand-in-key GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:$PORT \
  timeout 180 gemini -p "Where is renderScene defined and what does it call?" -m gemini-2.5-flash \
  --output-format stream-json --allowed-tools $TOOL > $W/stream.jsonl 2> $W/stderr.log
echo "gemini exit=$?"
kill $MP 2>/dev/null
echo "== what the model was offered and did"; cat $LOG
echo "== Gemini CLI events"
"$N24/node" -e '
const fs=require("fs");
for (const l of fs.readFileSync(process.argv[1],"utf8").split("\n")) { let e; try { e=JSON.parse(l) } catch { continue }
  if (e.type==="tool_use") console.log("tool_use:", e.tool_name, JSON.stringify(e.parameters));
  if (e.type==="tool_result") console.log("tool_result:", e.status, String(e.output ?? "").includes("renderScene") ? "(contains renderScene source)" : String(e.output ?? JSON.stringify(e)).slice(0,120));
  if (e.type==="message" && e.role==="assistant") console.log("assistant:", String(e.content).slice(0,160));
  if (e.type==="result") console.log("result:", e.status, JSON.stringify(e.stats||{}).slice(0,120)); }' $W/stream.jsonl
grep -v -i deprecat $W/stderr.log | grep -i "error" | head -3
echo "== checks"
ok=0
grep -q "\"tool\":\"$TOOL\"" $LOG && echo "PASS model was offered and called $TOOL" || { echo "FAIL model never called $TOOL"; ok=1; }
grep -q '"type":"tool_result".*"status":"success"' $W/stream.jsonl && echo "PASS Gemini CLI ran the SpecShip tool" || { echo "FAIL no successful tool_result"; ok=1; }
grep -qi "invalid tool name\|failed to load agent" $W/stderr.log && { echo "FAIL Gemini rejected the subagent"; ok=1; } || echo "PASS subagent file accepted"
S=$(ls $GH/.gemini/tmp/*/chats/session-* 2>/dev/null | head -1)
[ -n "$S" ] && echo "session file: ${S##*/}"
echo "WORKDIR=$W"
exit $ok
