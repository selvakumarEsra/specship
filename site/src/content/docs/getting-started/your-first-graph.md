---
title: Your First Graph
description: Build an index and run your first queries against it.
---

Once SpecShip is installed, building and exploring a graph takes three commands.

## Index a project

```bash
cd your-project
specship init -i      # initialize + index in one step
```

`init` creates the `.specship/` directory; `-i` (or `--index`) immediately builds the full index. For an existing project you can re-index any time:

```bash
specship index          # full index
specship sync           # incremental update of changed files
```

## Check it worked

```bash
specship status
```

This reports the node/edge/file counts, the active SQLite backend, and the journal mode — a quick health check that the index is ready.

## Run a query

```bash
specship query UserService          # find symbols by name
specship callers handleRequest      # what calls a function
specship callees handleRequest      # what a function calls
specship impact AuthMiddleware      # what a change would affect
specship files --filter src/auth    # scoped file structure from the index
```

Each accepts `--json` for machine-readable output. See the full [CLI reference](/specship/reference/cli/).

## Hand it to your agent

With a `.specship/` directory present and an agent configured (see [Installation](/specship/getting-started/installation/)), your agent uses the [MCP tools](/specship/reference/mcp-server/) automatically — no extra step.
