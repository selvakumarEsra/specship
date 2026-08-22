# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
It is the **router**: cross-cutting rules live here; module specifics live in the nested CLAUDE.md files listed at the bottom.

## Project Overview

SpecShip is a local-first code intelligence library + CLI + MCP server. It parses any supported codebase with tree-sitter, stores symbols/edges/files in SQLite (FTS5), and exposes a knowledge graph to **Claude Code** over MCP. Per-project data lives in `.specship/`. Extraction is deterministic — derived from AST, not LLM-summarized.

**SpecShip is Claude Code only.** The installer and tests cover one agent — don't add other agent targets without an explicit ask.

Distributed as `@specship/specship` on npm; same binary serves as installer, indexer, and MCP server.

## Build, Test, Run

```bash
npm run build           # tsc + copy schema.sql and *.wasm into dist/; chmods dist/bin/specship.js
npm run dev             # tsc --watch
npm test                # vitest run (all)
npm run test:eval       # only __tests__/evaluation/
npm run eval            # build then run __tests__/evaluation/runner.ts via tsx
npm run cli             # build then run the local dist binary

# Single test file / pattern
npx vitest run __tests__/installer-targets.test.ts
npx vitest run __tests__/extraction.test.ts -t "TypeScript"
```

`copy-assets` (called from `build`) copies `src/db/schema.sql` and all `src/extraction/wasm/*.wasm` files into `dist/`. **Any new SQL or grammar wasm must be copied or it won't ship.**

Node engines: `>=18.0.0 <25.0.0`. There is a hard exit on Node 25.x (see `src/bin/node-version-check.ts`).

## Architecture

### Layered pipeline

```
files → ExtractionOrchestrator (tree-sitter) → DB (nodes/edges/files)
              ↓
       ReferenceResolver (imports, name-matching, framework patterns)
              ↓
       GraphQueryManager / GraphTraverser (callers, callees, impact)
              ↓
       ContextBuilder (markdown/JSON for AI consumption)
```

The public API surface is `src/index.ts` — the `SpecShip` class wires all the layers and re-exports types. Library users only touch this file; the MCP server and CLI also drive it.

### Where things live

- `src/index.ts` — `SpecShip` class: `init`/`open`/`close`, `indexAll`, `sync`, `searchNodes`, `getCallers`/`getCallees`, `getImpactRadius`, `buildContext`, `watch`/`unwatch`.
- `src/db/` — `DatabaseConnection`, `QueryBuilder`, `schema.sql`. `better-sqlite3` (native) with transparent `node-sqlite3-wasm` fallback; `specship status` surfaces which backend is live.
- `src/extraction/` — `ExtractionOrchestrator`, tree-sitter wrappers, per-language extractors under `languages/`, standalone extractors (svelte/vue/liquid/dfm), `parse-worker.ts`.
- `src/resolution/` — resolver + framework patterns + dynamic-dispatch synthesizers → see `src/resolution/CLAUDE.md`.
- `src/graph/` — `GraphTraverser` (BFS/DFS, impact radius, path finding) and `GraphQueryManager`.
- `src/context/`, `src/search/`, `src/sync/`, `src/ui/` — context building, FTS5 query parsing, file watching + git hooks, terminal UI.
- `src/mcp/` — the MCP server → see `src/mcp/CLAUDE.md`.
- `src/installer/` — `specship install` → see `src/installer/CLAUDE.md`.
- `src/claudemd/` — the CLAUDE.md governance audit (CLAUDEMD-DOC).
- `src/bin/specship.ts` — CLI (commander). Subcommands: `install`, `init`, `uninit`, `index`, `sync`, `status`, `query`, `files`, `context`, `affected`, `serve --mcp`.

### NodeKind / EdgeKind

Defined in `src/types.ts`. Both extractors and resolvers must use these exact strings.

- **NodeKind**: `file`, `module`, `class`, `struct`, `interface`, `trait`, `protocol`, `function`, `method`, `property`, `field`, `variable`, `constant`, `enum`, `enum_member`, `type_alias`, `namespace`, `parameter`, `import`, `export`, `route`, `component`.
- **EdgeKind**: `contains`, `calls`, `imports`, `exports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`.

## Retrieval performance (do not regress)

SpecShip's core value: an agent answers structural/flow questions with a few **fast** specship calls and **zero Read/Grep**. Optimization target is **wall-clock latency + tool-call count**, not token cost. The mechanism judging every change: **an agent falls back to Read/Grep the instant a specship answer is insufficient** — so the question is always whether the answer is sufficient enough to *stop* the agent from reading. Target: a flow question resolves in 1 specship call on small repos, scaling to 3–5 on large, with Read/Grep = 0.

The doctrine, budget invariants, and coverage rules live in the nested files (`src/mcp/CLAUDE.md`, `src/resolution/CLAUDE.md`); the measurement bar lives in `scripts/agent-eval/CLAUDE.md`. Full investigation record: `docs/benchmarks/call-sequence-analysis.md`.

