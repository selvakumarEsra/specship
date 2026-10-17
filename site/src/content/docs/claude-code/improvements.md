---
title: Self-improvement (Reflection)
description: SpecShip mines your own Claude Code sessions for waste, wins, code-style conventions, and undocumented domain knowledge — and turns them into proposals you approve. Human-gated, deterministic, local.
---

SpecShip runs a **learning loop** over your own Claude Code history: it
observes (the transcript ingest), detects patterns (deterministic mining rules —
never an LLM guessing), proposes durable fixes, and — only after you approve —
writes them into rules, skills, hooks, project conventions, or domain facts
that make every later session better. Four principles govern it:

- **Human-gated, always.** Every learned artifact is a *proposal* with a
  preview; nothing touches disk until you apply it, and every apply is
  undoable.
- **Deterministic.** Proposals cite the actual rows that triggered them
  (sessions, prompts, runs). Recall is a SQL join, not a summary.
- **Local.** The whole loop runs over the SQLite tables in `.specship/` —
  nothing leaves your machine.
- **Honest.** Transcripts don't record exit codes, so "success" comes only
  from signals that prove it (a workflow run's own completed status) — never
  from inference the data can't support. Below a detector's threshold, it
  stays silent rather than guessing.

## The four-tier memory

| Tier | What | Written by |
|---|---|---|
| **1 · Graph** | Every symbol, edge, file — deterministic truth | tree-sitter extraction |
| **2 · Intent** | Specs, acceptance criteria, domain facts | you (human-confirmed) |
| **3 · Experience** | Every session: prompts, tool calls, costs, workflow runs, per-session outcome records | the transcript ingest |
| **4 · Crystallized behavior** | Memory rules, skills, hooks, project conventions | reflection proposals **you applied** |

Experience comes from the transcript ingest that runs while
[`specship desktop`](/claude-code/overview/) is up. With no ingested sessions
there is nothing to mine, and `specship reflect` says so.

## What the miner detects

Run `specship reflect` to mine and list the open proposals (add `--json` for
the full bodies). The rule set covers several lanes:

**Waste →** repeated re-reads of the same file, grep/find habits, repeated
prompts worth a slash command, repeated post-edit commands worth a hook,
destructive-command patterns, edit hotspots, sessions that never touched the
graph, oversized tool outputs, reference docs read every session.

**Success →** a **completed multi-step workflow run** becomes a reusable
recipe proposal (the steps that worked, the exact re-run command); a shell
command you kept correcting into a working form becomes a "use this form"
rule; a recurring correction is captured *with the context it followed* —
"when doing work like Y: do X" — instead of a context-free preference.

**Style conventions →** when you give the same code-style correction in two
or more separate sessions ("use our logger, not console.log", "stop using
default exports", naming, imports, formatting, comments, error-handling
phrasing), SpecShip proposes it as a **project convention**.

**Domain knowledge →** when a term your sessions keep discussing is an
undocumented domain entity (the same signal `specship domain-gaps` reports),
SpecShip drafts a **domain fact file** for it — a well-formed skeleton for you
to review and edit.

## The auto-learn lanes

The style and domain lanes are what make the loop learn from your real
sessions without you asking.

### Project conventions

An applied style proposal is appended to **`.specship/conventions.md`** — a
file SpecShip owns outright. Your `CLAUDE.md` and any file you wrote yourself
are never touched by this lane.

Every new session then opens already knowing them: the session-start
[cheatsheet](/claude-code/steering/#session-start-cheatsheet) appends a
**Project conventions** section listing the rules. It is budget-bounded — at
most 8 rules are shown, followed by a `+N more — see .specship/conventions.md`
line — and when the file is absent or empty the cheatsheet is unchanged.

### Domain facts

An applied domain proposal writes the fact file under **`specs/domain/`**
with a collision-checked `DOM-` id, and it is indexed on the next sync. The
apply *is* the human confirmation: no mining, sync, or background pass ever
writes under `specs/domain/` on its own. Undo deletes the file; dismissing a
proposal leaves the filesystem untouched.

### The background pass

You don't have to run the miner yourself. `specship sync` (and therefore the
auto-sync hooks) runs the mining pass in the background:

- at most **once every 6 hours** per project (a persisted cooldown);
- with no transcript history it simply finds nothing to propose;
- never able to fail a sync — any error is swallowed.

A newly learned proposal is announced on the sync output as a one-line
`🧠 learned: <title>` notice.

Turn it off, or change the cooldown, in the repo's `specship.config.json`:

```json
{
  "reflect": {
    "autoSweep": false,
    "sweepCooldownHours": 12
  }
}
```

On-demand `specship reflect` keeps working either way.

When learned proposals are waiting, the session-start cheatsheet says so in
one line — `N learned proposal(s) awaiting review` — so the queue is
discovered without opening anything. With nothing open, there's no line.

## Capture on demand: `/specship:learn`

Mined proposals need repetition across sessions. When you want something
captured *now*, run `/specship:learn` in Claude Code. It has three lanes:

| Lane | Capture | Lands on apply |
|---|---|---|
| **skill** (default) | The current session's successful multi-step workflow — goal, the steps and tools that worked, pitfalls avoided | a reusable skill |
| **style** | A code-style convention you just stated or corrected | `.specship/conventions.md` (injected at every session start) |
| **domain** | Business/product knowledge you just explained — what a term means, a domain rule | a draft fact under `specs/domain/` |

Under the hood the command submits the capture through the CLI, content on
stdin:

```bash
specship reflect --capture --lane style --title "Use the shared logger" <<'RULE'
Log through src/utils/logger, never console.log, in application code.
RULE
```

Hard rules baked into the command: capture only what really happened, no
invented steps, an empty capture beats a fabricated one, and it never applies
itself — the proposal enters the same human-gated queue as mined ones.

To capture a mistake you never want repeated as a memory rule (a portable
`~/.claude` memory note, or a block in your project `CLAUDE.md`), use
`specship memory capture` — see [Memory](/claude-code/memory/#cli).

## Recall: "Prior work" in explore

When `specship_explore` resolves to files that past sessions edited, the
response includes a **Prior work** section — date, what was asked, files
touched, workflow runs in that window — so the agent (and you) start from
what was already done instead of rediscovering it. Deterministic, capped
small, silent when there's no match, and never showing another project's
sessions.

## Reviewing, applying, and undoing

Each proposal carries a **preview** of exactly what it would write — a
marker-delimited `CLAUDE.md` block, a `~/.claude` memory note, a skill or
slash-command file, a `settings.json` hook entry, a block in
`.specship/conventions.md`, or a fact file under `specs/domain/`. Applying is
idempotent, re-running the miner converges to the same proposal
(content-hashed) instead of duplicating it, undo removes exactly what apply
wrote, and dismissed proposals never resurface.

Where you can act on them today:

- **Review** — `specship reflect` (CLI) lists every open proposal with its
  target and evidence.
- **Memory rules** — `specship memory list`, `memory edit`, and
  `memory remove` manage the rules you've applied, each previewed before it
  writes.
- **Apply / undo / dismiss** — `specship reflect apply <hash>` shows the
  before→after diff and writes only with `--yes`; `specship reflect undo <hash>`
  reverses an applied proposal; `specship reflect dismiss <hash>` hides it from
  future sweeps. `<hash>` is any unique prefix (4+ characters) of the hash shown
  in the listing — an unknown or ambiguous prefix is refused and nothing is
  written.

:::note
There is no dashboard page for proposals; the CLI is the review surface.
:::
