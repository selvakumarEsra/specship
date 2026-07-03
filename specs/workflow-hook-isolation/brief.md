---
slug: workflow-hook-isolation
created: 2026-07-03
label: workflows
---
# Workflow prompt nodes must isolate the headless claude from REPL-only user hooks

Observed on spec-implement run c0827b64 (REQ-IDEAS-003): the implement node's
headless `claude` finished all its edits, then exited 1 because the user's
global SessionEnd hook (`/auto-didact`) failed with "Prompt stop hooks are not
yet supported outside REPL". The engine marked the node — and the run — failed
even though the work was complete; the diff had to be salvaged, verified, and
landed by hand.

Proposed direction: prompt nodes should run the headless claude with user
hooks suppressed (or an explicit allowlist), or at minimum treat a non-zero
exit whose failure is attributable to a Session/Stop hook as a warning rather
than a node failure when the node's output artifacts are present.

## Grounding
- src/workflows (prompt-node runner — wherever the claude subprocess exit code
  is mapped to node state)
- run c0827b64 error: `claude exited with code 1: SessionEnd hook
  [/auto-didact] failed: Prompt stop hooks are not yet supported outside REPL`
