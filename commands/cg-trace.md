---
description: Trace the call flow from one symbol to another using SpecShip. Use for "how does X reach Y" questions — much faster than grep + Read.
argument-hint: <from-symbol> <to-symbol>
allowed-tools: mcp__specship__specship_explore, mcp__specship__specship_node
---

# SpecShip Trace: `$1` → `$2`

Call `mcp__specship__specship_explore` with a query that names BOTH `$1` and `$2` (include any qualified forms like `Class.method` if the user gave one). The Flow section in the response will show the path between them with inline source for every hop.

If explore returns no Flow section, the two symbols don't connect statically — say so. Don't fall back to grep / Read; the absence is the answer.

If you need to drill into a single symbol's full body afterwards, use `mcp__specship__specship_node` — never Read the file directly.
