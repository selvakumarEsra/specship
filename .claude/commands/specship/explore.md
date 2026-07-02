---
description: Reads door — explore a codebase region, trace a flow, or get a change's blast radius. Name the symbols you care about; for a flow name both ends; for impact ask "what breaks if I change X".
argument-hint: <symbols | flow from→to | "impact of X">
allowed-tools: mcp__specship__specship_explore, mcp__specship__specship_node, mcp__specship__specship_search, mcp__specship__specship_callers, mcp__specship__specship_callees, mcp__specship__specship_impact
---

# SpecShip Explore: `$ARGUMENTS`

The **reads door** — one entry for every "understand the code" question. Pick the
behaviour from what `$ARGUMENTS` describes; you do not need a separate command.

## With no arguments — a flow worth trying first

When `$ARGUMENTS` is empty, first run `specship starter-prompt`. If it prints a
line, surface it to the user as **"A flow worth trying in this repo: `<line>`"** —
a concrete starter question they can ask to see retrieval in action — then show
the guidance below. If it prints nothing, just show the guidance below. (It
deliberately prints nothing once you've already used retrieval this session.)

## Explore an area / "how does X work" (default)

Call `mcp__specship__specship_explore` with `$ARGUMENTS` as a bag of symbol names
(include `Class.method` qualified forms when given). It returns the relevant
symbols' source grouped by file, plus any flow it can synthesize between them.
Treat the returned source as already Read — do NOT re-Read files. If a god-file
truncates, run `specship_explore` again with a tighter symbol bag rather than
reaching for Read. For one symbol's full body (or an overloaded name), call
`mcp__specship__specship_node` — it returns every overload in one call.

## Trace a flow — "how does X reach Y / the path from X to Y"

Call `specship_explore` naming the symbols that span the flow (e.g.
`mutateElement renderScene`). It surfaces the call path among them, riding
dynamic-dispatch hops (callbacks, React re-render, JSX children) that grep can't
follow. Use `specship_search` first if you only have a partial name.

## Blast radius — "what breaks if I change X"

`mcp__specship__specship_impact` on the symbol for the transitive dependents;
`specship_callers` / `specship_callees` for one hop in either direction.

The index is kept fresh automatically; force a re-index with the `specship sync`
CLI if a recent edit isn't reflected yet.
