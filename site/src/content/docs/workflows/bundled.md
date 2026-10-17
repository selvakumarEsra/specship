---
title: Bundled workflows
description: spec-implement, spec-implement-mixed, spec-fix, spec-verify, spec-relink, spec-author and claude-design-implement — what each one does, node by node.
---

SpecShip ships these workflows out of the box. They're stored in the npm package and discovered automatically — no config required.

```bash
specship workflow list
#   [bundled] claude-design-implement (5 nodes) — Import a Claude Design … ready to hand off to /specship:spec implement.
#   [bundled] spec-author (7 nodes) — Author a new spec. Draft → gap-fill review → quality review → final approval → write file.
#   [bundled] spec-fix (7 nodes) — Fix a bug surfaced as a drifted/broken spec link. …
#   [bundled] spec-implement (16 nodes) — Implement an unimplemented spec. …
#   [bundled] spec-implement-mixed (16 nodes) — Implement a spec with mixed models — sonnet plans, haiku executes, …
#   [bundled] spec-relink (4 nodes) — Re-attach an orphaned spec link after a refactor. …
#   [bundled] spec-verify (3 nodes) — Run verification across all 'implemented' spec links. …
```

`spec-implement`, `spec-implement-mixed`, `spec-fix`, `spec-author` and `claude-design-implement` run in their own [worktree](/workflows/isolation/); `spec-verify` and `spec-relink` run in your checkout. `claude-design-implement` is covered in [Design-to-code](/workflows/design-to-code/). Override any of them by dropping your own `<name>.yaml` under `.specship/workflows/` — the project tier always wins.

## The verify contract

Every workflow that runs tests follows the same rule: **a test step reports what actually happened, and code — not a model — decides what that means for link state.** The test node prints one marker line:

| `VERIFY_RESULT=` | Meaning |
|---|---|
| `ran-and-passed` | The suite ran and passed. |
| `ran-and-failed` | The suite ran and failed. |
| `skipped` | No recognised test framework — tests did **not** run. Never treated as a pass. |
| `env-failed` | Dependency install failed (or `pytest` is missing). An environment problem, not a test failure. |
| `build-failed` | The build broke before tests could run. Also not a test failure. |

A `route_verify` bash node parses that marker and emits the `LINK_ACTION` the link-writing step must obey. `env-failed`, `build-failed` and a missing marker **halt the run** with a `HALT_CAUSE=` line naming the cause, before any link changes state. Test detection covers npm (`npm ci`/`npm install` when `node_modules/` is missing, then `npm run build --if-present`, then `npm test`), Cargo (`cargo build`, `cargo test`) and Python (`pytest`).

Workflows never mint their own test evidence: a link step may only assert implementation links, never `tests`-kind links. Test evidence comes from the spec's `verifies:` block or an `@verifies` comment on the test — see [Links & drift](/specs/links-and-drift/).

## `spec-implement`

The most-used workflow — the one `/specship:spec implement <SPEC_ID>` launches. End-to-end "take this requirement, ship code for it", with the agent's output checked before a human sees it.

**Inputs**: `SPEC_ID` (required).

**Nodes:**

