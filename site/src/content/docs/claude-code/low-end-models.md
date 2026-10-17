---
title: Low-end models (Haiku / Gemini Flash)
description: SpecShip detects when a session runs on a cheap, fast model and reshapes its output, guidance, and tool menu so a small model answers in one call instead of falling back to reading files.
---

A small model abandons a tool chain the instant an answer looks
insufficient — it falls back to `Read` and `Grep` and burns the savings it was
chosen for. SpecShip adapts to the model a session is actually running so
that Haiku or Gemini Flash still answers a code question in one call.

Nothing here changes what frontier-model sessions receive. And SpecShip
**never trims for a model it can't identify** — an unknown model always gets
complete, full-size output.

## Model tiers

Every session resolves to one of three tiers:

| Tier | Models | What changes |
|---|---|---|
| **Lite** | Claude Haiku, Gemini Flash (including Flash-Lite) | Everything below |
| **Standard** | Claude Sonnet | Compact tool output only |
| **Full** | Claude Opus, Gemini Pro, any unrecognized model | Nothing — today's output, unchanged |

## How the model is detected

**Claude Code.** On a default install the model is learned automatically —
from the moment the session starts, and again on each prompt, so a mid-session
`/model` switch is tracked. The status line, when installed, is an additional
channel.

**Gemini CLI.** A Gemini session writes none of those signals, so the SpecShip
server reads the model from Gemini CLI's own configuration instead:

1. the `GEMINI_MODEL` environment variable;
2. `model` in the project's `.gemini/settings.json`;
3. `model` in `~/.gemini/settings.json`.

This applies only to servers launched by Gemini CLI — the entry written by
`specship install --target gemini` marks itself with `SPECSHIP_HOST=gemini` —
so a Claude Code session is never misread as Gemini. Nothing is written to
those files, and an unreadable or malformed settings file is simply ignored.
See [Gemini CLI](/guides/gemini-cli/).

## What a Lite session gets

- **Compact tool output.** Boilerplate notices become terse one-liners and
  long dependency lists are capped with an explicit `+N more`. Source code,
  paths, and line numbers stay byte-for-byte intact, and a compacted response
  says so and names the off switch. (Standard-tier sessions get the
  prose compaction without the caps.)
- **One-call explore.** `specship_explore` returns **fewer files with their
  source complete** rather than more files partially — the same response
  size, concentrated where the answer is — and always includes the "this
  source is complete, don't re-read it" reminder so the model stops searching
  and answers.
- **Short, imperative guidance.** The server's instructions to the assistant
  shrink to under a third of the standard length, covering only the tools
  the session actually sees. The integration-specific sections are dropped.
- **A smaller tool menu.** The code-graph tools trim to the core three —
  `specship_explore`, `specship_search`, `specship_node` — so tool choice
  stays reliable. `specship_status` and the spec tools remain. This applies
  from the first moment the session connects.
- **A do-this prompt nudge.** On Claude Code the
  [per-prompt steering](/claude-code/steering/#per-prompt-steering) line
  becomes a precise template: one explore call, answer from it, no subagents.

On Claude Code the status line shows a dim **`optimizing for Lite`** (or
**`optimizing for Standard`**) note while the adaptation is active.

## Overriding the tier

| Setting | Effect |
|---|---|
| `SPECSHIP_MODEL=lite` \| `standard` \| `full` | Force a tier. Always wins over auto-detection. |
| `SPECSHIP_MODEL=<model id>` | Treat the session as that model, e.g. `claude-haiku-4-5` or `gemini-2.5-flash`. |
| `SPECSHIP_COMPACT=0` | Turn the whole adaptation off — every session gets full output. |

Both can be environment variables or keys in a SpecShip settings file
(`<repo>/.specship/settings.json` or `~/.specship/settings.json`), so a repo
can pin its behavior:

```json
{ "SPECSHIP_MODEL": "lite" }
```

On Gemini CLI, set them in the `env` block of the SpecShip entry in
`.gemini/settings.json`, or in a settings file.

## Mixing models in a workflow

For implementation work on a budget, the bundled `spec-implement-mixed`
workflow keeps judgment on a stronger model and the mechanical steps on a
cheaper one: Sonnet plans, Haiku implements, links, and checks coverage, and
the test run plus approval gates verify the result. The dashboard's
[Tips](/claude-code/tips/) page recommends it when a Haiku or Sonnet session
keeps re-reading files. See [Bundled workflows](/workflows/bundled/).
