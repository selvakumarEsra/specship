---
title: MCP Server
description: The tools SpecShip exposes to AI agents over MCP.
---

SpecShip runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server. Start it with:

```bash
specship serve --mcp
```

Agents configured by the installer launch this automatically. When a `.specship/` index exists, the agent uses the tools below.

<!-- GENERATED:mcp-tools START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->
**Core (always available):** `specship_callees` · `specship_callers` · `specship_drifted` · `specship_explore` · `specship_files` · `specship_fitness` · `specship_impact` · `specship_link_assert` · `specship_link_verify` · `specship_maintainability` · `specship_node` · `specship_search` · `specship_spec` · `specship_status`

**JIRA integration (opt-in, `specship install --with-jira`):** `specship_jira_issue` · `specship_jira_issues` · `specship_jira_pick` · `specship_jira_publish` · `specship_jira_start` · `specship_jira_track` · `specship_jira_transition`

**Designer integration (opt-in + experimental, `--with-designer`):** `designer_ask` · `designer_handoff` · `designer_list` · `designer_prompt` · `designer_session` · `designer_snapshot`
<!-- GENERATED:mcp-tools END -->

## Code-graph tools

| Tool | Purpose |
|---|---|
| `specship_explore` | **Primary.** Return the verbatim source of the symbols relevant to a question — a plain question or a bag of symbol names both work — grouped by file, plus a relationship map and the call path among named symbols (following dynamic-dispatch hops like callbacks, React re-render, and interface→impl that grep can't). Also surfaces matching human-confirmed domain facts and a "Prior work" section (past sessions that edited these files) inline. Usually the only call an agent needs. |
| `specship_search` | Find symbols by name across the codebase (just locations). |
| `specship_node` | Get one symbol's full body + its caller/callee trail; returns every overload's body in one call for an ambiguous name. |
| `specship_callers` | Find what calls a function. |
| `specship_callees` | Find what a function calls. |
| `specship_impact` | Analyze what code is affected by changing a symbol. |
| `specship_files` | Get the indexed file structure (faster than a filesystem scan). |
| `specship_status` | Check index health and statistics. |

## Spec tools

| Tool | Purpose |
|---|---|
| `specship_spec` | Fetch a spec by ID with its currently linked code. |
| `specship_link_assert` | Declare an `implements` / `tests` / `documents` link after editing. (Mutating — prompts for permission.) |
| `specship_link_verify` | Mark a link's verification pass/fail. (Mutating — prompts for permission.) |
| `specship_drifted` | Pull the drift queue (drifted / broken / orphaned links). |

## JIRA tools

The issue-driving flow. Connect first with `specship jira configure`. See the [JIRA integration guide](/guides/jira/).

| Tool | Purpose |
|---|---|
| `specship_jira_issues` | List the issues assigned to you (resolved from your token) — key, summary, status, type. Optional project filter. |
| `specship_jira_issue` | Fetch one issue by key — summary, description, status, type. |
| `specship_jira_pick` | Draft a well-formed SpecShip spec from an issue under `specs/`. Idempotent — re-picking updates the spec in place. |
| `specship_jira_start` | Run the spec-implement workflow on the generated spec; pauses at its plan/approve gate. |
| `specship_jira_track` | Read-only table joining each picked issue's SpecShip work-state with its live JIRA status. |

## Design tools

Merged in from the standalone `designer` MCP, these drive [claude.ai/design](https://claude.ai/design) over a debug Chrome. macOS only; they only launch Chrome when invoked. See [Design-to-code](/workflows/design-to-code/).

| Tool | Purpose |
|---|---|
| `designer_session` | Open or attach a Claude Design session. |
| `designer_prompt` | Send a design prompt and iterate on variants. |
| `designer_ask` | Ask a question about the current design. |
| `designer_list` | List the files/variants in the session. |
| `designer_snapshot` | Snapshot a design's source byte-for-byte to disk. |
| `designer_handoff` | Produce a handoff bundle for the implement workflow. |

## How agents should use it

SpecShip *is* the pre-built search index. For "how does X work?", architecture, trace, or where-is-X questions, an agent should answer in a handful of SpecShip calls and stop — typically with **zero file reads** — rather than re-deriving the answer with `grep` + `Read`. A direct SpecShip answer is a handful of calls; a grep/read exploration is dozens.

The installer writes this guidance into each agent's instructions file automatically.
