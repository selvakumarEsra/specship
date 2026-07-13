---
description: Crystallize this session's successful workflow into a reusable skill proposal (human-gated — nothing lands until you apply it)
---

# /specship:learn — capture what just worked

Distill the CURRENT session's successful workflow into a reusable routine and
submit it as a SpecShip skill proposal (LEARN-DOC, REQ-LEARN-002). The
proposal is **human-gated**: it enters the same review queue as mined
proposals, and nothing is written to commands/ or memory until the user
applies it from the dashboard's Improvements page.

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

4. **Tell the user** the proposal id from the output and that they can review
   and apply it on the dashboard's Improvements page (preview-diff →
   confirm), or dismiss it.

## Rules

- Capture only what ACTUALLY happened and worked in this session — no
  invented steps, no generalization beyond what was demonstrated.
- If the session had no clearly successful multi-step workflow, say so and
  capture nothing — an empty capture is better than a fabricated routine.
- Never apply the proposal yourself; the human gate is the point.
