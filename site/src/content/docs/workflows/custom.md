---
title: Writing custom workflows
description: A worked example — building a "code-review" workflow from scratch under .specship/workflows/.
---

The bundled `spec-*` workflows are tied to specs. Most teams quickly want workflows that aren't — a code-review pipeline for any branch, a dependency-bump pipeline, a security-audit pipeline. Custom workflows live under `.specship/workflows/` and are first-class.

Walk-through: a **`code-review`** workflow that takes a target branch, runs lint and typecheck against the change, asks an agent to review the diff, and pauses for you to read the verdict.

## 1. Scaffold the file

```bash
mkdir -p .specship/workflows
$EDITOR .specship/workflows/code-review.yaml
```

## 2. Declare inputs

What does the user need to supply?

```yaml
name: code-review
description: Review the current branch against a target, with lint + typecheck evidence

inputs:
  - name: TARGET_BRANCH
    description: Branch to diff against
    default: main
  - name: REVIEWER_STYLE
    description: strict, normal or light
    default: normal
```

That's it. The dashboard generates a launch form from these inputs, and the CLI accepts `--input TARGET_BRANCH=main`. Defaults apply whenever an input isn't supplied.

## 3. Decide on isolation

A review doesn't edit code, so it can run in your checkout — leave `worktree:` out. If you'd rather review a clean checkout of the branch while you keep working, add:

```yaml
worktree:
  enabled: true
```

The worktree branches from your current branch, so it sees exactly what you've committed.

## 4. The plan: a DAG

The shape we want:

```
        ┌── lint ──┐
diff ───┤          ├── verdict ── ack
        └── types ─┘
```

`diff` first → `lint` and `types` → `verdict` fans in → a human gate. Nodes run one at a time in dependency order; the DAG says what waits for what.

## 5. Write the nodes

```yaml
nodes:
  - id: diff
    kind: bash
    bash: |
      git --no-pager diff $INPUT.TARGET_BRANCH...HEAD --stat
      echo
      git --no-pager diff $INPUT.TARGET_BRANCH...HEAD | head -c 200000

  - id: lint
    kind: bash
    depends_on: [diff]
    timeout: 300000
    bash: npm run lint 2>&1 && echo "LINT=clean" || echo "LINT=failed"

  - id: types
    kind: bash
    depends_on: [diff]
    timeout: 300000
    bash: npx tsc --noEmit 2>&1 && echo "TYPES=clean" || echo "TYPES=failed"

  - id: verdict
    kind: prompt
    depends_on: [lint, types]
    allowed_tools:
      - Read
      - Grep
      - mcp__specship__specship_explore
      - mcp__specship__specship_callers
      - mcp__specship__specship_impact
    prompt: |
      Review this change. Reviewer style: $INPUT.REVIEWER_STYLE

      The diff:
      $diff.output

      Lint:
      $lint.output

      Typecheck:
      $types.output

      Use specship_explore and specship_impact to check how the changed
      symbols are used elsewhere in the codebase.

      Write a structured review with:
      - severity (block / warn / nit) per finding
      - file:line and a one-line explanation for each issue
      - an overall verdict (approve / request changes / discuss)

  - id: ack
    kind: approval
    depends_on: [verdict]
    message: |
      Review for HEAD vs $INPUT.TARGET_BRANCH:

      $verdict.output
```

A few things worth noticing:

- **Inputs are `$INPUT.<NAME>`**, earlier outputs are **`$<nodeId>.output`**. In a `bash` node, substituted values are shell-quoted for you.
- The lint and typecheck nodes **always exit 0** and print a marker instead. A failing lint shouldn't stop the review — it's evidence for it. (When you *do* want a failure to stop the run, let the command's exit code through, as the bundled `quality_recheck` node does.)
- The `verdict` agent has **no Edit, Write or Bash** — `allowed_tools` keeps a reviewer read-only.

## 6. Try it

```bash
specship workflow list            # check it's discovered, with no validation errors
specship workflow run code-review \
  --input TARGET_BRANCH=main \
  --input REVIEWER_STYLE=strict
```

The command runs until the run finishes or pauses, then prints its status:

```
Run 3f9c2a71-… → paused
```

Every node's output is saved under `.specship/artifacts/runs/<runId>/nodes/` (`diff.md`, `lint.md`, `types.md`, `verdict.md`, `ack.md` once approved). Read `verdict.md` directly, or open the run in the dashboard (`specship desktop` → **Runs**) to read it alongside the event timeline, including each tool call the reviewer made.

## 7. Close the gate

```bash
specship workflow approve <runId> --comment "agreed, fixing the two blockers"
specship workflow resume <runId>
```

Approval only records the decision; `resume` carries the run past the gate. The dashboard's **Approve** button does both in one click. If you'd rather the agent take another pass, reject with a reason and add an `on_reject` prompt to the gate:

```yaml
  - id: ack
    kind: approval
    depends_on: [verdict]
    message: |
      $verdict.output
    on_reject:
      prompt: Re-review the change, paying particular attention to the reviewer's objection.
      max_attempts: 2
```

`specship workflow reject <runId> --reason "you missed the SQL injection in users.ts"` parks the run; `specship workflow resume <runId>` runs the `on_reject` prompt with your reason appended, then pauses at the gate again.

## 8. Run it from a Git hook (optional)

```bash
# .git/hooks/pre-push
specship workflow run code-review --input TARGET_BRANCH=main
```

`workflow run` blocks until the run finishes or reaches the `ack` gate, so expect the push to wait for the review. Drop the `ack` node if you want the hook to simply record a review you'll read later.

## Patterns we like

| Pattern | How |
|---|---|
| **Safety checks as evidence** | Lint + types + secret-scan nodes that print markers, all feeding one reviewer node. |
| **Conditional gate** | `when: '$INPUT.AREA == "auth"'` on an approval node, so only sensitive changes wait for a human. |
| **Retry on flaky** | `retry: { max_attempts: 3, on_error: all }` on a test node. |
| **Agent → script → agent** | An agent prints JSON, a `script` node filters it, a second agent reads `$filter.output.items`. |
| **Fix, then prove** | A fix `prompt` node followed by a `bash` node that re-runs the check and exits non-zero if it still fails — the bundled lint gate's shape. There's no loop construct; bounded retries come from `retry:` or an approval gate's `on_reject`. |
| **Read-only reviewers** | `allowed_tools` without Edit / Write / Bash on any node whose job is to judge, not change. |

→ Next: [Isolation & worktrees](/workflows/isolation/) — where a run's worktree lives and how it's cleaned up.
