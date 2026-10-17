---
description: Crystallize this session's successful workflow into a reusable skill proposal (human-gated — nothing lands until you apply it)
---

# /specship:learn — capture what just worked

Distill the CURRENT session's successful workflow into a reusable routine and
submit it as a SpecShip skill proposal (LEARN-DOC, REQ-LEARN-002). The
proposal is **human-gated**: it enters the same review queue as mined
proposals, and nothing is written to commands/ or memory until the user
applies it.

## What to do

1. **Distill the routine from this conversation.** Identify:
   - The goal that was accomplished (one line).
   - The sequence of steps/tools that actually worked — including exact
     commands and specship queries used, in order.
   - Pitfalls hit along the way and how they were avoided (so the routine
     encodes the workaround, not the dead end).
   Keep it under ~40 lines. Write it as instructions a future agent can
   follow verbatim.

2. **Choose a short imperative title** (≤60 chars), e.g. "Release a new
   SpecShip version" or "Add a tree-sitter language".

3. **Submit it** via the capture CLI (content on stdin):

   ```bash
   specship reflect --capture --title "<title>" <<'ROUTINE'
   <the distilled routine>
   ROUTINE
   ```

### Lanes (ALEARN-DOC)

The capture has three lanes — pick by what the lesson IS:

- **skill** (default, above) — a reusable multi-step routine.
- **style** — a code-style convention the user stated or corrected ("always
  use named exports", "use our logger, not console.log"). Capture with
  `--lane style`; title = short rule name, stdin = the rule in one or two
  sentences. On apply it lands in `.specship/conventions.md` and is injected
  into every future session's cheatsheet.
- **domain** — business/product knowledge the user explained (what a term
  means, a rule of the domain, a product decision). Capture with
  `--lane domain`; title = the term/concept, stdin = the fact in plain
  sentences. On apply it lands as a draft fact under `specs/domain/`
  (the apply IS the human confirmation — DOM-SPECSHIP-003).

```bash
specship reflect --capture --lane style --title "<rule name>" <<'RULE'
<the convention>
RULE
```

4. **Tell the user** the proposal id from the output and that they can review
   the open proposals with `specship reflect` (add `--json` for the full
   bodies). Nothing lands until they apply it. The CLI is the only review
   surface today — there is no dashboard page for proposals yet, so don't send
   them looking for one (REQ-SURF-002.A2).

## Rules

- Capture only what ACTUALLY happened and worked in this session — no
  invented steps, no generalization beyond what was demonstrated.
- If the session had no clearly successful multi-step workflow, say so and
  capture nothing — an empty capture is better than a fabricated routine.
- Never apply the proposal yourself; the human gate is the point.
