#!/bin/bash
S=$(cd "$(dirname "$0")" && pwd); cd $S
ex() { node -pe 'JSON.parse(require("fs").readFileSync(0)).exactPct'; }
for d in runs/*/; do n=$(basename $d); scr=$(echo $n | cut -d- -f2)
  case $scr in sidebar) w=232; h=900;; header) w=1208; h=261;; login) w=1280; h=800;; esac
  [ -f $d/index.html ] || { echo "$n  NO index.html"; continue; }
  line="$n  rest=$(node compare.cjs ref-$scr.png $S/$d/index.html $w $h $S/$d/s0 | ex)"
  if [ $scr = header ]; then line="$line  hover=$(STATE='hover|button.btn-ghost >> nth=0' node compare.cjs ref-header-hover.png $S/$d/index.html $w $h $S/$d/s1 | ex)"; fi
  if [ $scr = login ]; then line="$line  hover=$(STATE='hover|button[type=submit]' node compare.cjs ref-login-hover.png $S/$d/index.html $w $h $S/$d/s1 | ex)  focus=$(STATE='focus|input[placeholder="Enter your email"]' node compare.cjs ref-login-focus.png $S/$d/index.html $w $h $S/$d/s2 | ex)"; fi
  echo "$line  model=$(node -e "const o=JSON.parse(require('fs').readFileSync('$d/claude-out.json','utf8'));process.stdout.write(Object.keys(o.modelUsage||o.stats?.models||{}).join(','))")"
done
