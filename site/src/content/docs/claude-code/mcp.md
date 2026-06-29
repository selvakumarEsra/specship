---
title: MCP servers
description: See every Model Context Protocol server your agent can reach — grouped by scope, with each server's tools, status, and configuration.
---

The **MCP servers** page is a single place to see every [Model Context Protocol](https://modelcontextprotocol.io) server configured for your agent — the ones that hand Claude Code its tools. It answers "what can my agent actually call, and is any of it broken?" without you grepping through `~/.claude.json` and a pile of `.mcp.json` files.

## The list view

The page opens on a list of every configured server, split into two groups by where it's declared:

| Scope | Source file | Meaning |
|---|---|---|
| **Global** | `~/.claude.json` | Available in every project. |
| **Project** | `.mcp.json` | Scoped to this repo. |

A summary strip up top rolls up the fleet: total **servers**, how many are **running**, total **tools** exposed across all of them, and a **needs-attention** count (servers in a failed state). Each server row shows its avatar with a live status dot, its name, a scope pill, its launch command, how many tools it exposes, and a state pill:

- **Running** — connected; the dot pulses.
- **Failed** — the connection errored (e.g. an expired token). Surfaced in the needs-attention count.
- **Disabled** — declared but switched off; its tools are listed but not exposed.

Click any row to open that server's detail.

## The detail view

Per server, the detail page leads with a **status banner** that adapts to the run state:

- a **failed** server shows its error and a **Re-authenticate** action;
- a **disabled** server shows an **Enable** action and a note that its tools aren't currently exposed;
- a **running** server shows uptime and a pulsing indicator.

The banner always carries the transport, uptime, protocol revision, tool count, and the copyable launch command. Below it, summary tiles show tools exposed, calls this week, result tokens returned to context, and how many clients use the server.

### Tools

The server's tools are listed as an accordion. Each row shows the tool's name, a one-line description, its weekly call count, and average tokens-per-call (a cold tool — zero calls — is dimmed). Expand a tool to see:

- its **input schema** — every parameter with its type and a required/optional marker (plus any default);
- a copyable **example call**;
- a **View usage in heatmap** shortcut for tools that track usage.

Only one tool is expanded at a time. A server exposing no tools shows an empty state rather than a blank list.

### Used by &amp; configuration

Two panels round out the page:

- **Used by** — the clients referencing this server (Claude Code, Claude Desktop, …) with each one's connection state and last-seen time.
- **Configuration** — the server's JSON config in a copyable block, alongside the config-file hint (`~/.claude.json` or `.mcp.json`) so you know where it lives.

## A note on the data

Configuration-level facts — which servers exist, their scope, command, and config — come from your own config files. The richer **runtime** telemetry the detail view shows (uptime, per-tool call counts, "used by" clients) needs a live introspection source that isn't wired yet, so today the page renders a **representative sample** for those fields rather than inventing numbers. The shape is final; the live data lands when the introspection layer does. (SpecShip would rather show a clearly-illustrative sample than fake a precise figure — the same stance the [SpecShip Impact](/claude-code/specship-impact/) page takes with its `est.` markers.)

→ Next: [Memory](/claude-code/memory/) — the CLAUDE.md hierarchy.
