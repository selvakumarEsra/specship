---
title: YAML schema
description: The full reference for SpecShip's workflow YAML — top-level fields, node kinds, depends_on, trigger rules, conditions, retries, approval gates, inputs and references.
---

A workflow is one YAML file with a name, optional inputs, and a list of `nodes`. Each node has an `id`, a `kind`, and kind-specific fields. Edges between nodes come from `depends_on:`.

```yaml
name: my-workflow              # required
description: One-liner shown by `specship workflow list` and the dashboard
tags: [review]
requires: [specship, git]

worktree:                      # optional — omit to run in your checkout
  enabled: true

inputs:
  - name: SPEC_ID
    description: The requirement to work on
    required: true
  - name: NOTE
    required: false
    default: ""

nodes:
  - id: plan
    kind: prompt
    prompt: |
      Plan the implementation of $INPUT.SPEC_ID. Do not edit code.

  - id: implement
    kind: prompt
    depends_on: [plan]
    allowed_tools: [Read, Edit, Write, Bash]
    prompt: |
      Implement this plan:
      $plan.output

  - id: tests
    kind: bash
    depends_on: [implement]
    timeout: 600000
    bash: npm test

  - id: review
    kind: approval
    depends_on: [tests]
    message: "Tests passed for $INPUT.SPEC_ID. Approve?"
```

