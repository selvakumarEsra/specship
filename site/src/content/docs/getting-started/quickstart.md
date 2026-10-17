---
title: Get Started
description: Get up and running with SpecShip in a couple of minutes.
---

Get up and running with SpecShip in a couple of minutes.

## 1. Get the CLI (needs Node.js 22.5 or newer, below 25)

SpecShip runs on the Node.js already installed on your machine — nothing to compile, no native build. Any version from **22.5 up to (but not including) 25** works; Node 25 is blocked because of a V8 bug that crashes grammar compilation.

```bash
npm i -g @specship/specship
```

Or download a prebuilt bundle with one command:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/selvakumarEsra/specship/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/selvakumarEsra/specship/main/install.ps1 | iex
```

No network on the target machine? Use the [offline bundle](/getting-started/installation/#offline--air-gapped-install).

## 2. Wire it into Claude Code

```bash
cd your-project
specship install
```

An interactive install asks one question — just this project (recommended) or all projects. Everything else is defaulted and named in the closing summary: the SpecShip status line is added (an existing one is never overwritten; `--skip-statusline` to skip) and the project is indexed (`--skip-index` to skip). It finishes with a quick install check and a reminder to restart.

## 3. Restart Claude Code

An MCP server added to the config isn't visible to a session that's already open — restart Claude Code (or run `/mcp`). If anything looks off, run:

```bash
specship doctor
```

It checks the runtime, FTS5, MCP server boot, and the project index, and exits non-zero on a blocking problem.

## 4. Ask a question

In Claude Code, ask a structural question about your code — "how does a request reach the database?" — and the agent answers from the graph with `specship_explore`. The `/specship:explore` command suggests a first question tailored to your project.

## More projects

A global install works in every project, but each project still needs its own index:

```bash
cd another-project
specship init
```

Next: build [Your First Graph](/getting-started/your-first-graph/), or see the full [Installation](/getting-started/installation/) options.
