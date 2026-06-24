---
description: Brainstorm a requirement — analyse, ground in code, explore approaches, loop with you, and ONLY on your explicit confirmation write a design brief and hand off to /ss-spec-author. Nothing is written until you confirm.
argument-hint: <requirement to brainstorm>
allowed-tools: Read, Write, Edit, Bash, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node, mcp__specship__specship_files, mcp__specship__specship_spec
---

# SpecShip Brainstorm: `$ARGUMENTS`

The **divergent** front of spec-driven development. You explore the problem with the human and DECIDE; `/ss-spec-author` formalizes the decision into a spec. Run this conversationally — do NOT batch.

## The hard rule (read first)

**Write NOTHING to disk until the human EXPLICITLY confirms.** No brief, no spec, no scratch file during the loop. Treat the default as no-write. A vague "maybe", "looks ok", silence, or a follow-up question is **not** confirmation — only an unambiguous "yes, write it" / "confirmed" / "go ahead" counts. If the human ends the conversation without confirming, you have produced zero files, and that is correct.

## The loop

1. **Scope check.** Refuse "brainstorm the whole app" — pick one feature area. If `$ARGUMENTS` is empty, ask what they want to brainstorm.
2. **Ground in code.** Call `mcp__specship__specship_explore` (and `specship_search`) on terms from `$ARGUMENTS` to find where similar features live, conventions to mirror, and which files the work will likely touch. Summarize what you found.
3. **Approaches.** Propose **2–3 distinct approaches** with trade-offs, and lead with your recommendation and why.
4. **Clarify.** Ask the human **one question at a time** about the things the graph can't tell you — UX, edge cases, acceptance criteria, non-goals. Don't dump a list.
5. **Iterate** 3–4 until the human is satisfied with a direction. Then ask: *"Want me to write this up as a brief and hand it to /ss-spec-author?"* — and WAIT for an explicit yes.

## On explicit confirmation (and only then)

1. Derive a kebab-case `<slug>` from the feature.
2. Write the brief to **`specs/<slug>/brief.md`** using the format below. Leave the `spec:` field **unset** for now.
3. Hand off: invoke **`/ss-spec-author`** with the brief — pass the brief's path so spec-author reads it and does NOT re-ground in code (the brief already has the grounding). spec-author assigns the real spec **ID** and writes `specs/<ID>.md`.
4. Once spec-author has written the spec: set the brief's `spec:` field to the new ID, and ensure the spec's frontmatter has **`brief: <slug>/brief.md`** (relative to the spec file's own directory) so the two link both ways.
5. If spec-author fails, STOP and tell the human: the brief exists with `spec:` unset; retry is re-running `/ss-spec-author` with the same brief path. Do not hand-write a spec.
6. Point them at `/ss-spec-review <ID>` then `/ss-implement <ID>`.

## Brief format (`specs/<slug>/brief.md`)

```markdown
---
slug: <slug>
spec:            # set to the REQ-… id after /ss-spec-author writes the spec
created: <date>
---

# Brainstorm: <feature>

## Problem
<what we're solving and why>

## Code grounding
<relevant files / symbols / conventions found via specship_explore>

## Approaches considered
1. <A> — <trade-offs>
2. <B> — <trade-offs>
**Chosen: <X>** — <rationale>

## Key decisions
<the calls made during the loop>

## Edge cases & non-goals
<…>

## Acceptance criteria
<…>
```

## Anti-patterns
- **Writing before confirmation.** The single most important rule — see above.
- **Re-interviewing about taste / proposing your own variants without grounding.** Ground first, then propose.
- **Duplicating spec-author.** You decide; spec-author formats. Don't write the formal `specs/<ID>.md` yourself.
- **Treating a question as confirmation.** Only an explicit yes writes files.
