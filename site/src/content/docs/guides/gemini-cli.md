---
title: Gemini CLI
description: Wiring SpecShip into Google's Gemini CLI — install it for you or print the snippet, global or per project, what Gemini sessions get, and automatic setup when you switch agents.
---

SpecShip supports two coding agents: **Claude Code** and **Gemini CLI**. A
plain `specship install` wires the agent it runs under — Gemini CLI when you
run it from a Gemini CLI shell (`GEMINI_CLI=1`), Claude Code otherwise. Pass
`--target` to choose explicitly.

What Gemini CLI gets is the SpecShip **MCP server** — the same server Claude
Code launches, with the same code-graph and spec tools — plus a `GEMINI.md`
steering block, hooks, and the `/specship:*` commands. With Gemini CLI
0.28.0 or newer it also gets the `spec-author` and `design-md` skills and the
`specship-explorer` subagent (Gemini subagents are experimental: set
`experimental.enableAgents` to use it); an older or undetected Gemini CLI gets
a note naming what was skipped. The status line has no Gemini equivalent and
is not installed. See
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
install prints a note for anything it skipped or that needs a step from you.
That covers the status line, which is Claude Code only. It also covers the
skills and the subagent on a Gemini CLI older than 0.28.0, and the
`experimental.enableAgents` setting the subagent needs (SpecShip never turns
it on for you).

The install also adds `CLAUDE.md` to Gemini CLI's `context.fileName` list, so
Gemini reads your existing `CLAUDE.md` in place alongside `GEMINI.md`. The file
is never copied or rewritten.

Pass `--trust` to also write `~/.gemini/policies/specship.toml`, a policy that
auto-approves SpecShip's read-only tools. An administrator policy still wins,
and shell commands still prompt.

### Or install the Gemini CLI extension

The npm package ships a Gemini CLI extension in its `gemini-extension/`
folder. It provides the MCP server, the `/specship:*` commands and the
steering context:

```bash
gemini extensions install <path-to-package>/gemini-extension
gemini extensions link <path-to-package>/gemini-extension   # follow a local checkout
```

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
| Skills (`spec-author`, `design-md`) | ✓ | ✓ with Gemini CLI 0.28.0 or newer; skipped with a note otherwise |
| `specship-explorer` subagent | ✓ | ✓ with Gemini CLI 0.28.0 or newer — Gemini subagents are experimental and off until you set `experimental.enableAgents` |
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

It works in both directions: Claude Code to Gemini CLI, and Gemini CLI to
Claude Code. The choices you made for the first agent carry over — the
spec-driven layer, auto-allow, and the optional integrations (`--with-jira`,
`--with-designer`). Moving to Gemini CLI writes the `--trust` policy only
when auto-allow was on for the first agent. Moving to Gemini CLI also adds
`CLAUDE.md` to Gemini's `context.fileName`, so your memory text is read in
place rather than copied.

The other agent's files are left exactly as they were, and your own content in
files SpecShip edits (anything outside its marked blocks) is never rewritten.
SpecShip records which agents it is installed for in
`~/.specship/installed-agents.json`. This happens at most once per agent and
scope. If a write fails, the files that attempt already
wrote are put back as they were and the next SpecShip output reports the
failure. SpecShip doesn't retry on its own; run
`specship install --target gemini` to try again.

SpecShip can only notice a new agent when something of its own runs under
that agent. It checks at four points:

- a SpecShip MCP session the new agent opens, for example from a user-wide
  install or an MCP entry you added by hand (the agent is named by the MCP
  client);
- a `specship` command run in the new agent's shell (recognised by the
  agent's launcher variable, `GEMINI_CLI` or `CLAUDECODE`);
- a SpecShip hook event that only one of the agents sends;
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
