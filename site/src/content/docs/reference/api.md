---
title: API
description: Use SpecShip as a TypeScript library — the SpecShip class, its graph queries, and the spec, health and diagram APIs.
---

SpecShip ships a TypeScript API from the same `@specship/specship` package as the CLI. The public surface is the `SpecShip` class (the default export). The package also re-exports the graph types (`Node`, `Edge`, `NodeKind`, `EdgeKind`, …) from its entry point.

```typescript
import SpecShip from '@specship/specship';

const cg = await SpecShip.init('/path/to/project');
// Or open an existing index (optionally syncing first):
// const cg = await SpecShip.open('/path/to/project', { sync: true });

await cg.indexAll({
  onProgress: (p) => console.log(`${p.phase}: ${p.current}/${p.total}`),
});

const results = cg.searchNodes('UserService');
const callers = cg.getCallers(results[0].node.id);
const context = await cg.buildContext('fix login bug', {
  maxNodes: 20,
  includeCode: true,
  format: 'markdown',
});
const impact = cg.getImpactRadius(results[0].node.id, 2);

cg.watch();   // auto-sync on file changes
cg.unwatch(); // stop watching
cg.close();
```

`SpecShip.init()` creates `.specship/` but doesn't index unless you pass `{ index: true }` (or call `indexAll()` yourself, as above). It throws if the project is already initialized; `SpecShip.open()` throws if it isn't. Use `SpecShip.isInitialized(path)` to choose between them.

## Lifecycle and indexing

| Method | Purpose |
|---|---|
| `SpecShip.init(path, { index?, onProgress? })` | Create a project index (`initSync` skips indexing) |
| `SpecShip.open(path, { sync? })` | Open an existing index (`openSync` skips the sync) |
| `SpecShip.isInitialized(path)` | Whether `.specship/` exists for a path |
| `indexAll(opts)` | Full index, with a progress callback |
| `indexFiles(paths)` | Index specific files |
| `sync()` | Incremental update. Also re-indexes changed spec files and refreshes the flow diagram if one exists |
| `getChangedFiles()` | Files added / modified / removed since the last index |
| `watch(opts)` / `unwatch()` / `isWatching()` | Start / stop / check the native file watcher |
| `getPendingFiles()` | Files edited but not yet synced |
| `getStats()` | File / node / edge counts, per-kind and per-language breakdowns, DB size |
| `getBackend()` / `getJournalMode()` | Active SQLite backend and journal mode |
| `close()` | Close the database connection (`destroy()` is a deprecated alias) |
| `uninitialize()` | Close and delete the project's `.specship/` directory |

## Graph queries

| Method | Purpose |
|---|---|
| `searchNodes(query, opts)` | Full-text symbol search; returns `{ node, score }` results |
| `getNode(id)` / `getNodesByName(name)` / `getNodesByKind(kind)` / `getNodesInFile(path)` | Direct node lookups |
| `getCallers(id, depth?)` / `getCallees(id, depth?)` | Walk the call graph (depth defaults to 1) |
| `getImpactRadius(id, depth?)` | Transitive impact of a change (depth defaults to 3) |
| `findPath(fromId, toId, edgeKinds?)` | Shortest path between two nodes, or `null` |
| `getCallGraph(id, depth?)` / `getTypeHierarchy(id)` / `traverse(id, opts)` | Subgraph traversals |
| `findUsages(id)` / `getAncestors(id)` / `getChildren(id)` | References and containment |
| `getFileDependencies(path)` / `getFileDependents(path)` | File-level import graph |
| `findCircularDependencies()` / `findDeadCode(kinds?)` | Whole-graph analyses |
| `getCode(id)` | A node's source text |
| `buildContext(task, opts)` | Markdown or JSON context for an AI task (`maxNodes`, `includeCode`, `format`, …) |
| `findRelevantContext(query, opts)` | The subgraph `buildContext` is built from |

## Specs, health and diagrams

| Method | Purpose |
|---|---|
| `getSpecFunnel()` | The idea → spec → implemented funnel |
| `getSpecCoverage(specId?)` | Test-coverage rollup per requirement and acceptance criterion |
| `verifyFromReport(reportPath, { runId? })` | Promote / demote test links from a vitest JSON report |
| `getBehaviourSurface(specId)` | A requirement's linked code plus surrounding routes/components, split UI vs backend |
| `getDomainGapSeed()` | Code entities and specs not yet covered by a domain fact |
| `getEnforce(config?, scope?)` | Run the enforcement gate (drift, fitness, maintainability, behaviour, suppressions, mutation) |
| `getMaintainability(thresholds?)` | Maintainability report (coupling, size, cycles, dead code) |
| `getFitness(rules?)` | Evaluate architecture-fitness rules |
| `generateFlowDiagram(opts?)` | Write the Mermaid flow diagram (`output`, `maxNodes`, `depth`) |
| `getSpecQueries()` | Lower-level spec and spec-link queries |

The reflection (self-improvement) proposals are available too: `reflectAnalyze()`, `reflectCapture({ title, content, lane })`, `reflectList()`, `reflectPreview(hash)`, `reflectApply(hash)`, `reflectUndo(hash)` and `reflectDismiss(hash)`. Applying is the only step that writes, and it can be undone.

All of these read the same index the CLI and MCP server use — a library call and `specship <command>` see the same graph.
