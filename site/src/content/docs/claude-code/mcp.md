---
title: MCP servers
description: See every Model Context Protocol server Claude Code is configured to load — grouped by scope, with live status, real usage from your transcripts, and enable/disable/add controls.
---

The **MCP** page is a single place to see every [Model Context Protocol](https://modelcontextprotocol.io) server configured for Claude Code — the ones that hand the agent its tools. It answers "what can my agent actually call, is any of it broken, and what does it really use?" without grepping through `~/.claude.json` and a pile of `.mcp.json` files.

Everything on it comes from three real sources: your Claude Code config files, a liveness probe, and the tool calls recorded in your ingested transcripts. Nothing is a placeholder.

## The list view

Servers are grouped by where they're declared:

| Scope | Source file | Meaning |
|---|---|---|
| **Global** | `~/.claude.json` | Available in every project. |
| **Project** | `.mcp.json` | Scoped to this repo. |
| **Usage only** | — | Seen in your transcripts but not in any config file — likely removed, or from another machine's setup. |

A summary strip rolls up the fleet: **Servers**, **Connected** (how many are answering now), **Tools** (seen in transcripts), and **Needs attention** (failed servers, named). Each server row shows its scope, transport, total calls, last use, tool count, and a state pill:

| State | Meaning |
|---|---|
| **Active** | Called in the last 24 hours. |
| **Connected** | Answered the liveness probe, no recent calls. |
| **Idle** | Configured, but neither recently used nor answering the probe. |
| **Failed** | The probe was refused — surfaced in Needs attention. |
| **Disabled** | Switched off in config. |

The probe spawns stdio servers and asks them to answer an MCP `initialize`; URL servers get a request. Results are cached for about 30 seconds — use **Reload** to refresh.

**Add server** registers a new server — name, scope (global or project), and either a stdio command or an HTTP URL — by writing it into the owning config file.

## The detail view

Click a server for its detail. Tiles show **Tools** (seen in transcripts), **Calls** (all time), **Result bytes** returned to context, and **Last used**.

- **Tools** — every tool the server was called with, each with its call count and average result size per call (flagged when heavy). A server with no recorded calls says so instead of showing a blank list.
- **Example call** — the latest real input recorded for this server. When no arguments were ever recorded, a shape built from the most-called tool is shown and clearly marked **synthesized**, so it can't be mistaken for a call that happened.
- **Configuration** — the server's JSON config, copyable, with the file it lives in.
- **Enable / Disable** — behind a confirm dialog. Disabling uses Claude Code's own mechanism for `.mcp.json` servers and parks `~/.claude.json` servers in SpecShip's disabled map; enabling restores them.

## Safe writes

Enable, disable, and add all edit your **live** Claude Code config. Every write is atomic, keeps unrelated keys, key order, indentation, and trailing newline byte-for-byte, and a config file that doesn't parse is never overwritten — the edit errors instead.

## SpecShip's own server

The `specship` server is one entry in this list. Its tools are the code-graph tools (`specship_explore`, `specship_search`, `specship_node`, `specship_callers`, `specship_callees`, `specship_impact`, `specship_files`), code health (`specship_health` — maintainability and architecture fitness in one tool), the spec and link tools, `specship_status` (index stats plus which SpecShip build is answering — it replaced `specship_version`), and the opt-in JIRA and Designer groups. Cached clients still calling the retired tool names get answers. The full, generated list is in the [MCP server reference](/reference/mcp-server/).

A few behaviors worth knowing:

- **Naming files in an explore pins them.** Up to four files you name in a `specship_explore` query are returned ahead of everything else, and if a named file can't be included the answer says so instead of dropping it silently.
- **Lightweight models see a smaller menu.** On Haiku or Gemini Flash the code-graph group trims to explore, search, and node — see [Low-end models](/claude-code/low-end-models/).

→ Next: [Memory](/claude-code/memory/) — the CLAUDE.md hierarchy.
