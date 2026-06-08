---
title: MCP Server
description: The tools SpecShip exposes to AI agents over MCP.
---

SpecShip runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server. Start it with:

```bash
specship serve --mcp
```

Agents configured by the installer launch this automatically. When a `.specship/` index exists, the agent uses the tools below.

## Tools

| Tool | Purpose |
|---|---|
| `specship_search` | Find symbols by name across the codebase |
| `specship_context` | Build relevant code context for a task — composes search + node + callers + callees in one call |
| `specship_trace` | Trace the call path between two symbols ("how does X reach Y") in one call — each hop with its body inline, following dynamic-dispatch hops (callbacks, React re-render, interface→impl) that grep can't |
| `specship_callers` | Find what calls a function |
| `specship_callees` | Find what a function calls |
| `specship_impact` | Analyze what code is affected by changing a symbol |
| `specship_node` | Get details about a specific symbol (optionally with source code) |
| `specship_explore` | Return source for several related symbols grouped by file, plus a relationship map, in one call |
| `specship_files` | Get the indexed file structure (faster than filesystem scanning) |
| `specship_status` | Check index health and statistics |

## How agents should use it

SpecShip *is* the pre-built search index. For "how does X work?", architecture, trace, or where-is-X questions, an agent should answer in a handful of SpecShip calls and stop — typically with **zero file reads** — rather than re-deriving the answer with `grep` + `Read`. A direct SpecShip answer is a handful of calls; a grep/read exploration is dozens.

The installer writes this guidance into each agent's instructions file automatically.
