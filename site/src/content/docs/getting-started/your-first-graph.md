---
title: Your First Graph
description: Build an index and run your first queries against it.
---

Once SpecShip is installed, building and exploring a graph takes a few commands. (If you ran `specship install` inside the project, it's already indexed — skip to [Check it worked](#check-it-worked).)

## Index a project

```bash
cd your-project
specship init          # initialize + build the index
```

`init` creates the `.specship/` directory and builds the full index (the old `-i`/`--index` flag is still accepted but no longer needed), then suggests a first flow question tailored to the project. For an existing project you can re-index any time:

```bash
specship index          # full index
specship sync           # incremental update of changed files
```

## Check it worked

```bash
specship status
```

This reports the resolved project path, the file/node/edge counts, the active SQLite backend, and the journal mode — a quick check that the index is ready and that you're looking at the project you expect. For a full install diagnosis (runtime, FTS5, MCP server boot, index), run `specship doctor`.

## Run a query

```bash
specship query UserService          # find symbols by name
specship callers handleRequest      # what calls a function
specship callees handleRequest      # what a function calls
specship impact AuthMiddleware      # what a change would affect
specship files --filter src/auth    # scoped file structure from the index
```

Each accepts `--json` for machine-readable output. See the full [CLI reference](/reference/cli/).

## Draw the flow

```bash
specship diagram          # writes docs/flow-diagram.md
```

Renders the project's entry points and the call chains they reach as a Mermaid flowchart, grouped by top-level module and viewable on GitHub. Once the file exists, every `specship sync` / `specship index` keeps it current — output is deterministic and sorted, so a flow change shows up as a small reviewable diff. Tune with `--output`, `--max-nodes`, `--depth`, or the `diagram.*` keys in [`specship.config.json`](/getting-started/configuration/#project-file-specshipconfigjson).

## Hand it to your agent

With a `.specship/` directory present and Claude Code wired up (see [Installation](/getting-started/installation/)), the agent uses the [MCP tools](/reference/mcp-server/) automatically — usually one `specship_explore` call answers a "how does X work" question with the verbatim source of the relevant symbols. Restart Claude Code after installing so the tools load.
