---
slug: agent-adapter-layer
created: 2026-10-26
label: agnostic
---
# Move host-specific code behind one agent-adapter layer

Move the remaining Claude-specific strings in shared code behind one agent-adapter layer — hook I/O (event names, output schema), MCP tool-name prefixes (`mcp__specship__` vs `specship__`), transcript parsing, and config paths — and add a lint/test that fails when a host-specific string appears outside the adapters. Enforces the CLAUDE.md "shared code is agent-agnostic" house rule. Start after REQ-GEMINI-010/011 land (they touch the same hook code).

Audit snapshot (2026-10-26, `src/` excluding `src/installer/targets/claude.ts`): `mcp__specship__` in 6 files; Claude hook event names in 6 (activation, bin, workflows/schemas, db, analytics, installer); `.claude/` paths in 13; `~/.claude` / `claude.json` in 10. Some may be legitimately Claude-only (dashboard analytics ingest stays Claude-only per the 2026-09 pivot) — the spec must say which.

## Grounding
- src/activation/search-intercept.ts:transcriptUsedSpecship
- src/activation/search-intercept.ts:SEARCH_INTERCEPT_TEXT
- src/bin/specship.ts
- src/installer/targets/gemini.ts:GeminiCliTarget
