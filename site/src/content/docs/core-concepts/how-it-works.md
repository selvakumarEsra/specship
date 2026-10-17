---
title: How It Works
description: The extraction, storage, resolution, and auto-sync pipeline.
---

SpecShip turns source code into a queryable graph in four stages.

```
files → Extraction (tree-sitter) → DB (nodes/edges/files)
            ↓
      Resolution (imports, name-matching, framework patterns)
            ↓
      Graph queries (callers, callees, impact)
            ↓
      Context building (markdown / JSON for AI consumption)
```

Everything is derived deterministically from the syntax tree — nothing is summarized by a model — and everything stays on your machine.

## 1. Extraction

[tree-sitter](https://tree-sitter.github.io/) parses source into ASTs. Language-specific queries extract **nodes** (functions, classes, methods, types…) and **edges** (calls, imports, extends, implements). A few formats get their own extractors: Svelte, Vue, Liquid, Delphi forms, and MyBatis mapper XML. Heavy parsing runs off the main thread. See [Languages](/reference/languages/).

## 2. Storage

Everything goes into a local SQLite database (`.specship/specship.db`) with FTS5 full-text search. SpecShip uses Node.js's built-in `node:sqlite` module, or `better-sqlite3` when it's installed. `specship status` shows which backend is live and whether WAL journaling is active, and `specship doctor` checks FTS5 support.

## 3. Resolution

After extraction, references are resolved: function calls → definitions, imports → source files, class inheritance, and framework-specific patterns such as routes. Some dynamic-dispatch boundaries — callbacks, observers, React re-render, interface → implementation — are bridged by synthesizers so flows connect end-to-end. Spec files under `specs/` are indexed in the same pass, so requirements link to the code that implements and tests them. See [Resolution & Frameworks](/core-concepts/resolution/).

## 4. Auto-sync

The MCP server watches your project using native OS file events (FSEvents / inotify / ReadDirectoryChangesW). Changes are debounced, filtered to source files, and incrementally synced, so the graph stays fresh as you code with no configuration. Each sync also re-checks changed spec files for drift and refreshes your [flow diagram](/guides/flow-diagrams/) if you have one. See [Indexing a project](/guides/indexing/) for the details, including how SpecShip flags a file that changed after the last sync.
