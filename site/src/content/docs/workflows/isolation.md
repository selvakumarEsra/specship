---
title: Isolation & worktrees
description: How SpecShip gives a workflow run its own git worktree, what happens to it when the run ends, and how to clean it up.
---

A workflow that sets `worktree: { enabled: true }` runs in an **isolated git worktree**. The agent's edits, the bash commands and the test runs all happen on a checkout that's pinned to its own branch and physically separate from your working tree. The bundled `spec-implement`, `spec-implement-mixed`, `spec-fix`, `spec-author` and `claude-design-implement` workflows all do this; `spec-verify` and `spec-relink` run in your checkout.

Worktrees live outside your repo, under your home directory, keyed by a hash of the repo path so projects never collide:

```
~/.specship/worktrees/
└── 3a7f09c2e4b1/                       ← one directory per repo
    ├── spec-implement-9f3a2b1c/        ← run 9f3a2b1c's worktree
    │   ├── src/                        ← agent edits land here
    │   └── package.json
    └── spec-fix-7c1e8d04/
```

Each worktree gets its own branch, `specship/wf-<workflow>-<shortRunId>` (for example `specship/wf-spec-implement-9f3a2b1c`). `specship workflow run` prints the worktree path when the run ends.

## Why this matters

| Problem | Without isolation | With worktrees |
|---|---|---|
| **Concurrent runs** | Run A's agent and Run B's agent fight over the same `src/`. The second one to edit wins. | Each run has its own checkout. They can both touch `auth.ts` and never see each other. |
| **Crashed agent leaves a mess** | Half-edited files in your working tree. `git status` is a disaster. | The mess is contained in the run's worktree. Your working tree is exactly as you left it. |
| **Reviewing an agent's diff** | The agent's edits are mixed with whatever you were doing. | The diff is the run branch against its base. Clean, scoped, reviewable. |

## How SpecShip provisions a worktree

When a run starts:

1. SpecShip resolves the **base branch**: the workflow's `worktree.base_branch` if set, otherwise the branch you're currently on (or `HEAD` when detached).
2. Runs `git worktree add -b specship/wf-<workflow>-<shortRunId> <path> <base>`. If that branch already exists from an earlier attempt, it checks the existing branch out instead.
3. Sets every node's working directory to that path.

If the worktree can't be created, the run fails immediately with `Worktree setup failed: …` and nothing else runs.

A fresh worktree has no `node_modules/` and no build output. The bundled workflows install dependencies and build before linting or testing, so a missing environment shows up as `env-failed` / `build-failed` rather than as failing tests.

Artifacts and logs are **not** written into the worktree: they go to your project's `.specship/artifacts/runs/<runId>/` and `.specship/logs/`, so they survive whatever happens to the worktree.

## When a run completes

Nothing is merged and nothing is deleted. The worktree and its branch stay put so you can review and land the change your way:

```bash
cd ~/.specship/worktrees/<repo-hash>/spec-implement-9f3a2b1c
git status                     # uncommitted changes the agent left
git log --oneline <base>..HEAD # any commits the agent made
```

Commit anything outstanding there and merge the branch, open a PR from it, or copy the change across — then purge the run. A JIRA-tracked implementation run is the exception: on completion SpecShip pushes the branch and raises a pull request with `gh` (never merging it); see the [JIRA guide](/guides/jira/).

## When a run fails, is rejected, or is cancelled

The worktree is **kept** in every case. No status change — failure, rejection, `specship workflow cancel` — deletes anything as a side effect. You can:

- `cd` into the worktree and poke around — run the failing tests by hand, edit files, see what the agent did.
- For a **rejected** run, `specship workflow resume <runId>` revises the work in the same worktree using your rejection reason, then pauses for review again.
- For a **paused** run (waiting at a gate), `approve` + `resume` continues in the same worktree.

The one exception is a workflow that ends itself through a `cancel` node: that removes the run's worktree.

## Disabling isolation

Isolation is opt-in. Leave `worktree:` out (or set `enabled: false`) and the workflow runs in your project directory:

```yaml
worktree:
  enabled: false
```

That's the right choice for read-only workflows — `spec-verify` and `spec-relink` work this way — but anything that edits code runs straight on your working tree, so use it sparingly.

## Cleaning up: `specship workflow purge`

`purge` is the **only** way a worktree is deleted:

```bash
specship workflow purge <runId>
# Run <runId> purged — worktree removed (<path>). Artifacts and the run record are kept.
```

It removes the worktree directory and deletes its `specship/wf-…` branch. The run record, its events and its artifacts stay in SpecShip, so the run remains inspectable. A run that's still `running` or `paused` can't be purged — cancel it or finish it first. The dashboard's run page has the same **Purge** action.

There's no automatic sweep: list your runs with `specship workflow runs` and purge the ones you're done with.

## What if a worktree won't remove?

If files were left in the worktree that git refuses to discard, remove it by hand:

```bash
git worktree remove --force ~/.specship/worktrees/<repo-hash>/<workflow>-<shortRunId>
git branch -D specship/wf-<workflow>-<shortRunId>
git worktree prune
```

## Disk usage

Worktrees share the `.git/` object database with your main checkout, so they're **lightweight** — only the checked-out files take real space, not the whole git history. Installed dependencies are the bigger cost: a JavaScript project's `node_modules/` is installed per worktree, which is one more reason to purge runs you've finished with.

→ Next: [Channels — CLI, dashboard, CI](/workflows/channels/).
