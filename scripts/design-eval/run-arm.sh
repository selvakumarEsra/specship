#!/bin/bash
# usage: run-arm.sh <screen> <arm: designmd|screenshot> <run#> <w> <h> [agent: haiku|flash]
S=$(cd "$(dirname "$0")" && pwd); screen=$1; arm=$2; run=$3; w=$4; h=$5; agent=${6:-haiku}
D=$S/runs/${TAG:+$TAG-}$agent-$screen-$arm-$run; rm -rf $D; mkdir -p $D
if [ $arm = designmd ]; then
  cp ${DESIGN_MD:-$S/design-$screen/design.md} $D/design.md
  P="Build the UI described in ./design.md as ONE self-contained file ./index.html (inline all CSS and SVG; you may keep the Google Fonts <link> from design.md). It must render pixel-for-pixel like the design in a ${w}x${h} viewport. Follow design.md's Fidelity rules: use every value verbatim. Read design.md fully first. Write only index.html."
else
  cp $S/ref-$screen.png $D/design.png
  P="Build the UI shown in ./design.png as ONE self-contained file ./index.html (inline all CSS and SVG; Google Fonts links are allowed). It must render pixel-for-pixel like the image in a ${w}x${h} viewport. Look at design.png carefully first. Write only index.html."
fi
cd $D && start=$(date +%s)
if [ $agent = flash ]; then
  GEMINI_CLI_HOME=$S/gemhome gemini -p "$P" --model "${FLASH_MODEL:-gemini-3.5-flash}" --allowed-tools read_file,write_file,replace --output-format json > claude-out.json 2> claude-err.txt
else
  claude -p "$P" --model haiku --strict-mcp-config --mcp-config $S/empty-mcp.json --allowedTools "Read,Write,Edit" --disallowedTools "Bash,Glob,Grep,WebFetch,WebSearch,Task,Agent" --setting-sources "" --output-format json > claude-out.json 2> claude-err.txt
fi
echo "{\"secs\": $(( $(date +%s) - start ))}" > timing.json
if [ -f index.html ]; then node $S/compare.cjs $S/ref-$screen.png $D/index.html $w $h $D/shot > score.json 2>&1; cat score.json; else echo "{\"error\":\"no index.html\",\"run\":\"$agent-$screen-$arm-$run\"}"; fi
