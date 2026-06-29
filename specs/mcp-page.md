---
id: MCP-PAGE-DOC
title: MCP servers page
owner: web-ng
priority: medium
---

<!-- id: MCP-PAGE-DOC -->
# MCP servers page

The desktop dashboard surfaces every Model Context Protocol (MCP) server
configured at the global (`~/.claude.json`) or project (`.mcp.json`) level, so a
user can see at a glance which servers are running, which have failed, and what
tools each exposes to their agents. The page has two views: a **list** of all
configured servers grouped by scope, and a **per-server detail** view showing the
server's status, the tools it exposes (with input schemas and example calls), the
clients using it, and its raw JSON configuration.

The visual contract is the `screens-mcp.jsx` reference in the "SpecShip Desktop"
Claude Design bundle; the snapshot under `specs/mcp-page/` (when present) is the
byte-level reference for spacing, tokens, and layout. This document is the
behavioural contract only — it does not restate pixel values.

Data is served from a typed endpoint (`/api/mcp/servers`) and falls back to a
seed dataset so the page renders before any backend introspection layer exists —
the same progressive pattern the dashboard uses for its mini-graph. The richer
runtime fields the design shows (uptime, protocol version, per-tool call counts,
"used by" clients, live status) are not derivable from the static config files
and remain `[needs review]` until a live-introspection source is wired.

<!-- id: REQ-MCP-001 -->
## The list view MUST present configured servers grouped by scope with summary tiles

The MCP route renders a page header ("MCP servers") with Reload and Add-server
actions, a row of summary stat tiles (server count, running count, total tools
exposed, and a needs-attention count), then the configured servers split into
**Global** and **Project** groups. Each group is omitted when it has no servers.
Each server appears as a clickable row that opens its detail view.

implementations:
  - packages/web-ng/src/app/pages/mcp/mcp.ts:Mcp
  - packages/web-ng/src/app/pages/mcp/mcp.html:mcp
  - packages/web-ng/src/app/pages/mcp/mcp.scss:mcp

## Acceptance
<!-- id: REQ-MCP-001.A1 -->
- The header MUST show the title "MCP servers" with a subtitle describing global + project scope, plus a Reload action and an Add-server action.
<!-- id: REQ-MCP-001.A2 -->
- A summary tile row MUST show: total server count, running-count over total, total tools exposed across all servers, and a needs-attention count of servers in the failed state.
<!-- id: REQ-MCP-001.A3 -->
- Servers MUST be partitioned into a Global group and a Project group, each with a heading, scope icon, config-file hint, and member count; a group with zero members MUST NOT render.
<!-- id: REQ-MCP-001.A4 -->
- Each server row MUST be a single clickable control that navigates to that server's detail view.

<!-- id: REQ-MCP-002 -->
## Each server row MUST communicate its run state and scope at a glance

A server row shows the server's icon with a status dot, its name, a scope pill
(Global / Project), its launch command, the number of tools it exposes, and a
state pill. The three run states — running, failed, disabled — MUST be visually
distinct, and the running state animates its status indicator.

implementations:
  - packages/web-ng/src/app/pages/mcp/mcp.html:server-row
  - packages/web-ng/src/app/pages/mcp/mcp.scss:server-row

## Acceptance
<!-- id: REQ-MCP-002.A1 -->
- A running server MUST render a success-coloured status dot and an animated "Running" pill; a failed server MUST render an error-coloured dot and a "Failed" pill; a disabled server MUST render a muted dot and a "Disabled" pill with no animation.
<!-- id: REQ-MCP-002.A2 -->
- The scope pill MUST read "Global" or "Project" and carry the matching scope icon and colour.
<!-- id: REQ-MCP-002.A3 -->
- The row MUST show the server's tool count with a "tool"/"tools" label that is singular when the count is 1.
<!-- id: REQ-MCP-002.A4 -->
- The launch command MUST be shown in a monospace style and truncate with an ellipsis when it overflows the row.

<!-- id: REQ-MCP-003 -->
## The detail view MUST show a status banner that adapts to the server's state

Opening a server shows a back control, the server name, scope pill and config
hint, then a status banner. The banner's accent colour and content adapt to the
run state: a failed server surfaces its error with a Re-authenticate action; a
disabled server surfaces an Enable action and a note that its tools are declared
but not exposed; a running server shows uptime and a pulsing indicator. The
banner always shows transport, uptime, protocol, tool count, and the copyable
launch command. Below it, a row of summary tiles shows tools, calls this week,
result tokens returned, and client count.

implementations:
  - packages/web-ng/src/app/pages/mcp/mcp-detail.ts:McpDetail
  - packages/web-ng/src/app/pages/mcp/mcp-detail.html:status-banner
  - packages/web-ng/src/app/pages/mcp/mcp-detail.scss:status-banner

## Acceptance
<!-- id: REQ-MCP-003.A1 -->
- The banner accent colour MUST match the run state (success / error / muted) and the running state MUST animate its status indicator.
<!-- id: REQ-MCP-003.A2 -->
- A failed server MUST display its error message and a Re-authenticate action inside the banner.
<!-- id: REQ-MCP-003.A3 -->
- A disabled server MUST display an Enable-server action and a note that its tools are declared but not currently exposed.
<!-- id: REQ-MCP-003.A4 -->
- The banner MUST display transport, uptime, protocol, and tool count, plus the launch command with a copy-to-clipboard control.
<!-- id: REQ-MCP-003.A5 -->
- The summary-tile row MUST show tool count, total calls this week, total result tokens returned, and the number of clients using the server.

