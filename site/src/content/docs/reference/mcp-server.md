---
title: MCP Server
description: The tools SpecShip exposes to AI agents over MCP.
---

SpecShip runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server. Start it with:

```bash
specship serve --mcp
```

Claude Code (and Gemini CLI, if you opted in with `--target gemini`) launches this automatically once `specship install` has wired it. The core tools are 100% local; the JIRA and Designer groups appear only when you opt in to them at install time.

<!-- GENERATED:mcp-tools START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->
**Core (always available):** `specship_callees` · `specship_callers` · `specship_drifted` · `specship_explore` · `specship_files` · `specship_health` · `specship_impact` · `specship_link_assert` · `specship_link_verify` · `specship_node` · `specship_search` · `specship_spec` · `specship_status`

**JIRA integration (opt-in, `specship install --with-jira`):** `specship_jira_add_task` · `specship_jira_anchor` · `specship_jira_coverage` · `specship_jira_epics` · `specship_jira_issue` · `specship_jira_issues` · `specship_jira_pick` · `specship_jira_publish` · `specship_jira_reconcile` · `specship_jira_regression_pack` · `specship_jira_regression_record` · `specship_jira_start` · `specship_jira_track` · `specship_jira_transition`

**Designer integration (opt-in + experimental, `--with-designer`):** `designer_ask` · `designer_handoff` · `designer_list` · `designer_prompt` · `designer_session` · `designer_snapshot`
<!-- GENERATED:mcp-tools END -->

## Code-graph tools

| Tool | Purpose |
|---|---|
| `specship_explore` | **Primary.** Returns the verbatim source of the symbols relevant to a question — a plain question or a list of symbol/file names both work — grouped by file. It also gives a relationship map and the call path among the symbols you named, following dynamic-dispatch hops grep can't, like callbacks, React re-render, and interface→implementation. Matching human-confirmed domain facts and a "Prior work" section (past sessions that edited these files) are included inline. Usually the only call an agent needs. |
| `specship_search` | Find symbols by name across the codebase (locations only). Optional `kind` filter. |
| `specship_node` | Get one symbol in full: its location, signature, caller/callee trail and (with `includeCode`) its body. For an ambiguous or overloaded name it returns every matching definition in one call; pass `file` and/or `line` to narrow to one. |
| `specship_callers` | Find what calls a function. |
| `specship_callees` | Find what a function calls. |
| `specship_impact` | Analyze what code is affected by changing a symbol (`depth`, default 2). |
| `specship_files` | Get the indexed file structure (faster than a filesystem scan). |
| `specship_status` | Index statistics (files, nodes, edges, backend, journal mode, pending sync) **and** which SpecShip is answering: package version, install method, the install it was loaded from, Node.js version and bound project root. Works before any project is indexed. |
| `specship_health` | Code-health report: maintainability (coupling hotspots, oversized symbols, god files, cycles, dead-code candidates) and architecture-fitness violations, with `file:line`. Returns both by default; narrow with `checks: ["maintainability"]` or `["fitness"]`. See [Architecture & code health](/guides/code-health/). |

### Naming files and symbols in `specship_explore`

Naming something is the strongest relevance signal you can give explore:

- **Named files are always returned.** Up to four files you name (by path, a trailing path fragment like `mcp/server-instructions.ts`, or an unambiguous basename) come back ahead of everything else, and the rest of the answer fills the remaining space. If you name more than four, or a name doesn't match an indexed file, the answer says so instead of silently leaving it out. A basename that matches several files is treated as ambiguous — add a path segment.
- **Named symbols resolve by kind.** Functions, methods, classes, interfaces, type aliases, enums and constants all resolve by name, including hyphenated filenames.
- **For a flow, name both ends.** `"mutateElement renderScene"` returns the call path between them, including dynamic-dispatch hops.

### Which SpecShip is running?

`specship_status` answers "what version am I on?" in one call. It reports the version of the server actually answering — which isn't always the same as the `specship` on your `PATH`. That mismatch is the usual reason a session still behaves like an older release after an upgrade: restart Claude Code (or run `/mcp`) to pick up the new install. Clients that still call the retired `specship_version`, `specship_maintainability` or `specship_fitness` names get answers.

## Spec tools

| Tool | Purpose |
|---|---|
| `specship_spec` | The spec lookup. Its mode depends on the arguments (see below). |
| `specship_link_assert` | Declare that a code symbol `implements`, `tests`, `validates`, `documents` or `depends_on` a spec, after editing. The target is checked against the graph: a symbol that doesn't exist is refused with near-miss suggestions. The link is also written into the spec file's `implementations:` block, so it survives a full re-index. Idempotent. (Mutating — prompts for permission.) |
| `specship_link_verify` | Record a link's verification outcome: `pass` → `verified`, `fail` → `broken`. The `reason`, a timestamp and any `evidence` test names are stored on the link for later audit. (Mutating — prompts for permission.) |
| `specship_drifted` | Pull the drift queue (drifted / broken / orphaned links), filterable by `state`. |

### `specship_spec` modes

