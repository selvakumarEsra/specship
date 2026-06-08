---
description: Fix a drifted or broken spec link. Runs the spec-fix workflow (diagnose → approve → apply → verify) in an isolated git worktree.
argument-hint: <SPEC_ID>
allowed-tools: Bash
---

# SpecShip Fix: `$ARGUMENTS`

Run the bundled `spec-fix` workflow.

```bash
specship workflow run spec-fix --input SPEC_ID=$ARGUMENTS
```

This:
1. Creates a git worktree.
2. Diagnoses why the link is drifted/broken (spec content_hash changed? code signature changed? test failing?).
3. Pauses for you to approve the proposed fix.
4. Applies the fix, runs tests, calls `specship_link_verify` to promote the link back to "verified".

Use `/cg-relink` instead if the link is `orphaned` (target symbol no longer exists).
