---
title: CLI
description: Every SpecShip command and the flags it accepts.
---

```bash
specship install                 # Wire SpecShip into Claude Code (project-local by default; --location global)
specship uninstall               # Remove SpecShip from Claude Code (inverse of install)
specship init [path]             # Initialize in a project and build the index (indexing runs by default)
specship uninit [path]           # Remove SpecShip from a project (--force to skip prompt)
specship index [path]            # Full index (--force to re-index, --quiet for less output)
specship sync [path]             # Incremental update
specship status [path]           # Show statistics (--json)
specship query <search>          # Search symbols (--kind, --limit, --json)
specship files [path]            # Show file structure (--format, --filter, --max-depth, --json)
specship callers <symbol>        # Find what calls a function/method (--limit, --json)
specship callees <symbol>        # Find what a function/method calls (--limit, --json)
specship impact <symbol>         # Analyze what code is affected by changing a symbol (--depth, --json)
specship affected [files...]     # Find test files affected by changes
specship drifted [path]          # List spec links in concerning states (--state, --fail-on for CI, --json)
specship workflow <action>       # Workflow engine: list | run | resume | cancel | approve | reject | runs
specship serve --mcp             # Start the MCP server (stdio) for Claude Code
specship serve --ui              # Start the desktop UI + HTTP API (127.0.0.1:4242)
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

## drifted

Lists spec links that are `drifted`, `broken`, or `orphaned`. Add `--fail-on=broken,drifted,orphaned` to exit non-zero, so it works as a CI gate that refuses a PR that breaks a spec link.

```bash
specship drifted --fail-on=broken,drifted,orphaned
```

See [Spec links & drift](/specship/specs/links-and-drift/).

## workflow

Drives the workflow engine from the terminal — `list`, `run <name>`, `resume <runId>`, `cancel <runId>`, `approve <runId>`, `reject <runId>`, `runs`. Pass inputs with repeatable `-i KEY=VALUE`. See [Workflows](/specship/workflows/overview/).

```bash
specship workflow run spec-implement -i SPEC_ID=REQ-AUTH-005
```
