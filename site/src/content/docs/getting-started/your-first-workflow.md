---
title: Your first workflow
description: From zero to a reviewed spec-implement run — install, index, write a spec, run the workflow, approve the plan and the result, then merge the branch yourself.
---

This walkthrough takes you from a fresh install to a reviewed `spec-implement` run against a real Markdown spec.

## 0. Prerequisites

- Node.js **22.5 or newer, below 25** (Node 24 recommended — its built-in SQLite includes FTS5).
- Claude Code installed and authenticated — the workflow's agent steps run through it.
- A git repo to run against (an existing project is fine).

## 1. Install SpecShip

```bash
npm i -g @specship/specship
specship --version
```

## 2. Wire up Claude Code and index the project

From inside the repo:

```bash
cd your-repo
specship install --yes
```

`--yes` skips the one question and installs **project-local** (`./.mcp.json` + `./.claude/settings.json`) with the auto-allow list, the status line, and the spec-driven layer — and indexes the project. It ends with an install check; run `specship doctor` any time to repeat it. Restart Claude Code (or run `/mcp`) so the new MCP server loads.

Already installed elsewhere? `specship init` in the repo builds its index.

## 3. Add one spec

Create `specs/welcome.md`:

```markdown
---
id: WELCOME-DOC
title: Welcome
---

<!-- id: REQ-WELCOME-001 -->
# Greet the user

Add a function `greetUser(name: string)` that returns
`"Hello, <name>! Welcome to SpecShip."`.

## Acceptance

<!-- id: AC-WELCOME-001-1 -->
- `greetUser("Ada")` returns `"Hello, Ada! Welcome to SpecShip."`.
```

Tell SpecShip to pick it up and check it:

```bash
specship sync
specship lint specs/welcome.md
specship spec REQ-WELCOME-001
```

`sync` indexes the new spec, `lint` checks it for structural errors (it will also warn about quality gaps such as a missing test plan), and `spec` shows its detail. (In Claude Code, `/specship:spec new` walks you through authoring a spec with the `spec-author` checklist instead of writing it by hand.)

## 4. Run your first workflow

```bash
specship workflow run spec-implement --input SPEC_ID=REQ-WELCOME-001
```

The run creates an isolated git worktree under `~/.specship/worktrees/` on a branch named `specship/wf-spec-implement-<runId>` — your working tree is never touched. It reads the spec (`specship_spec`), drafts an implementation plan, and **pauses for you to approve the plan**:

```
Run <runId> → paused
```

Approve it (add `--comment` to pass feedback along), then resume:

```bash
specship workflow approve <runId>
specship workflow resume <runId>
```

Rejecting instead (`specship workflow reject <runId> --comment "…"`) parks the run with its worktree intact; resuming feeds your comment back so the agent revises the plan.

## 5. What runs after approval

1. **implement** — the agent edits files in the worktree.
2. **quality gate** — your project's own lint/typecheck, with one automated fix round if it fails.
3. **suppression scan** — halts if the change *introduces* a lint/type suppression (`eslint-disable`, `@ts-ignore`, `noqa`, …) instead of fixing the code.
4. **diff** — the real `git diff`, captured from git rather than from the agent's summary.
5. **verify** — installs dependencies, builds, and runs your test suite. A broken install or build is reported as an environment failure, not a test failure.
6. **link** — asserts the spec link from `REQ-WELCOME-001` to the code that implements it.
7. **coverage** — counts how many acceptance criteria have test evidence.
8. **adversarial review** — a read-only reviewer grades each acceptance criterion as satisfied, partial, or unaddressed, from the diff.
9. **final review** — pauses again with the diff stat, quality and suppression results, links, coverage, and the review.

Follow along in the dashboard:

```bash
specship desktop
```

Open `http://127.0.0.1:4242` and go to the run — it shows the run's DAG, the live event timeline, each step's output, and **Approve** / reject controls for the gate. `specship workflow runs` lists runs from the terminal.

## 6. Finish the run and merge

Approve the final review and resume. The run completes and **leaves the worktree branch for you** — SpecShip never merges on its own. Inspect it, then merge it like any branch:

```bash
git merge specship/wf-spec-implement-<runId>
specship workflow purge <runId>     # delete the worktree when you're done with it
```

## 7. Prove it's tested

After the run, the link is `implemented` — but a requirement only reaches **`verified`** when a test linked to it as evidence has passed. Declare the proving test in the spec with a `verifies:` block (`- <test-file>:<test-name>`), put an `@verifies REQ-WELCOME-001` comment on the test, or mention the requirement ID in the test's title — then feed a real test run back in:

```bash
npx vitest run --reporter=json --outputFile=report.json
specship verify --report report.json
specship coverage REQ-WELCOME-001
```

`verify` promotes (or demotes) the test links from the report and records the run as evidence; `coverage` shows which requirements and criteria now have it.

## What just happened

- The `spec-implement` workflow opened a worktree, planned against the spec and the graph, and waited for your approval before writing code.
- Deterministic `bash` steps — not the model — produced the diff, ran lint, the suppression scan and the tests, and computed coverage.
- Two `approval` gates kept you in the loop; the branch is yours to merge.

The whole thing is one YAML file. You can copy it into `.specship/workflows/` and customize it, or write a different one — `specship workflow list` shows every workflow available to the project.

## Next

- [Workflows — Overview](/workflows/overview/) — the engine's full feature set.
- [Bundled workflows](/workflows/bundled/) — `spec-implement`, `spec-implement-mixed`, `spec-fix`, `spec-verify`, `spec-relink`, and more.
- [YAML schema](/workflows/yaml-schema/) — every field you can set.
- [Writing custom workflows](/workflows/custom/) — a worked example from scratch.
- [Links & Drift](/specs/links-and-drift/) — how link states and test evidence work.
