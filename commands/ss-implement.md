---
description: Implement a spec end-to-end. Runs the spec-implement workflow (plan → approve → implement → verify → link → final review) in an isolated git worktree.
argument-hint: <SPEC_ID>
allowed-tools: Bash
---

# SpecShip Implement: `$ARGUMENTS`

Run the bundled `spec-implement` workflow against the spec.

```bash
specship workflow run spec-implement --input SPEC_ID=$ARGUMENTS
```

This:
1. Creates a git worktree (`specship/wf-spec-implement-<runId>`) so changes don't touch your working tree.
2. Drafts a plan from the spec body + adjacent code.
3. PAUSES at an approval gate — you review the plan, then run `specship workflow approve <runId>` and `specship workflow resume <runId>`.
4. Implements, runs tests, asserts spec→code links, pauses for a final review.

If you just want to view the spec without implementing, use `/ss-spec` instead.

After the workflow completes, the worktree is left for inspection — merge it into your branch when ready, or clean up with `specship workflow cancel <runId>`.
