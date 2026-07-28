---
id: MCP-VERSION-DOC
title: Report the running SpecShip version inside Claude Code
owner: core
priority: medium
version: 1
---

<!-- id: MCP-VERSION-DOC -->
# Report the running SpecShip version inside Claude Code

A user in a Claude Code session cannot currently find out which SpecShip is
answering their tool calls. `specship --version` reports whatever binary is on
`PATH`, which is frequently **not** the install serving the session — the MCP
server is launched from whatever path the client's MCP config points at, so a
local dev build, a bundle install (`~/.specship`) and an npm global install can
all coexist on one machine. The consequence is a recurring class of confusion:
a fix ships, the user's session keeps behaving the old way, and neither the user
nor the agent can tell that the session is bound to an older install.

This document covers the in-session version surface: a dedicated MCP tool, the
same identity echoed from `specship_status`, and the deliberate absence of any
network call.

Scope is **reporting only** — no update check, no self-update, no restart
prompting. Comparing against the latest published release stays with
`specship update --check` (CLI-UPDATE-DOC).

<!-- id: REQ-MCPVER-001 -->
## A `specship_version` MCP tool MUST report the identity of the server answering the session

The MCP server exposes a zero-argument tool that returns the version and install
identity of the **running server process** — not of any binary on `PATH`. It is
the tool an agent picks when the user asks "what version of SpecShip am I
running?".

The reported identity comprises:

- the resolved package version (`SpecShipPackageVersion`),
- the install method (`bundle` / `npm` / `unknown`) and the resolved install
  directory the server was loaded from,
- the Node.js version the server runs on,
- the project root the session is bound to.

implementations:
  - src/mcp/version.ts:SpecShipPackageVersion
  - src/update/updater.ts:resolveInstallDir
  - src/mcp/tools.ts:ToolHandler.handleVersion

verifies:
  - __tests__/mcp-version-tool.test.ts

## Acceptance
<!-- id: REQ-MCPVER-001.A1 -->
- Calling `specship_version` with no arguments returns the same version string as `SpecShipPackageVersion` for the process serving the call.
<!-- id: REQ-MCPVER-001.A2 -->
- The output names the install directory the running server was loaded from and classifies it as `bundle`, `npm`, or `unknown` using the same classification as `specship update`.
<!-- id: REQ-MCPVER-001.A3 -->
- The output states the Node.js version of the server process and the project root the session resolved to.
<!-- id: REQ-MCPVER-001.A4 -->
- The tool is listed by `tools/list` for every model tier, including the trimmed low-model menu.
<!-- id: REQ-MCPVER-001.A5 -->
- The tool succeeds on a project with no `.specship/` index — version reporting MUST NOT require an opened database.

<!-- id: REQ-MCPVER-002 -->
## `specship_status` MUST carry the same version identity

`specship_status` reports the version and install identity as leading lines of
its output, so a user or agent already inspecting index health sees which
install produced it without a second call, and a stale-install diagnosis needs
no extra round trip.

implementations:
  - src/mcp/tools.ts:MCPTools.handleStatus

## Acceptance
<!-- id: REQ-MCPVER-002.A1 -->
- `specship_status` output includes a version line and an install line reporting the same values `specship_version` reports for the same process.
<!-- id: REQ-MCPVER-002.A2 -->
- The version and install lines appear above the index statistics (files / nodes / edges) and below any worktree-mismatch warning.
<!-- id: REQ-MCPVER-002.A3 -->
- Existing `specship_status` fields (files, nodes, edges, database size, backend, journal mode, nodes-by-kind, languages) remain present and unchanged in wording.

<!-- id: REQ-MCPVER-003 -->
## Version reporting MUST NOT make a network call

Both surfaces answer purely from local process state. No release lookup, no
registry query, no cached remote comparison — an offline session, an air-gapped
machine, and a network-blocked sandbox all get the same instant answer.

## Acceptance
<!-- id: REQ-MCPVER-003.A1 -->
- Neither `specship_version` nor `specship_status` performs any outbound request; with all network access blocked, both return normally.
<!-- id: REQ-MCPVER-003.A2 -->
- Neither surface reports whether a newer release exists, and neither suggests that it knows; where an upgrade path is worth mentioning it MUST point at `specship update --check`.

<!-- id: REQ-MCPVER-004 -->
## An unresolvable version MUST be reported honestly, not hidden

When the package version cannot be read (unpacked oddly, missing
`package.json`), the surfaces report the `0.0.0-unknown` sentinel and say the
version could not be resolved, rather than omitting the line or failing the
call.

## Acceptance
<!-- id: REQ-MCPVER-004.A1 -->
- With an unreadable `package.json`, `specship_version` returns successfully, shows `0.0.0-unknown`, and states that the version could not be resolved from the install.
<!-- id: REQ-MCPVER-004.A2 -->
- With an unreadable `package.json`, `specship_status` still returns its full index statistics — the version line degrades, the tool does not error.

<!-- id: REQ-MCPVER-005 -->
## Agent-facing guidance MUST direct version questions at these surfaces

The MCP server's instructions tell Claude Code to answer "which SpecShip version
is running" from `specship_version` rather than by shelling out to
`specship --version`, because the shell answer describes a different install
from the one serving the session.

implementations:
  - src/mcp/server-instructions.ts

## Acceptance
<!-- id: REQ-MCPVER-005.A1 -->
- The server instructions name `specship_version` as the source for version and install questions and state that `specship --version` may describe a different install.
<!-- id: REQ-MCPVER-005.A2 -->
- The `specship_status` tool description mentions that it also reports the running version, so the tool is selectable for that question.
