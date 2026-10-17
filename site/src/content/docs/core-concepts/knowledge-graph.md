---
title: The Knowledge Graph
description: The node and edge kinds the graph is built from.
---

SpecShip stores three things: **nodes** (symbols and files), **edges** (relationships between them), and **files**. Every node and edge carries an exact `kind`, drawn from a fixed vocabulary so queries are consistent across languages.

## Node kinds

`file`, `module`, `class`, `struct`, `interface`, `trait`, `protocol`, `function`, `method`, `property`, `field`, `variable`, `constant`, `enum`, `enum_member`, `type_alias`, `namespace`, `parameter`, `import`, `export`, `route`, `component`, `spec`.

A `spec` node is a lightweight stand-in for a requirement from your `specs/` folder (the full text lives in a separate spec table). Because requirements live in the same graph as code, a query can cross from a requirement to the code that implements it.

## Edge kinds

`contains`, `calls`, `imports`, `exports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`, `documents`, `validates`.

`implements` covers both a class implementing an interface and code implementing a spec. `documents` and `validates` connect specs and tests to the code they describe or check. See [Spec links & drift](/specs/links-and-drift/).

## Provenance

Most edges come straight from the AST. A few — at dynamic-dispatch boundaries that static parsing can't follow — are **synthesized** and marked with `provenance: 'heuristic'` plus the wiring site that created them. These are shown inline in `specship_explore` call paths and the `specship_node` caller/callee trail, so an agent can see exactly where a connection came from.

## Querying it

- **Explore** returns the source of the symbols relevant to a question, plus the call path among the symbols you name — usually the only query needed.
- **Search** symbols by name (FTS5).
- **Callers / callees** walk the call graph one hop at a time.
- **Impact** computes the transitive radius affected by a change.

See the [CLI](/reference/cli/) and [MCP Server](/reference/mcp-server/) references for how to run these, or the [Library API](/reference/api/) to query the graph from code.
