---
description: Draft a new SpecShip spec from a one-line feature description. Walks gap-filling questions, runs a quality review, writes the file.
argument-hint: <one-line feature description>
allowed-tools: Read, Write, Edit, Bash, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node, mcp__specship__specship_files, mcp__specship__specship_spec
---

# SpecShip Author Spec: `$ARGUMENTS`

Author a new spec for the feature `$ARGUMENTS` using the `spec-author` skill loop. Read the skill first if you haven't already — it lives at `~/.claude/skills/spec-author/SKILL.md` with references for format, quality rubric, gap-filling questions, and the review checklist.

Run the loop conversationally:

1. **Scope check.** Confirm whether this is one requirement under an existing doc, a new document with N children, or a refinement of a draft the user already has. Refuse "spec the whole app" — pick a feature area.

2. **Ground in code.** Call `mcp__specship__specship_explore` on terms drawn from `$ARGUMENTS` to find where similar features live, what conventions to mirror, and which files the implementation will likely touch. Skip for clearly-greenfield work.

3. **Draft.** Produce a complete spec body in memory following `~/.claude/skills/spec-author/references/format.md`:
   - YAML frontmatter (id, title, owner, priority)
   - Embedded `<!-- id: -->` markers above every heading
   - RFC 2119 keyword (MUST/SHOULD/MAY) in each requirement title
   - One concern per requirement
   - `## Acceptance` with `.A<N>`-ID'd bullets, happy + failure paths
   - Optional `implementations:` block populated from grounding
   - `[needs user confirmation]` markers wherever the description didn't tell you something

4. **Gap-fill.** Walk `~/.claude/skills/spec-author/references/gap-questions.md` against the draft and ask the user the 3–5 most important unanswered questions. Mark the rest as `[needs review]`. Phrase questions so they can answer in one line each.

5. **Review.** Run `~/.claude/skills/spec-author/references/review-checklist.md` and surface a numbered findings list. Be sharp.

6. **Write.** Use the `Write` tool against `specs/<slug>.md` at the project root. Slug is kebab-case from the feature name, NO date prefix. If a file with that name exists, APPEND the new REQs to it rather than overwriting; tell the user.

7. **Hand off.** Tell the user:
   - The file path you wrote
   - Run `specship sync` to index it
   - Run `/cg-implement <REQ-ID>` when ready to build

If the user wants the more disciplined path with formal approval gates and worktree isolation, point them at:

```
specship workflow run spec-author --input DESCRIPTION="$ARGUMENTS"
```

But the default for this slash command is the conversational loop above — lighter weight, no workflow overhead.
