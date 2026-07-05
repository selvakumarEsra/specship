---
title: Memory
description: The full CLAUDE.md hierarchy (managed / user / project / subdir) plus @import resolution plus ~/.claude/memory/*.md agent-written notes. Sources view + Effective (merged-precedence) view.
---

Claude Code's "memory" — the persistent context the agent loads at the start of every session — comes from two distinct sources:

1. **`CLAUDE.md` files** at multiple levels (managed enterprise policy, user-global, project, subdirectory). The agent reads these directly as instructions/rules.
2. **`~/.claude/memory/*.md`** notes the agent has written itself via the memory tool, persisted as plain Markdown.

SpecShip's **Memory** page reads all of them, surfaces the hierarchy, and shows you the **merged effective memory** — i.e. exactly what the agent will see at the start of its next turn.

## The four instruction levels

| Level | Path | Precedence | Read-only? |
|---|---|---|---|
| **Managed** | `/Library/Application Support/ClaudeCode/CLAUDE.md` (mac) <br/> `/etc/ClaudeCode/CLAUDE.md` (linux) <br/> `%ProgramData%\ClaudeCode\CLAUDE.md` (win) | Highest — authoritative | Yes (managed by org policy) |
| **User** | `~/.claude/CLAUDE.md` | Applies to every project | No — edit freely |
| **Project** | `<project>/CLAUDE.md` | Team-shared; checked into git | No |
| **Subdirectory** | `<project>/<sub>/CLAUDE.md` (e.g. `src/graph/CLAUDE.md`) | Loaded when cwd is inside `<sub>/` | No |

Claude Code loads them in precedence order. Managed wins over project, project wins over user, etc. Lower levels fill in where higher levels are silent.

## `@import` resolution

Inside any `CLAUDE.md`, a line starting with `@` is treated as an import:

```markdown
# SpecShip — project memory

## Architecture
- Desktop SPA in `ui/`, served by the dashboard server in `server/`.
- MCP server in `src/mcp`, graph engine in `src/graph`.

@docs/conventions.md
@specs/STYLE.md
```

SpecShip resolves these paths against the project root (or absolutely, if absolute), parses the imported file as additional instructions, and lists them under the project file in the Sources view.

The agent sees the imported content inline — but from your perspective the import is a clean separation: keep one-time architectural notes in `CLAUDE.md`, conventions and style guides in their own files.

## Notes (memory-tool entries)

Claude Code's **memory tool** writes Markdown files to `~/.claude/memory/`. These are facts the agent has decided to remember across sessions — "the package manager is npm, never pnpm", "checkExpiry tolerates 30s clock skew", that kind of thing.

SpecShip parses every `.md` file in `~/.claude/memory/`, extracts `#hashtags`, and notes the session that saved each one (Claude Code's memory tool stamps the session id in the file body).

## The Sources view

Default view. Left rail shows the four levels as groups; click any row to see the file detail in the right pane.

Each detail panel shows:

- **Type pill** — Instructions / Notes / Imports
- **Level pill** — Managed / User / Project / Directory / Notes
- **Path** — absolute filesystem path (with copy button)
- **Stats** — tokens, lines, scope, modified time, session id (for notes)
- **Tags** — `#auth #REQ-AUTH-005` style tags for notes
- **Rendered body** — Markdown rendered inline
- **Imports** — for project/subdir files, the resolved `@import` paths each as a clickable row
- **Actions** — Edit (opens in your editor), Copy contents, Forget (notes only)

A type filter chip strip at the top (All / Instructions / Notes / Imports) narrows the view.

## The Effective view

The other view. Shows the **merged memory** the agent will actually load — every instruction file concatenated in precedence order, then every note appended.

Each block carries:

- A **precedence number** (1, 2, 3, …) showing where it falls in the merge order.
- A **level pill** matching its source.
- The **source path** (mono).
- The **rendered body**.

Managed policy blocks have a lock icon — they're authoritative and override later blocks for the same topic.

A separator splits the Instructions section (precedence-ranked) from the Notes section (retrieved facts, not precedence-ranked — they're appended whole).

## Why this matters

The agent's behaviour is partly the model and partly its memory. When the agent does something weird — keeps reaching for `pnpm` instead of `npm`, keeps repeating a mistake you thought you'd corrected last week — the answer is usually in here:

- A note the agent wrote based on a transient session.
- A `CLAUDE.md` directive you forgot you added.
- An import that's gone stale.

The Memory page is the **debugging UI for the agent's persistent state**.

## CLI

```bash
specship memory                            # show effective memory (default)
specship memory --sources                  # show by source level
specship memory --notes                    # show only notes
specship memory --json                     # machine-readable
specship memory edit ~/.claude/CLAUDE.md   # opens in your editor
specship memory forget <note-id>           # delete a note
```

## Editing safely

When you edit a `CLAUDE.md`, the change takes effect on the **next Claude Code session start** — Claude Code reads memory once at session boot. Run `specship memory --effective` after an edit to verify the new merged content is what you want.

For notes (`~/.claude/memory/*.md`), Claude Code re-reads on every turn — so changes apply immediately.

→ Next: [Heatmap](/claude-code/heatmap/) — the file/tool/subagent drill-down.
