---
title: CLI
description: Every SpecShip command and the flags it accepts.
---

```bash
specship                         # Run interactive installer
specship install                 # Run installer (explicit)
specship uninstall               # Remove SpecShip from your agents (inverse of install)
specship init [path]             # Initialize in a project (--index to also index)
specship uninit [path]           # Remove SpecShip from a project (--force to skip prompt)
specship index [path]            # Full index (--force to re-index, --quiet for less output)
specship sync [path]             # Incremental update
specship status [path]           # Show statistics
specship query <search>          # Search symbols (--kind, --limit, --json)
specship files [path]            # Show file structure (--format, --filter, --max-depth, --json)
specship context <task>          # Build context for AI (--format, --max-nodes)
specship callers <symbol>        # Find what calls a function/method (--limit, --json)
specship callees <symbol>        # Find what a function/method calls (--limit, --json)
specship impact <symbol>         # Analyze what code is affected by changing a symbol (--depth, --json)
specship affected [files...]     # Find test files affected by changes
specship serve --mcp             # Start MCP server
```

## Query commands

`query`, `callers`, `callees`, and `impact` all accept `--json` for machine-readable output.

```bash
specship query UserService --kind class --limit 10
specship callers handleRequest --json
specship impact AuthMiddleware --depth 3
```

## affected

Traces import dependencies transitively to find which test files are affected by changed source files. See [Affected Tests in CI](/specship/guides/affected-tests/) for options and a CI example.
