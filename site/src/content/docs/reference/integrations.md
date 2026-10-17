---
title: MCP & Claude Code wiring
description: How SpecShip wires itself into Claude Code — the MCP server registration, permissions, hooks, slash commands, the opt-in Gemini CLI target, and the manual wire-up if you prefer to do it yourself.
---

SpecShip is built for Claude Code. The `specship install` command does the wiring for you; this page exists for two cases:

1. **You want to know what it does**, before you let it edit your config files.
2. **You want to wire it up by hand** — the install command refuses, or you're scripting around it.

`specship install` only does wiring. Getting the `specship` program itself is a separate first step (`npm i -g @specship/specship` or the offline bundle installer). See [Installation](/getting-started/installation/).

## What `specship install` writes

An interactive install asks one question — where to install. Everything below is on by default and named in the install summary along with its opt-out flag.

### 1. The MCP server entry

A no-flag install is **project-local** — it writes to `./.mcp.json`. Pass `--location global` to write to `~/.claude.json` instead, so the server runs for every project:

```json
{
  "mcpServers": {
    "specship": {
      "type": "stdio",
      "command": "specship",
      "args": ["serve", "--mcp"]
    }
  }
}
```

This tells Claude Code to spawn `specship serve --mcp` as a stdio MCP server when it starts. By default the server exposes only the **local-only core** — the code-graph tools, the spec tools, and the code-health tool. The two integrations that talk to an external service are strictly opt-in: `specship install --with-jira` (Atlassian) and `--with-designer` (claude.ai — experimental) add `"env": { "SPECSHIP_INTEGRATIONS": "..." }` to this entry, which turns their tool groups on. A later plain re-install keeps an earlier opt-in. See the [MCP server reference](/reference/mcp-server/) for the generated, always-current tool list.

The guidance on *how* to use the tools ships inside the MCP server itself — Claude Code adds it to the system prompt when the session connects — so nothing is written into your `CLAUDE.md` for it.

### 2. The auto-allow permissions list

Into `./.claude/settings.json` (project-local) or `~/.claude/settings.json` (global):

```json
{
  "permissions": {
    "allow": [
      "mcp__specship__specship_explore",
      "mcp__specship__specship_search",
      "mcp__specship__specship_node",
      "mcp__specship__specship_callers",
      "mcp__specship__specship_callees",
      "mcp__specship__specship_impact",
      "mcp__specship__specship_files",
      "mcp__specship__specship_status",
      "mcp__specship__specship_health"
    ]
  }
}
```

This means Claude Code won't prompt you on every read-only query. If you enabled `--with-designer`, the six `designer_*` tools are added too, because the design loop is driven by you. Some tools are deliberately **not** auto-allowed, so you get a permission prompt before they run:

- the mutating spec tools (`specship_link_assert`, `specship_link_verify`)
- `specship_spec` and `specship_drifted`
- every JIRA tool, because each call reaches your Atlassian instance

Skip the whole list with `--no-permissions`.

### 3. Hooks

| Hook | Runs | Purpose |
|---|---|---|
| `PostToolUse` on `Edit\|Write\|MultiEdit` | `specship sync --quiet` (async) | Keep the index in step with the agent's own edits |
| `SessionStart` on `startup\|resume` | `specship sync --quiet --drift-summary` | Catch up on changes, and print a one-line drifted-link count when there is one |
| `SessionStart` on `startup` | `specship cheatsheet` | A one-screen command cheat-sheet (silence with `SPECSHIP_NO_CHEATSHEET=1`) |
| `UserPromptSubmit` | `specship steer-nudge` | A per-prompt reminder to answer code questions from the index first |
| `PreToolUse` on `Grep\|Glob` | `specship search-intercept` | At most one advisory line per session pointing a raw search at SpecShip — never blocks the search |
| `UserPromptSubmit` (spec-driven tier) | `specship spec-nudge` | On feature/bug-shaped prompts, a reminder to author the spec first |

The two sync hooks run commands without prompting, so they follow the same switch as the permissions list: `--no-permissions` skips them. The steering hooks are silent in projects without an index, and `SPECSHIP_NO_STEERING=1` turns them off.

### 4. The status line

The SpecShip status-line segment (index state, session calls, context usage and a rotating usage tip) is added to your settings. It never replaces a status line you already have. Skip it with `--skip-statusline`.

### 5. Slash commands, subagent and skill

The slash commands are a small set of **doors**: you pick a sub-action inside a door instead of running a separate command for each. A plain install ships both tiers. `--no-sdd` gives a retrieval-only install with just `/specship:explore`.

