---
description: Review an existing spec against the SpecShip quality rubric. Read-only — produces a numbered findings list without modifying the file.
argument-hint: <SPEC_ID | path/to/spec.md>
allowed-tools: Read, mcp__specship__specship_spec, mcp__specship__specship_explore, mcp__specship__specship_node, mcp__specship__specship_search
---

# SpecShip Review Spec: `$ARGUMENTS`

Review the spec referred to by `$ARGUMENTS` (either a spec ID like `REQ-AUTH-005`, or a file path like `specs/auth.md`) against the rubric defined in the `spec-author` skill. **This is read-only — do NOT modify any files.**

If you haven't loaded the skill yet, read `~/.claude/skills/spec-author/SKILL.md` and especially `~/.claude/skills/spec-author/references/review-checklist.md`.

## How to do it

1. **Resolve the target.** If `$ARGUMENTS` looks like a spec ID, call `mcp__specship__specship_spec` to fetch its source path. If it looks like a file path, read the file directly.

2. **Verify code grounding** (when applicable). For each entry in the spec's `implementations:` block, confirm via `mcp__specship__specship_node` or `mcp__specship__specship_explore` that the referenced file + symbol actually exists. Greenfield specs (empty `implementations:`) skip this step.

3. **Run the checklist.** Walk `references/review-checklist.md` in order:
   - **STRUCTURAL** (S1–S5): embedded ID markers, no stranded IDs, unique IDs, well-formed frontmatter, valid `implementations:` syntax. These block the file from indexing — flag any breakage as critical.
   - **QUALITY** (Q1–Q7): RFC 2119 keywords, no weasel words, no implementation leak, testable acceptance, one concern per REQ, failure-path coverage, grounded `implementations:` paths.
   - **HYGIENE** (H1–H4): owner + priority set, no stale `[needs review]` markers, no TODO/FIXME, body conciseness.

4. **Output as a numbered findings list**, grouped by category:

   ```
   STRUCTURAL — N findings:
   1. Line N: ...

   QUALITY — N findings:
   1. Line N: ...

   HYGIENE — N findings:
   1. Line N: ...

   Net: <summary>. Address structural items before re-indexing.
   ```

5. **End with a one-line verdict**: "Spec is ready to ship", "Needs the structural fixes before it can index", or "Has quality issues worth addressing before /cg-implement runs."

## Anti-patterns to avoid

- **Don't modify the file.** Even if the issues are obvious. The user runs `/cg-spec-author` for that flow.
- **Don't paraphrase the checklist.** Reference specific items (S1, Q3, etc.) when you flag a finding so the user can cross-reference.
- **Don't be polite about real problems.** Implementation leak ("MUST use bcrypt") and untestable bullets ("handles errors gracefully") are pickup-line-quality findings — say so directly.
- **Don't review the wrong file.** If the path is ambiguous (e.g. multiple specs at similar paths), ask the user which one before reading.

If `$ARGUMENTS` is empty, ask the user which spec to review (by ID or path).
