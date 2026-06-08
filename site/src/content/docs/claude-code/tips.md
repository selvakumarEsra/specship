---
title: Tips engine
description: Rule-based suggestions that match patterns in your Claude Code transcripts and surface concrete, copyable fixes. Reads like a senior teammate looking over your sessions.
---

The **Tips** page is a rule-based pattern-matcher over the data the ingest watcher writes. Each rule looks for a specific anti-pattern; when it fires, a tip card surfaces with **evidence** (the actual rows that triggered it) and a **concrete fix** (often a copyable command).

The voice is intentional — it reads like a senior teammate who reviewed your transcripts, not a generic warning system:

> _You read `auth.ts` 17 times last session. Same answer via `specship_explore` in 1 call._
>
> _Bash(grep) returned 82k tokens. `specship_search` covers this in 600._
>
> _Cache miss rate on your evening sessions is 91%. Could be your system prompt drifts each turn. Worth pinning a stable prefix._

## What's on a tip card

| | |
|---|---|
| **Severity** | A left-edge colored bar — error (red) / warn (amber) / info (blue). Errors first. |
| **Title** | One sentence, action-oriented. |
| **Why this matters** | One short paragraph. The engineering reasoning, not the symptom. |
| **Evidence** | Concrete rows from the user's transcripts — a session ID, a file path, a specific prompt — so the tip is verifiable. |
| **Fix** | The concrete next step (a copyable command, a config line, a workflow to run). |
| **Saving** | An estimated impact — "saves ~$3/week", "drops tool calls by 60%". |
| **Apply / Dismiss** | Apply jumps to the related surface (e.g. Sessions → the implicated session). Dismiss snoozes. |

## The bundled rules

SpecShip ships with a curated rule set. The most-actionable ones:

### Read-heavy file pattern

Fires when one file is read by `Read` more than 5 times in a single session.

**Why**: Re-reading the same file means the agent forgot what was in it. A structural query (`specship_explore`) returns the relevant subset and keeps it in the prompt for the rest of the session, eliminating the re-reads.

**Fix**: A suggested `specship_explore` query targeting the file's main symbols.

### Bash(grep) token bloat

Fires when a `Bash` call with `grep` in its command returns ≥ 20k tokens.

**Why**: `grep`'s output is verbose — every match line, no structure. `specship_search` returns the same matches as a structured list with file:line and ~99% fewer tokens.

**Fix**: The equivalent `specship_search` query.

### Cache miss streak

Fires when more than 5 consecutive prompts in a session have cache hit rate < 10%.

**Why**: The system prompt prefix is drifting between turns — usually because the agent is appending new context each turn instead of pinning a stable header.

**Fix**: A diff for the project's `CLAUDE.md` suggesting a stable architecture/conventions header to pin.

### Subagent over-spend

Fires when sidechain prompts account for ≥ 50% of session cost.

**Why**: The agent is delegating too aggressively — usually because the top-level prompt is too broad ("understand this codebase and propose a refactor") and fans out into expensive subagents instead of doing focused work.

**Fix**: A suggested decomposition — split the top-level prompt into 2-3 focused turns.

### Expensive prompt outlier

Fires when one prompt's cost is ≥ 5× the session median.

**Why**: Single expensive prompts are usually a "do everything" prompt that spawned a giant subagent tree, or a prompt that read 10+ files into context.

**Fix**: A link to the session's prompt timeline scrolled to the outlier, so you can rewrite the prompt.

### Drifted spec link

Fires when the drift queue has > 0 `drifted` links in the active project.

**Why**: A drifted spec link means either the requirement changed or the code did — and the link's hash mismatch means the snapshot is stale.

**Fix**: A button to kick off the `spec-fix` workflow on the most stale of them.

### Stale graph

Fires when the project's last-indexed time is more than 24 hours ago **and** there have been file-watcher-triggered edits since.

**Why**: The agent will answer queries against a stale graph, which can be silently wrong.

**Fix**: `specship sync` (one command). The desktop UI has a "Sync now" button in the header.

### Test-touch absent

Fires when a session ran for > 30 minutes, had > 10 prompts, and didn't invoke any `Bash` call running tests.

**Why**: Long agent sessions without test runs are usually agent sessions producing untested code. Validate before shipping.

**Fix**: A reminder to run `specship workflow run spec-verify --background` after the session.

## Apply / Dismiss

**Apply** routes to the most-relevant surface — Sessions for prompt-level tips, Drift queue for spec drift, the file detail rail in Heatmap for read-heavy files. The tip stays in the list until you dismiss it.

**Dismiss** can be permanent ("forever") or snoozed (1 day / 1 week). Snooze persistence is local to your `~/.specship/` config.

## Tip ordering

Tips are sorted by severity (error > warn > info) and within severity by **recency of triggering evidence**. The list updates every 30 seconds while the desktop UI is open.

## Writing custom rules

The tip engine reads rule definitions from `~/.specship/tips/*.yaml` and `<project>/.specship/tips/*.yaml`. Each rule is:

```yaml
id: my-tip
severity: warn
title: "{{tool_count}} {{tool_name}} calls touched the same file"
why: |
  Repeated tool calls on one file is a signal that a structural query
  would replace them with a single call.
fix:
  type: command
  text: "specship_explore {{symbols_in(file_path)}}"
trigger:
  query: |
    SELECT file_path, tool_name, COUNT(*) as tool_count
    FROM claude_tool_calls tc
    JOIN claude_prompts p ON tc.prompt_id = p.id
    WHERE tc.tool_name IN ('Read', 'Grep')
      AND p.session_id = :session_id
    GROUP BY file_path, tool_name
    HAVING tool_count > 5
```

The SQL hits the same SQLite the analytics surfaces read. Triggered rows become the tip's `evidence`. The `{{...}}` placeholders are substituted from the row.

Custom rules are loaded at startup. Hot-reload them with `specship tips reload` in the CLI.

## CLI

```bash
specship tips                    # list active tips
specship tips --severity error   # filter
specship tips dismiss <tip-id>
specship tips snooze <tip-id> --duration 1w
specship tips reload             # re-read rule files
```

→ Back to the desktop UI overview at [Claude Code — Overview](/specship/claude-code/overview/).
