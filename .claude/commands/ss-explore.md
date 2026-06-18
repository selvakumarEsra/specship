---
description: Explore a region of the codebase by naming the symbols you care about. Use for "how does X work" or "what's in this area" questions.
argument-hint: <symbol-bag>
allowed-tools: mcp__specship__specship_explore, mcp__specship__specship_node
---

# SpecShip Explore: `$ARGUMENTS`

Call `mcp__specship__specship_explore` with `$ARGUMENTS` as a bag of symbol names (include `Class.method` qualified forms when given). The tool returns the relevant symbols' source grouped by file, plus any flow it can synthesize between them.

Treat the returned source as already Read — do NOT re-Read files. If the response truncates a god-file, run `specship_explore` again with a tighter symbol bag rather than reaching for Read.

If a specific overload's full body is needed, call `mcp__specship__specship_node` on the symbol name — the response returns every overload in one call.
