---
description: Re-attach an orphaned spec link after a refactor moved or renamed the target symbol.
argument-hint: <SPEC_ID>
allowed-tools: Bash
---

# SpecShip Re-link: `$ARGUMENTS`

Run the bundled `spec-relink` workflow.

```bash
specship workflow run spec-relink --input SPEC_ID=$ARGUMENTS
```

This:
1. Presents the orphaned link's original target (file path + qualified name).
2. Searches the current codebase for candidate symbols that match.
3. Pauses for you to pick the right candidate (or reject all and abandon).
4. Calls `specship_link_assert` at the new location.

No code is edited — this only updates the spec→code link layer.
