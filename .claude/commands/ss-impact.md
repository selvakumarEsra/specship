---
description: Show what would break if you change a symbol. Use before editing a function/class/method to scope the blast radius.
argument-hint: <symbol>
allowed-tools: mcp__specship__specship_impact, mcp__specship__specship_callers
---

# SpecShip Impact: `$1`

Call `mcp__specship__specship_impact` on `$1`. The response lists every transitive dependent — symbols that would need to change (or be re-verified) if `$1`'s contract changes.

Group the output by file and lead with the count. Note any provenance: `heuristic` edges in the result — those came from a dynamic-dispatch synthesizer (callback, EventEmitter, React re-render, JSX child) and are higher-uncertainty than static-call edges.

If the user wants direct callers only (not transitive), use `mcp__specship__specship_callers` instead.