| Arguments | Returns |
|---|---|
| `spec_id: "REQ-AUTH-005"` | The spec body, its parent document and sibling requirements, linked code with link state, and any linked domain facts inline. |
| `query: "rate limit returns 500"` | Ranked candidate specs (id, title, kind, snippet) — use it to find which existing spec a described bug or change belongs to. |
| *(nothing)* | The lifecycle funnel: ideas → specs → implemented, with per-document rollups. |
| `list: true` | A flat inventory: every requirement with one rolled-up status (authored / in-progress / implemented / verified / needs-attention) plus totals. |
| `ideas: true` | The ideas review view: unlinked idea briefs with their age and labels, ending with the `/specship:spec new <brief-id>` hand-off. |
| `coverage: true` | The test-coverage rollup (per requirement and criterion: untested / tested / verified / broken), for one `spec_id` or the whole project. Only test links count. |
| `spec_id` + `behaviour_surface: true` | The requirement's behaviour surface for writing end-to-end tests: its linked code plus surrounding routes, components and handlers, split into a UI tier and a backend tier. |

If you combine modes, a non-empty `query` wins, then `list`, `ideas` and `coverage`, in that order. Otherwise `spec_id` decides between the detail view and the funnel.

## JIRA tools

Opt-in: enable with `specship install --with-jira`, then connect with `specship jira configure`. JIRA tools are never auto-allowed, so Claude Code asks before each call. See the [JIRA integration guide](/guides/jira/).

| Tool | Purpose |
|---|---|
| `specship_jira_issues` | List the issues assigned to you (resolved from your token). Optional `project`; `sprint: "active"` returns just your active-sprint board. |
| `specship_jira_issue` | Fetch one issue by key — summary, description, status, type, subtasks. |
| `specship_jira_pick` | Draft a SpecShip spec from an issue under `specs/`. Re-picking updates the spec in place. |
| `specship_jira_start` | Run the spec-implement workflow on the picked issue's spec; pauses at its plan/approve gate. |
| `specship_jira_track` | Read-only table of each picked issue's SpecShip work-state alongside its live JIRA status, plus published specs and issues edited in JIRA since publishing. |
| `specship_jira_publish` | Publish a requirement as a Story whose Sub-tasks mirror its acceptance criteria. Safe to re-run. |
| `specship_jira_transition` | Move an issue to a workflow state, or list the available transitions when no state is given. A state the workflow can't reach is reported, not applied. |
| `specship_jira_coverage` | Sprint coverage report joining sprint issues to spec truth. Read-only unless `post: true` with an anchor issue. |
| `specship_jira_reconcile` | Detect JIRA-side edits to published specs and propose the exact spec amendment; applies only a diff you've confirmed. |
| `specship_jira_anchor` | Resolve which issue current work is anchored to on a bound repo. Read-only. |
| `specship_jira_epics` | List a project's open epics (defaults to the repo's bound project). Read-only. |
| `specship_jira_add_task` | File a task you found mid-implementation under its story or epic (via taskship when installed). |
| `specship_jira_regression_pack` | Generate or refresh the regression pack: one case per acceptance criterion of every implemented requirement. `dry_run: true` previews. |
| `specship_jira_regression_record` | Record a regression case result (`passed` / `failed` / `unexecuted`) back onto the case and its source criterion. |

## Design tools

Opt-in and experimental: enable with `specship install --with-designer`. They drive [claude.ai/design](https://claude.ai/design) through a debug Chrome session and only launch Chrome when called. See [Design-to-code](/workflows/design-to-code/).

| Tool | Purpose |
|---|---|
| `designer_session` | Open or attach a Claude Design session. |
| `designer_prompt` | Send a design prompt and iterate on variants. |
| `designer_ask` | Ask a question about the current design. |
| `designer_list` | List the files/variants in the session. |
| `designer_snapshot` | Snapshot a design's source byte-for-byte to disk. |
| `designer_handoff` | Produce a handoff bundle for the implement workflow. |

## Which tools a session sees

The server adjusts the tool list it advertises. Hidden tools still answer if a client calls them by name.

- **Small projects** (under 500 indexed files) see a short list: `specship_explore`, `specship_search`, `specship_node` and `specship_status`. At that size the other code-graph tools come down to one grep. If the project has at least one indexed spec, the spec tools (`specship_spec`, `specship_link_assert`, `specship_link_verify`, `specship_drifted`) and any enabled JIRA tools stay listed too.
- **Sessions on a lightweight model** (Haiku, Gemini Flash) see only `specship_explore`, `specship_search` and `specship_node` from the code-graph group. Spec tools and enabled integrations are unaffected. These sessions also get shorter guidance and output that shows fewer files, each in full. Frontier and mid-tier models get the standard surface. `SPECSHIP_MODEL` forces a tier (`lite`, `standard`, `full`, or a model id), and `SPECSHIP_COMPACT=0` turns the optimization off. See [Low-end models](/claude-code/low-end-models/).
- **`SPECSHIP_MCP_TOOLS`** restricts the list to a comma-separated allowlist.

## How agents should use it

SpecShip *is* the pre-built search index. For "how does X work?", architecture, trace, or where-is-X questions, an agent should answer with a handful of SpecShip calls and stop — typically with **zero file reads** — rather than re-deriving the answer with `grep` + `Read`. A direct SpecShip answer is a handful of calls; a grep/read exploration is dozens.

This guidance reaches the agent through the MCP server itself: the server sends it as instructions when the session connects, and Claude Code adds it to the system prompt automatically. Nothing is written into your `CLAUDE.md` for it. A default install also adds a per-prompt nudge and a one-line reminder when the agent reaches for Grep/Glob in an indexed project. Both are advisory, and `SPECSHIP_NO_STEERING=1` turns them off.
