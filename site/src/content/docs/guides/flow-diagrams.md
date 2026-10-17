---
title: Flow Diagrams
description: Generate a Mermaid flowchart of your application's entry points and call chains with specship diagram, and keep it current automatically.
---

`specship diagram` draws your application's flow from the index: every entry point and the call chains it reaches, as a Mermaid flowchart in `docs/flow-diagram.md`. GitHub renders Mermaid natively, so the diagram is viewable in the repo with no extra tooling. Like the rest of the graph, it's built from the parsed code, never summarized by a model.

```bash
specship diagram
# ✔ Flow diagram created: docs/flow-diagram.md
#   42 entry points · 310 flow symbols · 512 calls
```

## What's in the diagram

- **Entry points**: every `route` (see [Framework Routes](/guides/framework-routes/)), plus every function or method that calls something but isn't called by anything in the index.
- **Flows**: from each entry point, the `calls` edges followed to a bounded depth (6 hops by default). A symbol that no entry point reaches is left out.
- **Grouping**: symbols are grouped into one subgraph per top-level directory (`src`, `server`, `packages`, …).
- **Large projects**: when the diagram would exceed its node budget (150 by default), whole directories collapse into summary nodes, largest first, so the chart stays readable.

Output is sorted (by module, then file, then symbol name), so the same code always produces the same file. A flow change shows up as a small, reviewable diff.

## Keeping it fresh

Once `docs/flow-diagram.md` exists, every `specship sync` and `specship index` refreshes it when code changed. Since the MCP server syncs as you edit, the diagram stays current during agent sessions too. A new flow appears, a removed flow disappears, and an unchanged diagram isn't rewritten at all.

To have the diagram generated automatically before the file exists, set `diagram.enabled`:

```json
{
  "diagram": {
    "enabled": true,
    "output": "docs/flow-diagram.md",
    "maxNodes": 150,
    "depth": 6
  }
}
```

A diagram problem never fails a sync or index.

## Options

| Flag | Config key | Default | Effect |
|---|---|---|---|
| `-o, --output <path>` | `diagram.output` | `docs/flow-diagram.md` | Where to write it (project-relative) |
| `--max-nodes <n>` | `diagram.maxNodes` | `150` | Node budget before directories collapse into summary nodes |
| `--depth <n>` | `diagram.depth` | `6` | Max call-chain depth from each entry point |
| `--json` | — | — | Print the result (status, output path, counts) as JSON |
| — | `diagram.enabled` | `false` | Refresh on sync even before the file exists |

Command-line flags override `specship.config.json`, which overrides the defaults. The file is marked as generated — don't edit it by hand, since the next sync overwrites it. To stop the refreshes, delete the file (and leave `diagram.enabled` unset).
