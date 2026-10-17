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
- **Level pill** — Managed / User / Project / Directory / Notes, plus a **read-only** marker on managed policy files
- **Path** — absolute filesystem path (with copy button)
- **Stats** — tokens, lines, scope, modified time
- **Session** — for notes, the session that saved it (click through to that session)
- **Tags** — `#auth #REQ-AUTH-005` style tags for notes
- **Rendered body** — Markdown rendered inline
- **Imports** — for project/subdir files, the resolved `@import` files
- **Copy contents** — copies the file body

A type filter chip strip at the top (All / Instructions / Notes / Imports) narrows the view.

## The Effective view

The other view. Shows the **merged memory** the agent will actually load — every instruction file composed in load order, then every note appended.

Instructions compose in **load order** — later files layer onto earlier ones, and `@import`s load with the file that references them. **Copy all** copies the composed result. Each block carries:

- A **position number** (1, 2, 3, …) showing where it falls in the load order.
- A **level pill** matching its source.
- The **source path** (mono).
- The **rendered body**.

Managed policy blocks have a lock icon — they're authoritative and override later blocks for the same topic.

A separator splits the Instructions section from the Notes section (retrieved facts, not precedence-ranked — they're appended whole).

The page reads from disk on load; **Reload** re-reads it after you edit a file. With no memory files at all, it says so instead of showing an empty layout.

## Why this matters

The agent's behaviour is partly the model and partly its memory. When the agent does something weird — keeps reaching for `pnpm` instead of `npm`, keeps repeating a mistake you thought you'd corrected last week — the answer is usually in here:

- A note the agent wrote based on a transient session.
- A `CLAUDE.md` directive you forgot you added.
- An import that's gone stale.

The Memory page is the **debugging UI for the agent's persistent state**.

## CLI

The dashboard page is read-only. On the command line, `specship memory` manages the **memory rules SpecShip writes for you** — lessons you capture so a mistake isn't repeated. Each is a human-gated [reflection](/claude-code/improvements/) proposal, written either as a portable `~/.claude` memory note or as a marked block in your project `CLAUDE.md`:

```bash
# capture a lesson (the mistake + the rule to avoid it) on stdin
specship memory capture --title "Run migrations before seeding" <<'LESSON'
Seeding before migrations failed twice. Always run the migration step first.
LESSON

specship memory capture --target claude-md --title "…"   # target the project CLAUDE.md instead

specship memory list                 # memory rules SpecShip has applied
specship memory edit <id> --yes      # replace a rule's body (new body on stdin)
specship memory remove <id> --yes    # take a rule down
```

`capture` only stages a proposal — nothing is written until it's applied. `edit` and `remove` show a before/after preview and change nothing until you pass `--yes`. These commands only touch rules SpecShip wrote; your own `CLAUDE.md` content and notes are never edited.

## Editing safely

When you edit a `CLAUDE.md`, the change takes effect on the **next Claude Code session start** — Claude Code reads memory once at session boot. Reload the Memory page's **Effective** view after an edit to check the composed result is what you want.

→ Next: [Heatmap](/claude-code/heatmap/) — the file/tool/subagent drill-down.
