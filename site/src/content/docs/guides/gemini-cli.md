---
title: Gemini CLI
description: Opt-in support for wiring SpecShip's MCP server into Google's Gemini CLI — install it for you or print the snippet, global or per project, and what Gemini sessions do and don't get.
---

SpecShip is built for Claude Code. **Gemini CLI is the one other agent it
supports**, and only as an explicit opt-in: a plain `specship install` still
sets up Claude Code alone.

What Gemini CLI gets is the SpecShip **MCP server** — the same server Claude
Code launches, with the same code-graph and spec tools — plus a `GEMINI.md`
steering block, hooks, and the `/specship:*` commands. Two Claude Code
surfaces have no Gemini equivalent and are not installed: the
`specship-explorer` subagent and the status line. See
[the full comparison](#what-gemini-cli-gets--and-doesnt).

## Install

Let SpecShip write the entry for you:

```bash
specship install --target gemini            # Gemini CLI only
specship install --target claude,gemini     # both agents in one go
```

The installer asks where to put it — or pass `--location`:

| Location | File | Scope |
|---|---|---|
| `global` | `~/.gemini/settings.json` | Every project you open in Gemini CLI |
| `local` | `.gemini/settings.json` in the current directory | This project only |

The installer adds a single `mcpServers.specship` entry. Any other MCP servers
and settings already in that file are left untouched, re-running the install
changes nothing, and an optional integration you enabled earlier
(`--with-jira`, `--with-designer`) stays enabled. When it finishes, the
install prints a note listing what a Claude Code install adds that Gemini CLI
doesn't get, so you're never left assuming something is wired when it isn't.

The tools answer from the project's SpecShip index. A `local` install
initializes and indexes the current project for you (skip with
`--skip-index`); after a `global` install, run `specship init` in each
project you open. See [Indexing a project](/guides/indexing/).

## Or paste the snippet yourself

To wire it by hand, print the snippet. Printing writes nothing to disk:

```bash
specship install --print-config --target gemini --location global
```

```json
{
  "mcpServers": {
    "specship": {
      "command": "specship",
      "args": ["serve", "--mcp"],
      "env": {
        "SPECSHIP_HOST": "gemini"
      }
    }
  }
}
```

Merge it into the `mcpServers` block of the settings file for the location you
want. Keep the `SPECSHIP_HOST` line — it is how the server knows it was
launched by Gemini CLI, which turns on
[model detection](#model-aware-output) for Gemini sessions.

## Model-aware output

Because Gemini CLI has no status line to report the model, the server
reads the session's model from Gemini CLI's own configuration — the
`GEMINI_MODEL` environment variable, or `model` in the project's
`.gemini/settings.json`, falling back to `~/.gemini/settings.json`. A Flash
session then gets the compact, one-call-friendly output a lightweight model
needs; Gemini Pro gets full output. Set `SPECSHIP_MODEL` to force a tier. See
[Low-end models](/claude-code/low-end-models/).

## What Gemini CLI gets — and doesn't

<!-- capability-matrix:start -->
| | Claude Code | Gemini CLI |
|---|---|---|
| SpecShip MCP tools (explore, search, specs, links, …) | ✓ | ✓ |
| Opt-in JIRA / Designer tools | ✓ | ✓ with `--with-jira` / `--with-designer` |
| Model-tier adaptation | ✓ | ✓ |
| Steering block (retrieval preference + spec-first rule) | ✓ `CLAUDE.md` | ✓ `GEMINI.md` |
| Hooks: per-prompt reminder, session cheat-sheet, sync after edits, search pointer | ✓ | ✓ (project hooks run only in trusted folders) |
| `/specship:*` slash commands | ✓ | ✓ rendered as Gemini TOML commands |
| Workflow prompt steps (`specship workflow run`, `/specship:spec implement`) | ✓ | ✓ with `--agent gemini`, or automatically when launched from Gemini CLI — single steps checked live; a full implement run has not been measured |
| Auto-approved SpecShip tools | ✓ | ✓ read-only tools only, opt-in with `--trust`; an administrator policy still wins |
| `specship-explorer` subagent | ✓ | — |
| Status-line segment | ✓ | — |
<!-- capability-matrix:end -->

Retrieval benchmarks (one-call answers, no file reads) were measured on Claude Code. A first Gemini CLI comparison (one question, two runs per arm) is in `docs/benchmarks/call-sequence-analysis.md`; it shows fewer file reads with SpecShip but does not yet meet the Claude Code bar.

## Workflows on Gemini CLI

`specship workflow run` (and `/specship:spec implement`) runs each prompt step
on a coding agent's headless mode. Launched from inside Gemini CLI it picks
Gemini automatically; elsewhere choose it with `--agent gemini`,
`SPECSHIP_WORKFLOW_AGENT=gemini`, or `"workflow": { "agent": "gemini" }` in
`specship.config.json`. A run keeps the agent it started with through
approvals and resumes. Gemini needs to be signed in with an account that can
make API calls (for example a `GEMINI_API_KEY`).

Steps name Claude-style model tiers (`haiku`, `sonnet`, `opus`). Map them to
Gemini models in `specship.config.json`; without a mapping, Gemini's own
default model runs:

```json
{
  "workflow": {
    "agents": {
      "gemini": { "models": { "haiku": "<flash-lite model>", "sonnet": "<flash model>", "opus": "<pro model>" } }
    }
  }
}
```

A step Gemini can't run faithfully — a tool with no Gemini equivalent, or a
tool deny-list — fails with the reason rather than running without it. An
administrator policy that requires confirmation for shell commands makes
those steps fail in headless mode; it is never bypassed.

## Switching agents: automatic setup

If SpecShip is already installed for one agent and it notices it is running
under another supported agent, it sets itself up for the new agent without
asking. It uses the same scope as your existing install: this project if
SpecShip was installed per project, all projects if it was installed
user-wide. It then prints one line naming the files it wrote and the command
that undoes them, for example:

```text
SpecShip: set up Gemini CLI for this project — wrote .gemini/settings.json, GEMINI.md, .gemini/commands/specship/ (5 files). Undo: `specship uninstall --target gemini --local`
```

The other agent's files are left exactly as they were. This happens at most
once per agent and scope. If a write fails, the files that attempt already
wrote are put back as they were and the next SpecShip output reports the
failure. SpecShip doesn't retry on its own; run
`specship install --target gemini` to try again.

SpecShip can only notice a new agent when something of its own runs under
that agent. It checks at three points:

- a SpecShip MCP session the new agent opens, for example from a user-wide
  install or an MCP entry you added by hand;
- a `specship` command run in the new agent's shell;
- the SpecShip git hook, which runs `specship sync` when you commit from that
  shell.

A project where SpecShip is wired only into Claude Code, opened in a Gemini
CLI session that never runs SpecShip, **can't be detected**. Run
`specship install --target gemini` there yourself.

To turn automatic setup off, set `SPECSHIP_AUTO_MIGRATE=0` in your
environment, or add `"autoMigrate": false` to the project's
`specship.config.json`. SpecShip then writes nothing and prints a one-line
hint with the install command instead, once.

## Uninstall

Remove just the Gemini wiring, keeping your indexes and the program:

```bash
specship uninstall --target gemini --global   # user-wide install
specship uninstall --target gemini --local    # this project only
```

`--local` and `--global` are short for `--keep-data --location local|global`.

Only the `specship` entry is removed — other servers and settings in the file
survive unchanged. A full `specship uninstall` (without `--keep-data`) removes
SpecShip completely, including any Gemini CLI entry.
