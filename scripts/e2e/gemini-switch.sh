#!/bin/bash
# Usage: npm run build && scripts/e2e/gemini-switch.sh
#   SPECSHIP_E2E_NODE_BIN   dir of the Node (22.5+, FTS5) that runs SpecShip  (default: node on PATH)
#   SPECSHIP_E2E_GEMINI_BIN dir holding the gemini binary                       (default: gemini on PATH)
# Needs no Gemini credentials: listing commands get a placeholder key and make no model call.
# REQ-AGENTSWITCH-005/007/008/010 — end-to-end: Claude-only SpecShip install → switch detected from a Gemini shell → the REAL gemini 0.28.0 binary loads what SpecShip wrote.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
N24=${SPECSHIP_E2E_NODE_BIN:-$(dirname "$(command -v node)")}
N22=${SPECSHIP_E2E_GEMINI_BIN:-$(dirname "$(command -v gemini)")}
W=$(mktemp -d); export HOME=$W/home; mkdir -p $HOME/bin
P=$W/project; mkdir -p $P/src; echo 'export function hello(){ return 1 }' > $P/src/a.ts; echo '# My project notes' > $P/CLAUDE.md
cat > $HOME/bin/specship <<SH
#!/bin/sh
exec $N24/node $REPO/dist/bin/specship.js "\$@"
SH
chmod +x $HOME/bin/specship
export PATH=$HOME/bin:$N24:/usr/bin:/bin
unset CLAUDECODE GEMINI_CLI
cd $P && git init -q
echo "== 1. Claude-only install"
specship install --target claude --location local --yes --skip-index >/dev/null 2>&1; echo "exit=$?"
specship init . >/dev/null 2>&1; specship index . >/dev/null 2>&1
ls -a $P | tr '\n' ' '; echo
echo "== 2. a specship command from a Gemini CLI shell (switch detection)"
export PATH=$HOME/bin:$N24:$N22:/usr/bin:/bin
GEMINI_CLI=1 specship status 2>&1 | grep -ai "set up\|SpecShip:" | head -3
ls -a $P | tr '\n' ' '; echo; ls $P/.gemini 2>/dev/null | tr '\n' ' '; echo
echo "== CLAUDE.md unchanged?"; cat $P/CLAUDE.md
echo "== 3. REAL gemini binary: mcp list (spawns specship serve --mcp)"
export PATH=$HOME/bin:$N22:/usr/bin:/bin
export GEMINI_API_KEY=placeholder-not-used-for-listing
(cd $P && timeout 60 gemini mcp list 2>&1 | grep -v -i deprecat | tail -6)
echo "== 4. REAL gemini binary: skills list"
(cd $P && timeout 60 gemini skills list 2>&1 | grep -v -i deprecat | tail -12)
echo "== 5. second Gemini-shell command writes nothing (once only)"
export PATH=$HOME/bin:$N24:/usr/bin:/bin
before=$(find $P/.gemini -type f -exec shasum {} \; | sort | shasum)
GEMINI_CLI=1 specship status 2>&1 | grep -ai "set up" | head -2
after=$(find $P/.gemini -type f -exec shasum {} \; | sort | shasum)
[ "$before" = "$after" ] && echo "unchanged: yes" || echo "unchanged: NO"
echo "== 6. REAL gemini-cli-core loaders validate the subagent + skill files"
CORE=$N22/../lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src
ls $P/.gemini/agents $P/.gemini/skills 2>&1 | tr "\n" " "; echo
$N22/node --input-type=module -e "const a=await import('$CORE/agents/agentLoader.js'); const s=await import('$CORE/skills/skillLoader.js'); const fns=Object.keys(a).filter(k=>/load|parse/i.test(k)); console.log('agentLoader exports:',fns.join(',')); const sf=Object.keys(s).filter(k=>/load/i.test(k)); console.log('skillLoader exports:',sf.join(','));" 2>&1 | tail -3
echo "WORKDIR=$W"