SpecShip validates every file when it's discovered and reports **all** problems at once (`specship workflow list` prints them per file), so one broken workflow never hides its neighbours. Unknown keys are ignored — they are not errors, so a misspelled field silently does nothing.

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | The workflow's name — what you pass to `specship workflow run`. Use kebab-case and match the filename. |
| `description` | string | no | Shown in `specship workflow list` and the dashboard. |
| `tags` | string[] | no | Free-form labels. |
| `requires` | string[] | no | Declared capabilities: `specship`, `git`, `tests`. Anything else is a validation error. Informational today — a missing tool surfaces when the node that needs it runs. |
| `worktree` | object | no | `{ enabled: boolean, base_branch?: string }`. When `enabled: true`, the run gets its own git worktree, branched from `base_branch` (default: your current branch). Omitted = runs in the project directory. See [Isolation & worktrees](/workflows/isolation/). |
| `inputs` | array | no | Runtime parameters — see [Inputs](#inputs). |
| `model` | string | no | Default model for every `prompt` node (including `on_reject` revisions). A node's own `model` wins. |
| `systemPromptAppend` | string | no | Appended to the system prompt of every `prompt` node (including `on_reject` revisions). A node's own `systemPromptAppend` is added after it, not instead of it. |
| `nodes` | array | yes | The DAG. Order in the file doesn't matter; `depends_on:` defines the edges. |

## Inputs

```yaml
inputs:
  - name: SPEC_ID
    description: The spec ID to implement (e.g. REQ-AUTH-005)
    required: true
  - name: OWNER
    required: false
    default: ""
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | Referenced as `$INPUT.<name>` in node fields. |
| `description` | string | Shown as the field label hint in the dashboard's launch form. |
| `required` | bool | The CLI refuses to start without it (`Required input missing: --input NAME=...`); the dashboard disables **Launch** until it's filled. |
| `default` | string | Applied when the input isn't supplied. Optional inputs with no default resolve to `""`, so a `$INPUT.X` reference to an omitted optional input never fails the run. |

CLI: `--input KEY=VALUE` (or `-i`, repeatable). Dashboard: a generated form in the workflow's launch dialog.

## Nodes

Every node has:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the workflow. Used in `depends_on:` and `$<id>.output`. |
| `kind` | enum | `prompt` \| `bash` \| `script` \| `approval` \| `cancel`. |
| `depends_on` | string[] | Node ids this node waits for. Unknown ids and self-references are validation errors; cycles are refused when the run starts. |
| `trigger_rule` | enum | How `depends_on` results combine — see [Trigger rules](#trigger-rules). Default `all_success`. |
| `when` | string | A condition expression — see [Conditions](#conditions). Node is skipped when false. |
| `retry` | object | `{ max_attempts: 1..5, delay_ms?: number, on_error?: transient \| all }` — see [Retries](#retries). |
| `output_type` | string | Semantic tag for the node's output (`plan`, `diff`, `test_results`, …). Recorded in the node's artifact metadata and the `step_completed` event. |
| `always_run` | bool | Run even when the trigger rule isn't met (for cleanup/report nodes). |
| `idle_timeout` | number (ms) | `prompt` nodes only: the agent process is stopped after this many milliseconds. No limit by default. |
| `persist_session` | bool | Accepted; reserved for session reuse across runs — has no effect yet. |

Nodes run **one at a time** in dependency (topological) order.

### Kind: `prompt`

Runs Claude Code headless (`claude --print`, streaming JSON) in the run's working directory with the prompt as input. The agent sees the same MCP servers your Claude Code has configured — including SpecShip's `specship_*` tools. Each tool call and assistant message is recorded as a `tool_called` / `agent_message` event, and the node's cost, duration and model are recorded when it completes.

```yaml
- id: plan
  kind: prompt
  model: sonnet                 # optional — passed to claude --model
  allowed_tools:                # optional allowlist → --allowed-tools
    - mcp__specship__specship_explore
    - mcp__specship__specship_spec
    - Read
  denied_tools: [Bash]          # optional denylist → --disallowed-tools
  systemPromptAppend: |         # optional → --append-system-prompt
    You are planning, not implementing.
  prompt: |
    Plan implementation for $INPUT.SPEC_ID.
    Output a plan as Markdown.
```

| Field | Notes |
|---|---|
| `prompt` | Required. Supports `$INPUT.X`, `$<node>.output`, `$ARTIFACTS_DIR` and `$CONTEXT` references. |
| `model` | Model alias or id for this node. |
| `allowed_tools` / `denied_tools` | Tool allow/deny lists, using Claude Code tool names (`Read`, `Edit`, `mcp__specship__specship_spec`, …). |
| `systemPromptAppend` | Appended to the system prompt for this node. References are substituted. |
| `skills`, `agents`, `mcp`, `hooks` | Accepted and validated, but not passed to the agent yet — a prompt node inherits your Claude Code session's MCP servers, hooks and skills. |

Set `SPECSHIP_CLAUDE_BIN` to point at a specific `claude` binary. Rate-limit, timeout and network errors are marked transient, so the default retry policy covers them.

### Kind: `bash`

Runs a command with `/bin/bash -c` (`cmd.exe /c` on Windows) in the run's working directory. Exit code 0 = success; anything else fails the node, and with it the run (unless `trigger_rule`/`always_run` on a later node says otherwise). Stdout becomes the node's output.

```yaml
- id: tests
  kind: bash
  timeout: 600000               # ms; default 60000
  env:
    NODE_ENV: test
  bash: npm test
```

| Field | Notes |
|---|---|
| `bash` | Required. References are substituted with shell-safe single-quoting; a value over 10 KB is spilled to a temp file and inserted as `"$(cat <file>)"`. |
| `timeout` | Milliseconds. Default `60000`. |
| `cwd` | Override the working directory. |
| `env` | Extra environment variables. |

The Node runtime SpecShip itself runs on is put first on `PATH`, so `node` and npm scripts inside a bash node use the same Node as SpecShip rather than whatever your shell defaults to.

### Kind: `script`

Writes the script to a file and runs it with **Bun** (TypeScript) or **uv** (Python).

```yaml
- id: count-todos
  kind: script
  runtime: uv                   # bun | uv — required
  script: |
    import pathlib, json
    hits = [str(p) for p in pathlib.Path("src").rglob("*.py") if "TODO" in p.read_text()]
    print(json.dumps({"count": len(hits), "files": hits}))
```

| Field | Notes |
|---|---|
| `script` | Required. `$INPUT.X` / `$<node>.output` references are substituted as raw text (no quoting). Stdout becomes the node's output — print JSON to make `$<id>.output.<field>` work downstream. |
| `runtime` | Required: `bun` or `uv`. Override the binaries with `SPECSHIP_BUN_BIN` / `SPECSHIP_UV_BIN`. The node fails cleanly if the runtime isn't installed. |
| `deps` | Packages installed first (`bun install` / `uv add`). |
| `timeout` | Milliseconds. Default `120000`. |
| `cwd`, `env` | As for `bash`. |

### Kind: `approval`

Pauses the run until a human decides. The run's status becomes `paused`.

```yaml
- id: approve_plan
  kind: approval
  depends_on: [plan]
  message: |
    Plan ready for $INPUT.SPEC_ID:
    $plan.output
  capture_response: true
  on_reject:
    prompt: Revise the plan to address the reviewer's feedback.
    max_attempts: 3
```

| Field | Notes |
|---|---|
| `message` | Required. Shown when the run pauses; references are substituted, so the gate can show earlier outputs. |
| `capture_response` | When `true`, the approver's comment becomes `$<id>.output` (otherwise the output is `approved`). |
| `on_reject` | `{ prompt, revises?, max_attempts? }`. When a rejected run is resumed, this prompt runs in the same worktree with the rejection reason appended, then the gate pauses again for re-review. Set `revises: <nodeId>` to have the revision **replace** that node's output, so later steps read the revised plan or draft instead of the original (it must name a node in the workflow). If the revision fails — including a reference that can't be resolved — the run stays `rejected` with the error recorded. After `max_attempts` revisions, resuming stops with an "attempts exhausted" error. Don't reference the gate's own `$<id>.output` here — a rejected gate has no output; the reason is appended for you. |

- **Approve**: `specship workflow approve <runId> [--comment "..."]`, then `specship workflow resume <runId>` to continue. (The dashboard's **Approve** button does both.)
- **Reject**: `specship workflow reject <runId> --reason "..."` parks the run as `rejected` with its worktree and artifacts intact. `resume` drives the `on_reject` revision; `purge` discards the worktree. Without an `on_reject`, resuming simply pauses at the gate again.
- **Resume after a failure**: `specship workflow resume <runId>` on a `failed` run retries the failed node (and re-evaluates the nodes it caused to be skipped); completed nodes are not re-run. If the retry fails again, the run ends `failed`.

### Kind: `cancel`

Ends the run with status `cancelled` and the given reason. Usually combined with `when:`.

```yaml
- id: stop-if-no-spec
  kind: cancel
  depends_on: [fetch_spec]
  when: '$fetch_spec.output == "NOT_FOUND"'
  cancel: The spec does not exist — nothing to implement.
```

## DAG edges — `depends_on`

```yaml
nodes:
  - { id: plan,   kind: prompt, prompt: "Plan the change." }
  - { id: lint,   kind: bash,   depends_on: [plan], bash: npm run lint }
  - { id: types,  kind: bash,   depends_on: [plan], bash: npx tsc --noEmit }
  - { id: review, kind: approval, depends_on: [lint, types], message: "Review?" }
```

`review` waits for **both** `lint` and `types` (fan-in). Diamond shapes are fine; cycles are refused (`Workflow DAG contains a cycle — refusing to execute`).

## Trigger rules

| `trigger_rule` | The node runs when… |
|---|---|
| `all_success` *(default)* | every `depends_on` node completed. |
| `one_success` | at least one completed. |
| `none_failed_min_one_success` | at least one completed and none failed. |
| `all_done` | every `depends_on` node reached a final state (completed, failed or skipped). |

A node whose rule isn't met is skipped (`step_skipped`, reason `trigger_rule`) unless it sets `always_run: true`. Note that a failing node normally ends the run straight away, so failure-tolerant rules matter mostly for nodes downstream of skipped ones.

## References

Node text fields (`prompt`, `systemPromptAppend`, `bash`, `script`, approval `message`, `cancel`) support:

| Reference | Resolves to |
|---|---|
| `$INPUT.<NAME>` | A workflow input. Referencing an input that wasn't provided fails the node. |
| `$<nodeId>.output` | The full text output of an earlier node. |
| `$<nodeId>.output.<field>` | A field of the node's output, when that output is JSON. |
| `$ARTIFACTS_DIR` | `<project>/.specship/artifacts` (set by the CLI). |
| `$CONTEXT` | The project root (set by the CLI). |

Referencing a node that hasn't produced output (not run yet, skipped or failed) fails the node rather than silently inserting nothing. A bare `$word` with no `.output` is left as literal text, so shell variables like `$HOME` in a `bash` node pass through untouched.

## Conditions

`when:` skips a node based on earlier outputs or inputs:

```yaml
- id: security_review
  kind: prompt
  depends_on: [implement]
  when: '$INPUT.AREA == "auth" || $INPUT.AREA == "payments"'
  prompt: Review the change for security issues.
```

The expression language is deliberately small:

| Construct | Example |
|---|---|
| Comparison | `==`, `!=`, and numeric `<`, `>`, `<=`, `>=` |
| Logic | `&&`, `\|\|` (no parentheses) |
| Values | references, `'quoted'` / `"quoted"` strings, bare words, numbers, `true` / `false` |
| Truthiness | An expression with no operator is true when it's non-empty. |

`when:` **fails closed**: an expression that can't be parsed, or that references an output that doesn't exist, evaluates to false and the node is skipped (`step_skipped`, reason `when_condition_false`).

## Retries

```yaml
- id: tests
  kind: bash
  bash: npm test
  retry:
    max_attempts: 3             # 1..5 retries after the first attempt
    delay_ms: 2000              # default 3000, doubled each retry
    on_error: all               # transient (default) | all
```

With no `retry:`, a node gets **2 retries on transient errors** (rate limits, timeouts, network) with a 3-second backoff. `on_error: all` retries any failure — useful for flaky tests, but think twice before using it on nodes that edit code.

There is no loop construct. For "fix until green" behaviour, use an approval gate with `on_reject`, or a fix node followed by a re-check node, as `spec-implement` does with its lint gate.

## Outputs and artifacts

Every completed node writes its output to `<project>/.specship/artifacts/runs/<runId>/nodes/<nodeId>.md`, plus a `<nodeId>.meta.json` with its kind, `output_type` and any structured data. Raw logs go to `<project>/.specship/logs/` (`<runId>-<nodeId>.jsonl` for prompt nodes, `.bash.log` for bash nodes). Artifacts are:

- **Referenced** in later nodes as `$<nodeId>.output`.
- **Shown** in the dashboard on the run's page.
- **Kept** after the run ends — `purge` removes only the worktree, never artifacts or the run record.

## Where to put the file

Workflows are discovered from three places; on a name clash the higher tier wins:

1. **Project**: `<project>/.specship/workflows/*.yaml` (or `.yml`) — checked into git, project-specific. One level of subdirectories is scanned.
2. **Global**: `~/.specship/workflows/*.yaml` — your personal recipes.
3. **Bundled**: ships inside the npm package — the `spec-*` and `claude-design-implement` workflows.

`specship workflow list` shows each workflow with its tier (`[project]`, `[global]`, `[bundled]`) and node count.

→ Next: [Bundled workflows](/workflows/bundled/) — the exact steps of the built-ins.