1. **fetch_spec** — `prompt`. Reads the spec with `specship_spec` and locates the relevant code with `specship_explore`.
2. **plan** — `prompt`. Writes a concrete implementation plan (files, symbols, tests, order). No edits.
3. **approve_plan** — `approval`. **Gate 1.** Approve (optionally with a comment the implementer will read) or reject with feedback; resuming a rejected run revises the plan (up to 3 times).
4. **implement** — `prompt`. Edits code following the approved plan.
5. **quality_gate** — `bash`. Runs the project's own lint or typecheck in the worktree: `npm run lint` if there's a lint script, else `tsc --noEmit` when there's a `tsconfig.json`, `cargo clippy` for Rust, `ruff check` for Python. Prints `QUALITY_GATE=passed|failed|skipped` — a project with no lint or typecheck says `skipped`, never "clean".
6. **fix_quality** — `prompt`. **One automated fix round**: if the gate failed, fix every reported error — the code, never the lint config, and never by silencing a rule.
7. **quality_recheck** — `bash`. Re-runs the same command. Still failing → the run **halts**; failing lint/typecheck never reaches the tests, the links, or you.
8. **suppression_gate** — `bash`. Runs `specship suppressions`. If the change *introduces* lint/type suppression comments (`noqa`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `biome-ignore`), the run **halts** — fix the code instead of silencing the rule. Existing or moved suppressions don't count.
9. **diff** — `bash`. Captures the full `git diff` (including new files) as an artifact. The reviewer and the final gate read this, not the agent's description of its change.
10. **diff_stat** — `bash`. `git diff --stat` — the measured file and line counts shown at the final gate.
11. **verify** — `bash`. Installs dependencies if needed, builds, runs the tests, prints `VERIFY_RESULT=` (see [the verify contract](#the-verify-contract)).
12. **route_verify** — `bash`. Turns the marker into `LINK_ACTION=assert-and-verify-pass | assert-and-verify-fail | assert-only`, or halts on an environment/build failure.
13. **link** — `prompt`. Asserts implementation links with `specship_link_assert`, then acts on `LINK_ACTION`: records a pass or fail with `specship_link_verify`, or leaves links `implemented` when tests didn't run.
14. **coverage** — `bash`. `specship coverage <SPEC_ID> --line`: the acceptance-criteria coverage count, read from the same data the MCP tool and dashboard use. When not every criterion has test evidence, it points you at `/specship:spec behaviour <SPEC_ID>`.
15. **adversarial_review** — `prompt`, **read-only** (no Edit, Write or Bash). A reviewer that isn't the implementer reads the spec and the git diff and reports every acceptance criterion as **satisfied**, **partial** or **unaddressed**, lists untested new code paths, and names the most serious gap.
16. **final_review** — `approval`. **Gate 2.** Shows the `git diff --stat`, the lint/typecheck result, the suppression scan, the asserted links, the coverage line and the adversarial review. Approve to finish — the worktree is left for you to inspect and merge.

**When things go wrong:**

- Lint still fails after the fix round, or a new suppression comment appears → the run halts with `HALT_CAUSE=…`. The worktree is kept, so you can finish the change there by hand or start a fresh run. (If the `specship` CLI can't be found inside the worktree, the suppression scan reports `SUPPRESSION_GATE=skipped` rather than pretending it passed.)
- Dependency install or build fails → reported as an environment failure, not as failing tests, and no link is touched.
- Tests fail → the `verify` node fails and the run stops before linking. The worktree is kept.
- You reject a gate → the run **parks** as `rejected` with its worktree and artifacts intact. `specship workflow resume <runId>` runs the gate's revise step with your rejection reason, then pauses for re-review. Rejection is feedback, never lost work.
- Worktrees are only deleted by an explicit `specship workflow purge <runId>` — no status change destroys work as a side effect.

On a JIRA-tracked run (started from a JIRA issue), completion also raises a pull request with `gh`; see the [JIRA guide](/guides/jira/).

## `spec-implement-mixed`

The same 16 nodes and gates as `spec-implement`, with per-node models chosen for what each step needs: **`plan` and `adversarial_review` run on Sonnet** (the judgment-heavy steps), while `fetch_spec`, `implement`, `fix_quality` and `link` **run on Haiku** (summarize, type the planned code, fix lint, assert links). Every check — lint, suppressions, diff, tests, routing, coverage — is a deterministic bash node, and both approval gates are identical. Correctness comes from the machinery and the reviewer, never from the executor's self-assessment.

```bash
specship workflow run spec-implement-mixed -i SPEC_ID=REQ-AUTH-005
```

Use it when token cost matters and the plan is the hard part; use plain `spec-implement` when you want one capable model end-to-end.

## `spec-fix`

Drift-queue repair, launched by `/specship:check fix <SPEC_ID>` or the dashboard drift queue's **Fix** button. Use it when a spec's link is `drifted` or `broken`.

**Inputs**: `SPEC_ID` (required).

**Nodes:**

1. **diagnose** — `prompt`. Inspects the spec's links and their drift axis (spec changed vs. code changed) and proposes a fix.
2. **approve_fix** — `approval`. Approve the proposed fix, optionally with guidance.
3. **apply** — `prompt`. Applies the fix.
4. **verify** — `bash`. Same bootstrap and `VERIFY_RESULT` marker as `spec-implement`.
5. **route_verify** — `bash`. Emits `LINK_ACTION=verify-pass | verify-fail | no-verify`, or halts on an environment/build failure.
6. **approve_links** — `approval`. **No link changes state until you approve here.** Shows the files changed, the routing decision and the test output; reject to leave every link exactly as it is.
7. **link_verify** — `prompt`. Acts on `LINK_ACTION`. `no-verify` means no test ran, so nothing is promoted. Orphaned links whose symbol moved are re-asserted at the new location; `tests`-kind links are never minted.

## `spec-verify`

The cheap one. No editing, no worktree — runs the suite in your checkout and moves link states on evidence. The drift queue's **Re-verify** button launches it.

**Inputs**: none — it covers every `implemented` link.

**Nodes:**

1. **run_tests** — `bash`. Builds if needed, runs the suite, prints `VERIFY_RESULT=`.
2. **route_verify** — `bash`. Emits `LINK_ACTION=verify-evidenced | verify-fail | no-verify`, or halts.
3. **summarize** — `prompt`. Promotion is **evidence-based**: a spec moves to `verified` only when a test linked to it as evidence (a `verifies:` block, an `@verifies REQ-X` comment, or a spec id in a test title) passed. Specs with no evidence stay `implemented` and are listed as *unevidenced* — a green suite alone never blanket-promotes. A failing test demotes only the specs it evidences. When no tests ran, no link state changes.

For a fully deterministic alternative — no model involved — run `specship verify --report <vitest-json>`, which maps reported test cases to `tests` links and moves the state itself.

## `spec-relink`

Re-attach an `orphaned` link — one whose target file or symbol was renamed, moved or deleted. Launched by the drift queue's **Re-attach** button. Runs in your checkout and never edits code.

**Inputs**: `SPEC_ID` (required).

**Nodes:**

1. **present_orphan** — `prompt`. Lists the orphaned link(s) and what the spec asks for.
2. **search_candidates** — `prompt`. Uses `specship_search` and `specship_explore` to find likely new homes and outputs a numbered candidate list.
3. **approve_relink** — `approval`. Approve with the number of the correct candidate as your comment (`--comment 2`), or `none` to leave the link orphaned.
4. **assert_link** — `prompt`. Calls `specship_link_assert` on the chosen candidate.

## `spec-author`

A gated, workflow-driven version of spec authoring. (The `/specship:spec new` and `/specship:spec fast` slash commands author interactively instead; this workflow is for when you want the same discipline as a recorded run.)

**Inputs**: `DESCRIPTION` (required), `PARENT_DOC`, `OWNER`, `PRIORITY` (optional).

**Nodes:** **ground** (find where the feature would live) → **draft** (a full spec with `<!-- id: -->` markers, RFC 2119 keywords and `.A<N>` acceptance criteria; unknowns marked rather than invented) → **gap_review** (`approval` — answer the gap-fill questions in your comment) → **incorporate** → **quality_review** (structural / quality / hygiene findings) → **finalize** (`approval`) → **write_file**.

## Customizing a bundled workflow

You can override any bundled workflow by writing a file with the same name in your project's `.specship/workflows/`:

```bash
mkdir -p .specship/workflows
cp "$(npm root -g)/@specship/specship/dist/workflows/defaults/spec-implement.yaml" \
   .specship/workflows/spec-implement.yaml
# edit to taste; the project tier always wins
```

Common customizations:

- Pointing `quality_gate` or `verify` at your own commands (`pnpm lint`, `make test`, a filtered test run).
- Adding another `approval` gate for high-risk areas.
- Pinning `model:` on prompt nodes.
- Tightening `allowed_tools` on a prompt node.

Keep the `VERIFY_RESULT` / `LINK_ACTION` markers if you change the test steps — the link step relies on them to never report untested code as verified.

→ Next: [Writing custom workflows](/workflows/custom/) for a worked example from scratch.
