---
title: YAML schema
description: The full reference for SpecShip's workflow YAML — fields, runners, depends_on, conditions, loops, approval gates, inputs and variables.
---

A workflow is one YAML file with a name, inputs, and a list of steps. Each step has an `id`, a `runner`, and runner-specific options. Edges between steps come from `depends_on:`.

```yaml
name: my-workflow              # required, unique per project
description: One-liner used in the UI list

inputs:                        # optional — declared at the top
  - { name: SPEC_ID, required: true }
  - { name: BRANCH, default: feat/$SPEC_ID }

variables:                     # optional — global vars available to all steps
  TIMEOUT: "30s"

isolation: worktree            # worktree | none. Defaults to worktree.

steps:
  - id: plan
    runner: agent
    prompt: |
      Plan implementation for $SPEC_ID.
    output: plan.md

  - id: implement
    runner: agent
    depends_on: [plan]
    prompt: file://plan.md
    output: diff.md

  - id: tests
    runner: bash
    depends_on: [implement]
    command: pnpm test

  - id: review
    runner: approval
    depends_on: [tests]
    message: "Approve the diff?"
```

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Unique workflow id. Lowercase, kebab-case. |
| `description` | string | no | Shown in the desktop UI and CLI list. |
| `inputs[]` | array | no | Runtime parameters the user must (or may) supply. |
| `variables` | object | no | Static key/value pairs. Available in every step as `$KEY`. |
| `isolation` | `worktree` \| `none` | no | Default `worktree`. See [Isolation & worktrees](/specship/workflows/isolation/). |
| `requires[]` | array | no | Capability gates — e.g. `claude-code`, `pnpm`. Workflow refuses to start if any capability is missing. |
| `steps[]` | array | yes | The DAG. Order doesn't matter; `depends_on:` is what defines edges. |

## Inputs

