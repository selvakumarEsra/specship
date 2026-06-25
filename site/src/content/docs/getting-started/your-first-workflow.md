---
title: Your first workflow
description: Twelve minutes from zero to a passing workflow run — install, init, run spec-implement against a real spec, watch the timeline, approve the diff.
---

This walkthrough takes you from a fresh install to a passing `spec-implement` run against a real Markdown spec. Twelve minutes if you don't get distracted.

## 0. Prerequisites

- Node.js ≥ 22.5 (Node 24 recommended — its bundled SQLite has FTS5).
- Claude Code installed and authenticated.
- A git repo to run against (an existing project is fine; an empty one works too).

## 1. Install SpecShip

```bash
npm i -g @selvakumaresra/specship
```

Verify:

```bash
specship --version
# specship 0.5.0
```

## 2. Wire up Claude Code

```bash
specship install --yes
```

The `--yes` flag picks the non-interactive defaults: global location, auto-allow on. The command writes the MCP server entry, the auto-allow list, and the slash commands.

Verify Claude Code sees the new MCP server:

```bash
claude mcp list
# specship  running  ./node_modules/.bin/specship serve --mcp
```

## 3. Index a project

`cd` into any git repo and run:

```bash
specship init -i
```

`init -i` does two things: creates `.specship/` with the SQLite schema, then runs the initial graph build. For a 20k-file repo this takes ~60s on a fast Mac.

## 4. Add one spec

Create `specs/welcome.md`:

```markdown
<!-- specs/welcome.md -->
---
id: WELCOME-DOC
title: Welcome
---

<!-- id: REQ-WELCOME-001 -->
# Greet the user

Add a function `greetUser(name: string)` that returns
`"Hello, <name>! Welcome to SpecShip."`.
```

Tell SpecShip to pick it up:

```bash
specship sync
```

`sync` reconciles new files. The graph now has one `spec` node — `REQ-WELCOME-001`.

## 5. Run your first workflow

```bash
specship workflow run spec-implement --input SPEC_ID=REQ-WELCOME-001
```

Watch the timeline stream:

```
runId   c8a4f3b2
✓ plan         (24s · $0.34)
✓ implement    (38s · $1.21)
✓ affected     (0.2s)
✓ test         (8s)
⠦ review       paused — awaiting approval
```

The agent has:

1. **Planned** the implementation against the spec.
2. **Edited** files in the isolated worktree to add `greetUser`.
3. **Computed affected tests** (`specship affected`).
4. **Run the affected tests** — and (assuming there's a test for `greetUser`) seen them pass.
5. **Paused at the review gate** waiting for you.

## 6. Open the desktop UI

In another terminal:

```bash
specship serve --ui --open
```

Your browser opens at `http://127.0.0.1:4242/runs/c8a4f3b2`. The page shows the run's DAG (lit green for completed nodes, amber for the paused gate), the live event timeline, and the artifact tabs.

Click the **Artifacts** tab. You'll see:

- `plan.md` — the agent's implementation plan.
- `diff.md` — the changes it made.
- `test_results.md` — the test output.

Read them. If the diff looks right, click **Approve** at the top of the page.

## 7. Watch it merge

The workflow resumes:

```
✓ review       approved
✓ link         (3s)         ← asserts REQ-WELCOME-001 → greetUser
✓ merge        (0.4s)
✓ run complete (90s total · $1.55)
```

Back in your terminal, `git log` shows a new commit on `main` — the agent's diff, fast-forwarded from the worktree. The `.specship/wt/c8a4f3b2/` directory is gone (cleaned up on successful merge).

## 8. Verify the spec link

```bash
specship spec REQ-WELCOME-001
```

```
REQ-WELCOME-001  · state: implemented
  title:  Greet the user
  links:
    - implements  src/welcome.ts:greetUser  (verified)
    - tests       test/welcome.test.ts:greetUser  (passed)
```

You've gone from spec → tested code → verified link, with one command and one human approval.

## What just happened

Five things, in order:

1. The `spec-implement` workflow opened a worktree.
2. An `agent` step read the spec via `specship_spec`, planned, and wrote `plan.md`.
3. A second `agent` step read the plan, edited files, wrote `diff.md`.
4. A `bash` step ran the affected tests and captured `test_results.md`.
5. An `approval` step paused for you. On approval, the workflow asserted the spec link, merged the worktree, and ended.

The whole thing is one YAML file. You could edit it, customize it, share it. Or write a different one for code review, dependency bumps, security audits.

## Next

- [Workflows — Overview](/workflows/overview/) — the engine's full feature set.
- [YAML schema](/workflows/yaml-schema/) — every field you can set.
- [Writing custom workflows](/workflows/custom/) — a worked example of a code-review workflow from scratch.
- [Why specs](/specs/why-specs/) — what specs buy you beyond "shared brief".
