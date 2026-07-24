---
id: DESKTOP-CMD-DOC
title: specship desktop — the dashboard gets its own command
owner: specship
priority: medium
---

<!-- id: DESKTOP-CMD-DOC -->
# specship desktop — the dashboard gets its own command

The dashboard/HTTP-API surface has lived under `specship serve --ui`, a flag
on the command whose primary job is the MCP stdio server. That conflates two
unrelated surfaces (an agent's MCP transport vs. a human's local web app) and
buries the dashboard behind a non-obvious flag. This gives the dashboard its
own top-level verb, `specship desktop`, and retires the `--ui` flag.

`serve` stays the MCP command (`serve --mcp`). `desktop` owns the web app and
keeps the ability to also start MCP stdio in the same process (what
`serve --ui --mcp` did) via its own `--mcp` flag.

<!-- id: REQ-DESKTOP-CMD-001 -->
## `specship desktop` MUST start the dashboard + HTTP API

A new top-level command `specship desktop` boots the in-process Fastify
server and the built desktop SPA — byte-for-byte the behavior the
`serve --ui` branch had. It carries the same options: `-p/--path`, `--port`
(default 4242), `--host` (default 127.0.0.1), `--ingest`/`--no-ingest`,
`--web-dir`, `--no-web` (API-only headless), `--no-watch`, and `--mcp` (also
start MCP stdio against the resolved project). Project-root resolution is
unchanged: `--path`, else an initialized cwd, else the most-recently-touched
initialized project, else projectless (the picker prompts).

implementations:
  - src/bin/specship.ts:runDesktop

## Acceptance
<!-- id: REQ-DESKTOP-CMD-001.A1 -->
- `specship desktop` starts the server, prints the HTTP API URL and the
  dashboard URL, and serves the SPA on `http://127.0.0.1:4242/` by default.
<!-- id: REQ-DESKTOP-CMD-001.A2 -->
- `--port`, `--host`, `--no-web`, `--ingest`/`--no-ingest`, `--web-dir`, and
  `--no-watch` behave exactly as they did under `serve --ui`.
<!-- id: REQ-DESKTOP-CMD-001.A3 -->
- `specship desktop --mcp` additionally starts MCP stdio against the
  resolved project (and warns + skips MCP when no project resolves), matching
  the old `serve --ui --mcp`.
<!-- id: REQ-DESKTOP-CMD-001.A4 -->
- The command help/description names it the SpecShip Desktop dashboard, and
  the generated CLI reference lists `specship desktop`.

<!-- id: REQ-DESKTOP-CMD-002 -->
## `serve --ui` MUST be retired with a pointer, not a silent break

The `--ui` flag is removed from `serve`. Invoking `serve --ui` (or the
`--port`/`--host`/`--web-dir`/`--ingest`/`--no-web` flags that only made
sense under `--ui`) MUST fail with a clear message directing the user to
`specship desktop` — never a bare commander "unknown option" error and never
a silent no-op. `serve` continues to run the MCP server (`serve --mcp`) and
its default no-flag info screen is unchanged.

implementations:
  - src/bin/specship.ts:main

## Acceptance
<!-- id: REQ-DESKTOP-CMD-002.A1 -->
- `specship serve --ui` exits non-zero with a message naming
  `specship desktop` as the replacement.
<!-- id: REQ-DESKTOP-CMD-002.A2 -->
- `specship serve --mcp` still starts the MCP server; `specship serve` with
  no flags still prints the MCP info screen.

<!-- id: REQ-DESKTOP-CMD-003 -->
## User-facing references MUST point at the new command

Every user-facing mention of `serve --ui` outside historical changelog
entries — the README, the site docs, in-CLI tips, and the auto-generated CLI
reference — names `specship desktop` instead. Past `## [X.Y.Z]` CHANGELOG
blocks are historical record and are left as-is (they describe what shipped
under the old name).

implementations:
  - src/bin/specship.ts:main
  - README.md

## Acceptance
<!-- id: REQ-DESKTOP-CMD-003.A1 -->
- The in-CLI dashboard tip (shown after indexing) says `specship desktop`,
  not `serve --ui`.
<!-- id: REQ-DESKTOP-CMD-003.A2 -->
- README and the site docs' getting-started/reference pages reference
  `specship desktop`; released CHANGELOG version blocks are unchanged.