```yaml
inputs:
  - { name: SPEC_ID, required: true }
  - { name: BRANCH, default: "feat/$SPEC_ID" }
  - { name: REVIEWER, choices: [alice, bob, carol] }
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | Becomes `$NAME` in every step. |
| `required` | bool | If true, the runner refuses to start without it. |
| `default` | string | May reference other inputs/vars via `$X`. |
| `choices[]` | array | When present, the UI renders a dropdown and the CLI validates. |
| `description` | string | Shown in the input form. |

CLI: `--input KEY=VALUE` (repeatable). UI: a generated form on the workflow's run modal.

## Steps

Every step has:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the workflow. Used in `depends_on:`. |
| `runner` | enum | `agent` \| `shell` \| `bash` \| `approval` \| `script`. |
| `depends_on` | string[] | Step ids this node waits for. Defines the DAG. |
| `when` | string | A condition expression — see [Conditions](#conditions). Step skipped when false. |
| `output` | string | Path (relative to the worktree) where the step writes its primary artifact. Mounted as `file://<path>` in later prompts. |
| `timeout` | string | e.g. `60s`, `5m`. Step aborted on overflow. |
| `retry` | object | `{ attempts: 3, on: [bash_exit_nonzero] }` — see [Loops & retries](#loops--retries). |

### Runner: `agent`

Drives an MCP-capable agent (Claude Code by default) with a prompt. Has access to every `specship_*` tool plus whatever the agent's own toolset is.

```yaml
- id: plan
  runner: agent
  model: claude-opus-4-7      # optional — defaults to repo setting
  prompt: |
    You are planning implementation for $SPEC_ID.
    Use specship_explore to find relevant anchors.
    Output a plan as Markdown.
  output: plan.md
  tools:                      # optional — restrict the agent's tools
    allow: [specship_*, Read, Grep, Glob]
    deny: [Bash, Write]
```

`prompt:` can be inline or a `file://path` reference to another step's output — that's how you chain agent thinking.

### Runner: `bash` and `shell`

`bash` runs a single command in the worktree. `shell` is the same with looser quoting and multi-line scripts.

```yaml
- id: tests
  runner: bash
  command: pnpm test --filter "...[origin/main]"
  env:
    NODE_ENV: test
```

Exit code 0 = success. Anything else fails the step (and the workflow, unless a `retry:` covers it).

### Runner: `approval`

Pauses the workflow indefinitely. Resumes when a human approves (with optional comment) or rejects (with reason).

```yaml
- id: review
  runner: approval
  message: "Merge the diff?"
  inspect:                    # optional — UI surfaces these for review
    - file://diff.md
    - file://test_results.md
```

The run's `status` becomes `paused` while waiting. CLI: `specship workflow approve <runId>`. UI: a banner with **Approve** / **Reject (reason)** buttons.

### Runner: `script`

Runs a JavaScript snippet (or a `.js`/`.mjs` file) in a sandboxed VM with access to a small helpers API (`fs`, `path`, the specship tools, the current step's `inputs`). Useful for glue logic between `agent` steps without dropping all the way to bash.

```yaml
- id: extract-paths
  runner: script
  source: |
    const plan = await ss.readFile('plan.md');
    const paths = [...plan.matchAll(/src\/[\w./-]+/g)].map(m => m[0]);
    await ss.writeFile('paths.json', JSON.stringify(paths));
```

## DAG edges — `depends_on`

```yaml
steps:
  - { id: plan,  runner: agent, ... }
  - { id: lint,  runner: bash,  depends_on: [plan], command: pnpm lint }
  - { id: types, runner: bash,  depends_on: [plan], command: pnpm tsc --noEmit }
  - { id: review, runner: approval, depends_on: [lint, types], message: "Review?" }
```

`lint` and `types` both start the moment `plan` completes. They run **in parallel**. `review` waits for **both** to finish (fan-in).

Cycles are rejected at parse time. Diamond shapes are fine.

## Conditions

Skip a step based on a previous step's outcome:

```yaml
- id: fast-merge
  runner: shell
  depends_on: [tests, review]
  when: '$tests.status == "completed" && $review.outcome == "approved"'
  command: git push origin HEAD
```

Available expression sources:

| Source | Example |
|---|---|
| Step status | `$<id>.status` — one of `completed`, `failed`, `skipped`, `cancelled`. |
| Approval outcome | `$<id>.outcome` — `approved` / `rejected` for approval steps. |
| Artifact existence | `exists("diff.md")` |
| Input/variable | `$SPEC_ID == "REQ-AUTH-005"` |
| Combination | `$tests.status == "completed" && exists("diff.md")` |

## Loops & retries

```yaml
- id: tests
  runner: bash
  command: pnpm test
  retry:
    attempts: 3
    backoff: 2s
    on: [exit_nonzero]
```

For more structural loops (re-run a sub-DAG until a condition), use the `loop` runner:

```yaml
- id: fix-loop
  runner: loop
  while: '$tests.status == "failed"'
  max_iterations: 3
  steps:
    - { id: fix, runner: agent, prompt: "Tests failed. Fix them." }
    - { id: tests, runner: bash, command: pnpm test }
```

## Outputs and artifacts

Each step's `output:` writes a file at `<worktree>/.specship/artifacts/runs/<runId>/<step-id>.<ext>`. Anything written by the runner (agent diffs, bash stdout) is automatically captured as an artifact too. Artifacts are:

- **Mountable** in later steps as `file://<path>`.
- **Surfaced** in the desktop UI under the run's Artifacts tab.
- **Persisted** in SQLite so the run can be replayed/inspected after it ends.

## Where to put the file

Three locations, in priority order:

1. **Project tier**: `<project>/.specship/workflows/*.yaml` — checked into git, project-specific.
2. **Global tier**: `~/.specship/workflows/*.yaml` — your personal recipes.
3. **Bundled tier**: ships inside the npm package. The four `spec-*` workflows.

If two tiers have the same `name:`, the higher-priority one wins.

→ Next: [Bundled workflows](/specship/workflows/bundled/) — exact steps for the four built-ins.