| Door | Tier | What it covers |
|---|---|---|
| `/specship:explore <symbols \| flow \| "impact of X">` | retrieval | Explore an area, trace a flow, or get a change's blast radius. |
| `/specship:spec [<ID> \| idea \| ideas \| list \| new \| fast \| design \| implement \| review \| triage \| behaviour \| domain]` | spec-driven | The intent loop. No argument shows the funnel, and an `<ID>` shows that spec. `idea`/`ideas` capture and review ideas, and `list` shows the inventory. `new`/`fast` author a spec (with or without the interview), and `design` runs the Claude Design → spec path. `implement`/`review` build and review it, `triage` routes a change to an existing spec, `behaviour` generates end-to-end tests, and `domain` captures a domain fact. |
| `/specship:check [drifted \| fix <ID> \| relink <ID> \| health \| claudemd]` | spec-driven | The gate and health door. No argument runs the enforcement gate, and `drifted` shows the review queue. `fix`/`relink` repair links, `health` shows the code-health report, and `claudemd` reviews the CLAUDE.md audit findings. |
| `/specship:learn` | spec-driven | Save what just worked in this session as a skill, style-convention or domain-fact proposal. Nothing is written until you apply it. |
| `/specship:day` | spec-driven | Your active-sprint JIRA board → pick → start (needs `--with-jira`). |

The spec-driven tier also adds a short "author the spec first" rule to the project's `CLAUDE.md` and installs the **spec-author** skill (authoring checklist, quality rubric, gap questions, review checklist). The `specship-explorer` subagent ships with every install.

See [Design-to-code](/workflows/design-to-code/) for the `design` route.

### 6. The initial index

Finally, install indexes the current project (skip with `--skip-index`), runs a quick advisory health check, and reminds you to restart Claude Code (or run `/mcp`). A server added to the config isn't visible in a session that was already open. Run `specship doctor` at any time for the same check.

## Manual wiring

If you don't want to run `specship install`:

```bash
npm i -g @specship/specship
specship install --print-config                    # print the MCP entry; writes nothing
```

Then add the `mcpServers.specship` entry and the `permissions.allow` block above to your Claude Code config files by hand.

If you do want the slash commands, hooks and status line, the easiest path is still `specship install` — it detects the existing MCP entry and only adds the missing pieces.

## Per-project vs global

`specship install` writes to the current project's `./.mcp.json` and `./.claude/settings.json` **by default**, so the MCP server only runs for that project. This keeps SpecShip's tools out of Claude Code sessions on projects that haven't opted in. Pass `--location global` to write to your global Claude Code config (`~/.claude.json` + `~/.claude/settings.json`) instead, or `--path <repo>` to wire and index a different repository:

```bash
specship install --location global
specship install --path ~/code/my-repo
```

## Uninstall

```bash
specship uninstall               # remove everything (asks first)
specship uninstall --keep-data   # only unwire from Claude Code
```

A plain `uninstall` removes SpecShip completely. That means the MCP entry, permissions, hooks, status line, slash commands and steering rule, plus the current project's `.specship/` index, the `~/.specship` directory (including saved JIRA credentials), and the `specship` program itself. It shows what it will delete and asks first; `--yes` skips the prompt. Indexes in other projects aren't found automatically, and the command says so. With `--keep-data`, only the wiring is removed; pass `--location global` to remove a global install's wiring.

## Gemini CLI (opt-in)

SpecShip is Claude Code only, with one exception: Gemini CLI. It's never wired by default.

```bash
specship install --target gemini                  # Gemini CLI only
specship install --target claude,gemini           # both agents
specship install --print-config --target gemini   # just print the snippet
```

This writes the `specship` entry into Gemini CLI's `mcpServers` — `~/.gemini/settings.json` globally, or `<project>/.gemini/settings.json` with `--location local`. Any other servers and settings in that file are left alone, and re-running changes nothing. Gemini CLI gets the **MCP tools only**: no hooks, slash commands, subagent, status line or permissions auto-allow, because Gemini CLI has no equivalent for those. The install prints a note listing exactly what's missing.

SpecShip reads the model from `GEMINI_MODEL` or `model` in `.gemini/settings.json` (read-only), so a Gemini Flash session gets the compact output meant for lightweight models. To remove just the Gemini entry, run `specship uninstall --target gemini --keep-data`. See the [Gemini CLI guide](/guides/gemini-cli/) for the full walkthrough.

## Other agents

The installer and tests cover Claude Code (plus the opt-in Gemini CLI target) on purpose — a smaller surface is easier to keep correct. If you need SpecShip in another agent that speaks MCP, point that agent's MCP config at `specship serve --mcp` yourself. The protocol is standard and the server will work, but the install flow won't do the wiring for you.
