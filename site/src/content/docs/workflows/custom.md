---
title: Writing custom workflows
description: A worked example — building a "code-review" workflow from scratch under .specship/workflows/.
---

The bundled `spec-*` workflows are tied to specs. Most teams quickly want workflows that aren't — a code-review pipeline that runs on any PR, a dependency-bump pipeline, a security-audit pipeline. Custom workflows live under `.specship/workflows/` and are first-class.

Walk-through: a **`code-review`** workflow that takes a target branch, asks an agent to review the diff, runs lint + types in parallel, and posts the verdict.

## 1. Scaffold the file

```bash
mkdir -p .specship/workflows
$EDITOR .specship/workflows/code-review.yaml
```

## 2. Declare inputs

What does the user need to supply?

```yaml
name: code-review
description: Asynchronous code review with parallel lint + types

inputs:
  - { name: TARGET_BRANCH, default: main }
  - { name: REVIEWER_STYLE, choices: [strict, normal, light], default: normal }
```

That's it. SpecShip generates a form from these inputs for the desktop UI's *Run* button and accepts `--input TARGET_BRANCH=main` on the CLI.

## 3. Set isolation

```yaml
isolation: worktree
```

Code review doesn't modify code — but reading the diff in an isolated worktree means concurrent reviews don't trip on each other's `git diff`. Cheap insurance.

## 4. The plan: a DAG

The shape we want:

```
        ┌── lint ──┐
diff ───┤          ├── verdict
        └── types ─┘
```

`diff` first → `lint` and `types` in parallel → `verdict` fans in.

## 5. Write the steps

```yaml
steps:
  - id: diff
    runner: bash
    command: |
      git diff $TARGET_BRANCH...HEAD --stat > diff_stat.txt
      git diff $TARGET_BRANCH...HEAD       > diff.patch
    output: diff.patch

  - id: lint
    runner: bash
    depends_on: [diff]
    command: pnpm lint --output-file lint.txt
    output: lint.txt

  - id: types
    runner: bash
    depends_on: [diff]
    command: pnpm tsc --noEmit > types.txt 2>&1
    output: types.txt

  - id: verdict
    runner: agent
    depends_on: [lint, types]
    prompt: |
      Review the diff at file://diff.patch.

      Reviewer style: $REVIEWER_STYLE
      Lint output:    file://lint.txt
      Types output:   file://types.txt

      Use specship_explore to check how the changed symbols are used
      elsewhere in the codebase.

      Write a structured review with:
      - severity (block / warn / nit) per finding
      - one-line summary
      - file:line and a 3-line code excerpt for each issue
      - an overall verdict (approve / request changes / discuss)
    output: review.md
```

## 6. Try it

```bash
specship workflow run code-review \
  --input TARGET_BRANCH=main \
  --input REVIEWER_STYLE=strict
```

You'll see:

```
✓ diff       (0.4s)
✓ lint       (4.2s)     [parallel]
✓ types      (12.1s)    [parallel]
⠦ verdict    in progress…
```

When `verdict` finishes, the worktree contains:

```
.specship/artifacts/runs/<runId>/
  diff.patch
  diff_stat.txt
  lint.txt
  types.txt
  review.md          ← the agent's structured review
```

Open `review.md` directly, or open the desktop UI's run-detail page to read it inline with the timeline.

## 7. Add an approval gate (optional)

If you want a human-in-the-loop step before the workflow is considered "done", add an `approval` runner:

```yaml
  - id: ack
    runner: approval
    depends_on: [verdict]
    message: "Read the review?"
    inspect:
      - file://review.md
```

CLI: `specship workflow approve <runId>` to resume past it.

## 8. Wire to Git hooks (optional)

To run this automatically on every PR locally:

```bash
# .git/hooks/pre-push
specship workflow run code-review \
  --input TARGET_BRANCH=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} | sed 's|.*/||') \
  --background \
  --notify-on-complete
```

The `--background` flag returns immediately. `--notify-on-complete` writes the run id to `~/.specship/notifications/` — the desktop UI picks it up and surfaces a toast when the verdict lands.

## Patterns we like

A few patterns we keep coming back to in custom workflows:

| Pattern | Where to use |
|---|---|
| **Parallel safety checks** | Lint + types + secret-scan all branch off the same diff node. |
| **Conditional approval** | `when:` an approval is required only if the diff touches certain paths (e.g. anything in `src/auth/`). |
| **Retry on flaky** | `retry: { attempts: 3, on: [exit_nonzero] }` on the test step. |
| **Agent → script → agent** | An agent produces a structured plan, a `script` step parses + filters it, a second agent acts on the filtered subset. |
| **Loop until green** | A `loop:` runner that re-runs `fix` + `test` until tests pass or `max_iterations: 3` is hit. |

→ Next: [Isolation & worktrees](/specship/workflows/isolation/) — what's actually happening under `.specship/wt/`.
