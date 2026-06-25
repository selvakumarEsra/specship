---
title: Bundled workflows
description: spec-implement, spec-fix, spec-verify, spec-relink — what each one does, step by step.
---

SpecShip ships these workflows out of the box. They're stored in the npm package and discovered automatically — no config required.

```bash
specship workflow list
# NAME                     TIER     DESC
# spec-implement           bundled  Plan → implement → test → review → merge
# spec-fix                 bundled  Diagnose a drifted/broken link → fix → re-verify
# spec-verify              bundled  Re-run tests, promote implemented → verified
# spec-relink              bundled  Re-attach an orphan after a refactor
# claude-design-implement  bundled  Snapshot a design → draft a spec → hand off to implement
```

The four spec workflows take a `SPEC_ID` and run inside a worktree by default; `claude-design-implement` takes a design URL or handoff bundle and is covered in [Design-to-code](/workflows/design-to-code/). Override any of them by dropping your own `<name>.yaml` under `.specship/workflows/` — project tier always wins.

## `spec-implement`

The most-used workflow. End-to-end "take this requirement, ship code for it" pipeline.

**Inputs**: `SPEC_ID` (required), `BRANCH` (defaults to `feat/$SPEC_ID`).

**Steps:**

1. **plan** — `agent`. The agent reads the spec via `specship_spec`, explores existing code with `specship_explore` to identify anchors, and writes a structured implementation plan as `plan.md`.
2. **implement** — `agent`. Reads `plan.md`, edits files, writes a diff summary as `diff.md`.
3. **affected** — `bash`. Runs `specship affected --since main` to compute which tests are affected by the diff.
4. **test** — `bash`. Runs only the affected tests. Captures `test_results.md`.
5. **review** — `approval`. Pauses for human approval. The UI shows `plan.md`, `diff.md`, `test_results.md` side-by-side.
6. **link** — `agent`. Asserts a spec link from `SPEC_ID` to each new/modified symbol via `specship_link_assert`. Writes `link_summary.md`.
7. **merge** — `shell`. On approval, fast-forwards `BRANCH` onto `main`, removes the worktree.

**Failure modes:**

- Tests fail at step 4 → workflow stops with `status: failed`. Worktree preserved. You inspect, fix, re-run with `--resume <runId>` to skip back to a specific step.
- Reviewer rejects at step 5 → workflow stops with `status: cancelled`. Worktree preserved.
- Anything else fails → worktree preserved, error stored in `workflow_runs.errorMessage`.

## `spec-fix`

Drift queue triage. Use when a spec is showing as `drifted` or `broken` and you need to either update the code or restore the link.

**Inputs**: `SPEC_ID` (required).

**Steps:**

1. **diagnose** — `agent`. Reads the spec + current code at the linked target. Decides whether the spec is right and code needs to catch up, or the code is right and the spec needs editing. Writes `diagnosis.md`.
2. **fix** — `agent`. Conditional on the diagnosis:
   - `when: $diagnose.outcome == "code-drift"` → edit code to match spec.
   - `when: $diagnose.outcome == "spec-drift"` → edit `specs/*.md` to match code (rare; requires explicit human approval).
3. **verify** — `bash`. Runs the tests associated with the spec link.
4. **relink** — `agent`. Calls `specship_link_verify` to promote the link from `drifted`/`broken` back to `verified`. Writes `link_summary.md`.
5. **review** — `approval`. Surface the diff for a human.
6. **merge** — `shell`. On approval, merge.

The conditional `fix` step is the interesting bit — it's a tiny example of the YAML schema's `when:` expressions making one workflow handle two different drift causes without two separate files.

## `spec-verify`

The cheap one. No editing, no merging — just re-runs the tests associated with a spec and updates link states.

**Inputs**: `SPEC_ID` (optional — defaults to all `implemented` links).

**Steps:**

1. **collect** — `script`. Queries SpecShip's spec-link table for all `implemented` links (optionally filtered by `SPEC_ID`).
2. **test** — `bash`. Runs every test linked to any of those specs. Captures per-link pass/fail.
3. **promote** — `script`. Promotes `implemented` → `verified` for any link whose tests all passed.

**Use this in CI.** Drop it into a GitHub Action that runs on every PR to `main`, and your verified-link surface keeps current automatically.

## `spec-relink`

Re-attach an `orphaned` link. Orphans happen when a target file or symbol was renamed/moved/deleted and the link's resolver can't find it anymore.

**Inputs**: `SPEC_ID` (required).

**Steps:**

1. **search** — `agent`. Reads the original spec + the orphan's `target_qualified_name`. Uses `specship_search` to look for the most likely new home (rename, move, split). Writes `candidates.md` with up to 5 ranked candidates.
2. **propose** — `agent`. Picks the top candidate and writes a proposed `link_update.md`.
3. **review** — `approval`. Surface the candidates list + the chosen update.
4. **relink** — `agent`. On approval, calls `specship_link_assert` with the new target. Old orphan is closed.

**Failure mode:** if no candidate scores above a threshold, step 2 writes "no confident match — human triage required" and the approval gate becomes informational rather than confirmatory.

## Customizing a bundled workflow

You can override any bundled workflow by writing a file with the same name in your project's `.specship/workflows/`:

```bash
cp $(npm root -g)/@selvakumaresra/specship/dist/workflows/defaults/spec-implement.yaml \
   .specship/workflows/spec-implement.yaml
# edit to taste; project tier always wins
```

The bundled YAMLs are intentionally close to the minimum useful version. Most teams that customize end up:

- Adding a `lint` step in parallel with `test`.
- Adding a `types` step (`tsc --noEmit`).
- Adding a second `approval` step before `merge` for high-risk repos.
- Changing the `branch:` pattern.
- Restricting the agent's allowed tools at the `agent` step.

→ Next: [Writing custom workflows](/workflows/custom/) for a worked example from scratch.
