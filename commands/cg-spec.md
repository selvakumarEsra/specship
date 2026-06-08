---
description: Fetch a spec by ID — body, parent/siblings, and the code currently linked to it (with state). Call FIRST when the user mentions a spec ID.
argument-hint: <SPEC_ID>
allowed-tools: mcp__specship__specship_spec, mcp__specship__specship_node, mcp__specship__specship_explore
---

# SpecShip Spec: `$ARGUMENTS`

Call `mcp__specship__specship_spec` with `spec_id: "$ARGUMENTS"`. The response includes:

- The spec body, kind, owner, priority
- Parent doc and sibling requirements (the surrounding context)
- All code currently linked to this spec with state (verified / drifted / orphaned / broken) and provenance (agent-asserted / code-comment / spec-declaration)

Use this BEFORE Read-ing the spec file — it returns more than the file alone.

After reading the spec, jump into linked code via `mcp__specship__specship_node` (it surfaces every linked spec on a symbol too). If no linked code exists yet, walk the codebase with `mcp__specship__specship_explore` using terms drawn from the spec's title and acceptance criteria.

When you edit code in response to this spec, call `mcp__specship__specship_link_assert` before reporting done.