## Tests

Tests live in `__tests__/` and mirror the module they cover — conventions, notable suites, Windows gating, and the Linux/Windows validation playbooks are in `__tests__/CLAUDE.md`.

## Releases

`CHANGELOG.md` is the source of truth; the GitHub Actions "Release" workflow builds and publishes everything. The full process and entry-formatting rules: `docs/releasing.md`. The non-negotiables:

- Write entries under `## [Unreleased]`; never pre-create a `## [X.Y.Z]` block (v0.9.5 incident).
- Entries are user-facing: plain sentences, grouped `### New Features` / `### Fixes`, no internal paths/symbols/benchmark figures.
- **Do not run `npm publish`, `git push`, or `git tag` yourself** — a plain `npm publish` ships a non-bundled package that breaks Node < 22.5. Write the files, hand the user the commands.
- **Claude does NOT bump the version unless explicitly asked**, and never proposes one while summarizing unrelated work.

## House rules

- This fork is **Claude Code only, with one ratified exception: Gemini CLI** (explicit user ask, 2026-08-22 — see `specs/agent-target-gemini.md`, `GEMINI-TARGET-DOC`). Phase 0 shipped a printable Gemini `mcpServers` snippet; Phase 1 (REQ-GEMINI-002/003) registered the `gemini` installer target — opt-in via `--target gemini`, never installed by default, and MCP-entry-only (no hooks, commands, subagent or status line; GEMINI.md steering and TOML commands are still unbuilt). Don't re-add Cursor / Codex / opencode / Hermes / Antigravity / Kiro / any other agent target without an equally explicit ask. The simpler installer surface is still the fork's point.
- When changing what the MCP tools do or how Claude Code should use them, edit `src/mcp/server-instructions.ts` — it is the **single source of truth** for agent-facing tool guidance (issue #529).
- SpecShip provides **code context**, not product requirements. For new features, ask the user about UX, edge cases, and acceptance criteria — the graph won't tell you.
- **When the user references issues, PR comments, or external reports, anchor them to a date and version before drawing conclusions.** Check the comment's `createdAt` against:
  - The **last released version** — `grep -m1 '^## \[' CHANGELOG.md` shows the top-of-file version (older releases follow). A comment dated before the latest `## [X.Y.Z] - YYYY-MM-DD` is reacting to *released* state — work that's only on `main` or on an unmerged branch doesn't apply.
  - The **last main commit** — `git log --first-parent main -1 --format='%ai %h %s'`. A comment after the last release but before a fix on main may already be addressed there but unreleased.
  - The **current branch's tip** — your own unmerged work obviously can't be what the comment is reacting to.
  Always disambiguate "released," "merged-but-unreleased," and "in-progress" before agreeing that a user-reported problem is unfixed (or that a fix is incomplete). A user saying "your fix only covers X" about a recent PR is usually pointing at the *released* shortcomings — your in-flight branch may already address them but they have no way to know that.
- **Version-tag every image referenced in `README.md`.** GitHub caches README images (`raw.githubusercontent.com` with a 5-minute TTL; third-party hosts sit behind the long-lived camo proxy), so updating an asset in place can keep showing the stale version. Give each README image URL a `?v=N` query tag and **bump `N` in the same commit whenever the asset bytes change** — e.g. `assets/waitlist.svg?v=2`. The changed URL sidesteps every cache so the new image shows immediately instead of waiting on a TTL to expire.

<!-- SPECSHIP_SDD_START -->
## Spec-driven development (SpecShip)

For feature or bug work in this repo, FIRST invoke SpecShip's **spec-author**
to author the spec under `specs/` — before any brainstorming or planning skill.
Spec-driven development is canonical here: the spec is the contract, and the
implementation follows from it (`/specship:spec implement`). This rule intentionally takes
precedence over a skill's own "use me first" guidance.

When the user shares a **claude.ai/design** link (or references a Claude Design
project), recommend **`/specship:spec design`** first and get explicit confirmation
before proceeding — even mid spec-author. That is the design→code path: taste
the design with the user → snapshot → spec → review → `/specship:spec implement`.
<!-- SPECSHIP_SDD_END -->

## Nested CLAUDE.md router

Module specifics load on demand when you work in these subtrees:

| Scope | File | Covers |
|---|---|---|
| MCP server | `src/mcp/CLAUDE.md` | explore budgets (monotonic invariants), server-instructions rule, adapt-the-tool doctrine, model tiers |
| Resolution | `src/resolution/CLAUDE.md` | dynamic-dispatch synthesis: close flows end-to-end, provenance, silent-beats-wrong |
| Installer | `src/installer/CLAUDE.md` | target layout, test + CHANGELOG requirements, marker handling |
| Tests | `__tests__/CLAUDE.md` | suite conventions, Windows gating, Linux (Docker) + Windows (Parallels) validation |
| Eval harness | `scripts/agent-eval/CLAUDE.md` | validation methodology, A/B pass bar, worked example |
