---
title: Isolation & worktrees
description: Why every workflow runs in its own git worktree, how SpecShip provisions them, and what to do when one is left behind.
---

By default every workflow runs in an **isolated git worktree** under `.specship/wt/<runId>/`. The agent's edits, the bash commands, the test outputs all happen on a checkout that's pinned to a branch and physically separate from your main working tree.

```
your-repo/
├── .git/
├── src/                      ← your normal working tree, untouched
├── package.json
└── .specship/
    └── wt/
        ├── 9f3a2b1c/         ← run 9f3a2b1c's worktree
        │   ├── src/          ← agent edits land here
        │   ├── package.json
        │   └── ...
        └── 7c1e8d04/         ← run 7c1e8d04's worktree
```

Each worktree gets its own branch (`run/9f3a2b1c` by default). When the workflow finishes successfully, the branch is fast-forwarded onto its base (usually `main`), and the worktree is removed. When it fails, **the worktree is preserved** so you can inspect what the agent did.

## Why this matters

Three concrete problems isolation solves:

| Problem | Without isolation | With worktrees |
|---|---|---|
| **Concurrent runs** | Run A's agent and Run B's agent fight over the same `src/`. The second one to edit wins. | Each run has its own `src/`. They can both touch `auth.ts` and never see each other. |
| **Crashed agent leaves a mess** | Half-edited files in your working tree. `git status` is a disaster. You have to manually `git stash` or `git restore`. | The mess is contained in `.specship/wt/<runId>/`. Your working tree is exactly as you left it. |
| **Reviewing an agent's diff** | The agent's edits are mixed with whatever you were doing. You have to mentally separate them. | The diff is `git diff main...run/<runId>`. Clean, scoped, reviewable. |

## How SpecShip provisions a worktree

When a workflow starts:

1. SpecShip resolves the **base branch** (defaults to your current branch, or `main` if you're detached).
2. Creates a new branch `run/<runId>` from the base.
3. Runs `git worktree add .specship/wt/<runId> run/<runId>`.
4. Sets every step's working directory (`cwd`) to that path.
5. Sets `$WORKTREE` as an env var for shell/bash steps.
6. Mounts the workflow's artifacts directory at `.specship/wt/<runId>/.specship/artifacts/runs/<runId>/`.

The agent and shell steps run as if they own the repo. They don't know they're in a worktree (unless they `pwd`).

## When a workflow finishes successfully

Three things happen, in order:

1. The final step (typically a `shell` step that does `git merge --ff-only`) lands `run/<runId>` onto its base.
2. `git worktree remove .specship/wt/<runId>` — the worktree directory is gone.
3. `git branch -d run/<runId>` — the branch is gone too.

Your repo looks like you authored the commit yourself. The run row stays in SpecShip's SQLite forever as audit trail (events, artifacts, cost), but the filesystem is clean.

## When a workflow fails or is cancelled

`.specship/wt/<runId>/` is **left intact**. So is `run/<runId>`. You can:

- `cd .specship/wt/<runId>` and poke around — run failing tests by hand, edit files, see what the agent thought.
- `git diff main...run/<runId>` to see the in-progress diff.
- `git worktree remove .specship/wt/<runId>` when you're done — or let the next `specship workflow cleanup` sweep it.
- Re-run: `specship workflow resume <runId>` continues from the last completed step, reusing the existing worktree.

## Disabling isolation

For workflows that shouldn't open a worktree at all (e.g. read-only analysis workflows that only query the graph and never edit), set:

```yaml
isolation: none
```

The workflow then runs in your main working tree. Use sparingly — the safety net is gone.

## `specship workflow cleanup`

Sweeps every worktree under `.specship/wt/` whose run has been in a terminal state (`completed`, `failed`, `cancelled`) for more than 7 days, removes them, and deletes the matching `run/*` branches.

```bash
specship workflow cleanup
# pruned 4 worktrees, 4 branches
```

Recent terminal runs are kept by default so you can still inspect them. Tune the threshold with `--older-than 1d` etc.

## What if a worktree won't remove?

You wrote files to it outside of git (e.g. a build artifact in `dist/` that the worktree's `.gitignore` would mark as untracked-but-present). Git refuses to remove a worktree with untracked changes.

```bash
git worktree remove --force .specship/wt/<runId>
```

Or `cd` in, clean it up manually, then re-run `specship workflow cleanup`.

## Disk usage

Worktrees share the `.git/` object database with your main checkout, so they're **lightweight** — only the checked-out files take real space, not the whole git history. For a 50 MB-checkout repo, an active worktree is ~50 MB; ten of them is ~500 MB, not 50 × full-repo size.

→ Next: [Channels — CLI, Web UI, GitHub Actions](/specship/workflows/channels/).