<!-- id: REQ-MCP-004 -->
## Each tool MUST expand to reveal its input schema, an example call, and a copy control

The detail view lists the server's tools. Each tool row shows its icon, name,
description, weekly call count, and average tokens-per-call. Clicking a tool
expands it to reveal the input schema (each parameter with name, type, and
required/optional state plus any default), a copyable example call, and — for
tools that track usage — a link into the heatmap. Only one tool is expanded at a
time. A server exposing no tools MUST show an empty state rather than an empty
list.

implementations:
  - packages/web-ng/src/app/pages/mcp/mcp-detail.html:tool-row
  - packages/web-ng/src/app/pages/mcp/mcp-detail.ts:McpDetail.toggleTool

## Acceptance
<!-- id: REQ-MCP-004.A1 -->
- A collapsed tool row MUST show icon, name, single-line description, weekly call count, and average tokens-per-call; a cold tool (zero calls) MUST render its stats in a muted style.
<!-- id: REQ-MCP-004.A2 -->
- Expanding a tool MUST reveal each input parameter with its name, type, a required-or-optional indicator, and any default value; a tool with no parameters MUST state that explicitly.
<!-- id: REQ-MCP-004.A3 -->
- The expanded view MUST show an example call with a copy-to-clipboard control.
<!-- id: REQ-MCP-004.A4 -->
- Expanding one tool MUST collapse any previously expanded tool.
<!-- id: REQ-MCP-004.A5 -->
- A server with zero tools MUST render an empty state in place of the tool list.

<!-- id: REQ-MCP-005 -->
## The detail view MUST list the clients using the server and its raw configuration

Alongside the tools, the detail view shows a "Used by" panel listing each client
(name, host, connection state, last-seen) and a "Configuration" panel showing the
server's JSON config with a copy control and its config-file hint. A server with
no clients MUST say so rather than render an empty panel.

implementations:
  - packages/web-ng/src/app/pages/mcp/mcp-detail.html:used-by
  - packages/web-ng/src/app/pages/mcp/mcp-detail.html:configuration

## Acceptance
<!-- id: REQ-MCP-005.A1 -->
- The "Used by" panel MUST list each client with its name, host, a connection-state label, and a last-seen string; an active client MUST render a glowing status dot.
<!-- id: REQ-MCP-005.A2 -->
- A server with no clients MUST render a "No clients reference this server" message in place of the list.
<!-- id: REQ-MCP-005.A3 -->
- The "Configuration" panel MUST show the server's JSON configuration in a monospace block with a copy-to-clipboard control and the config-file hint (`~/.claude.json` or `.mcp.json`).

<!-- id: REQ-MCP-006 -->
## The page MUST load servers from a typed endpoint with a seed fallback and explicit loading, empty, and error states

The page reads servers from `/api/mcp/servers` through the app's `apiResource`
helper. While the request is in flight it shows loading placeholders; on success
with zero servers it shows an empty state; on error it shows an error state. When
the endpoint is unavailable or returns nothing, the page MUST fall back to a seed
dataset so it still renders meaningfully, marked as seed.

implementations:
  - packages/web-ng/src/app/api/types.ts:McpServersResponse
  - packages/web-ng/src/app/api/mcp-seed.ts:MCP_SEED
  - packages/web-ng/src/app/pages/mcp/mcp.ts:Mcp.servers

## Acceptance
<!-- id: REQ-MCP-006.A1 -->
- The list and detail views MUST source their data from a typed `McpServersResponse` fetched via `apiResource` against `/api/mcp/servers`.
<!-- id: REQ-MCP-006.A2 -->
- While the request is loading, the list MUST render placeholder skeletons rather than an empty or error layout.
<!-- id: REQ-MCP-006.A3 -->
- When the endpoint is unavailable or returns no servers, the page MUST fall back to the seed dataset and indicate the data is seed (illustrative), consistent with the dashboard's seed treatment.
<!-- id: REQ-MCP-006.A4 -->
- A request error MUST surface an error state, not a silent blank page.

<!-- id: REQ-MCP-007 -->
## Navigation MUST use a list route and a deep-linkable detail route

The page is reachable at `mcp` (list) and `mcp/:id` (detail), consistent with the
existing `specs/:id`, `runs/:id`, and `sessions/:id` detail routes. Opening a
server navigates to its detail route; the back control returns to the list. A
detail route for an unknown server id MUST resolve gracefully.

implementations:
  - packages/web-ng/src/app/app.routes.ts:routes
  - packages/web-ng/src/app/pages/mcp/mcp-detail.ts:McpDetail

## Acceptance
<!-- id: REQ-MCP-007.A1 -->
- The list MUST render at route `mcp` and each server's detail at `mcp/:id`, both registered as lazy-loaded routes with the `mcp` nav key.
<!-- id: REQ-MCP-007.A2 -->
- Selecting a server MUST navigate to `mcp/:id`; the detail back control MUST return to `mcp`.
<!-- id: REQ-MCP-007.A3 -->
- A `mcp/:id` route whose id matches no known server MUST render a not-found / empty state rather than erroring.
