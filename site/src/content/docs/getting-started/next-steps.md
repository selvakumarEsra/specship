---
title: Next Steps
description: Where to go once SpecShip is installed and indexing.
---

You've got SpecShip installed and a graph built. Here's where to go next.

## Understand the model

- [How It Works](/core-concepts/how-it-works/) — the extraction → storage → resolution → sync pipeline.
- [The Knowledge Graph](/core-concepts/knowledge-graph/) — the node and edge kinds the graph is built from.
- [Resolution & Frameworks](/core-concepts/resolution/) — how references and framework routes get connected.

## Put it to work

- [Indexing a Project](/guides/indexing/) — full index, incremental sync, and the file watcher.
- [Framework Routes](/guides/framework-routes/) — link URL patterns to their handlers.
- [Affected Tests in CI](/guides/affected-tests/) — run only the tests a change touches.
- [Writing Specs](/specs/writing-specs/) — requirements, acceptance criteria, and their `implementations:` / `verifies:` links.
- [Links & Drift](/specs/links-and-drift/) — how link state is verified with test evidence and flagged when code drifts.
- [JIRA](/guides/jira/) — the opt-in JIRA integration (publish specs, sprint coverage, regression packs).

## Tune and troubleshoot

- [Configuration](/getting-started/configuration/) — `specship.config.json` (gates, diagram, auto-learn, JIRA binding) and the environment switches.
- [Troubleshooting](/troubleshooting/) — `specship doctor`, Node and FTS5 problems, and other common fixes.

## Reference

- [MCP Server](/reference/mcp-server/) — the tools agents call.
- [CLI](/reference/cli/) — every command and flag.
- [API](/reference/api/) — use SpecShip as a TypeScript library.
- [Integrations](/reference/integrations/) — Claude Code wiring, the opt-in Gemini CLI target, and manual setup.
