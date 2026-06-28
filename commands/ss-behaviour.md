---
description: Author end-to-end tests for a requirement from its acceptance criteria — a Playwright UI test and/or a backend/batch API test per criterion — preview and confirm before writing, link each test to its .A<N> criterion, then run them and record pass/fail into the spec→test→verify chain.
argument-hint: <REQ-ID>
allowed-tools: Read, Edit, Write, Bash, mcp__specship__specship_spec, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node, mcp__specship__specship_link_assert, mcp__specship__specship_link_verify
---

# SpecShip Behaviour: `$ARGUMENTS`

Turn a requirement's **acceptance criteria** into runnable **end-to-end tests** —
a Playwright UI journey and/or a backend/batch API test for each criterion — and
feed the results into the spec→test→verify chain that `specship check` gates on.

You author and run the tests; SpecShip supplies the flow map and records the
verification state; **the human gates the write**. This is distinct from
`/ss-implement` (which writes the *feature* code) — `/ss-behaviour` writes the
*tests* that prove the requirement behaves.

**Governing principle — propose, never auto-apply.** Test files reach disk ONLY
after explicit human confirmation (step 4). Running them afterwards is
non-destructive and proceeds automatically. If the human does not confirm, you
write **nothing**.

If `$ARGUMENTS` is empty, ask which requirement to test (or use `specship_spec`
with a `query` to find it).

## 1. Load the requirement + its criteria

Call `mcp__specship__specship_spec` with the `spec_id`. Read the requirement and
its **acceptance criteria** (the `.A<N>` children) — each criterion is one
behaviour to test (REQ-BEHAVIOUR-002.A1).

## 2. Get the behaviour surface

Call `mcp__specship__specship_spec` with the `spec_id` **and
`behaviour_surface: true`**. It returns the requirement's linked code plus the
surrounding routes / components / handlers, grouped into:

- a **UI tier** — Playwright targets, and
- a **backend / batch tier** — API / job test targets.

An empty UI tier means the project (or this requirement) has no UI surface — you
will author backend/batch tests only (REQ-BEHAVIOUR-002.A4). Use
`specship_explore` / `specship_node` on any surface element whose flow you need
to understand before writing the test.

## 3. Detect the project's test conventions

Before writing anything, ground in how this repo already tests, and **mirror it**
(REQ-BEHAVIOUR-002.A3) — never impose a stack:

- UI: look for a Playwright config / an `e2e/` dir and its file naming.
- Backend: find the runner in use (vitest / jest / pytest / go test / …) and the
  test file layout.

Use `specship_explore` on existing test files (e.g. `*.spec.ts`, `*.test.*`,
`e2e/`) and read a couple to match their style, fixtures, and import paths.

## 4. Plan, preview, confirm — then write + link

For **each acceptance criterion**, plan the end-to-end test(s)
(REQ-BEHAVIOUR-002.A1 / A2):

- If the criterion touches a **UI flow** → a Playwright test exercising it.
- If it touches a **backend/batch path** → an API/batch test.
- If it touches **both** → one of each.

Each test's title and file must name the `.A<N>` criterion it covers, so a
failure is traceable to a criterion.

**Preview the exact test files** (path + full contents) you will create and ask
for explicit confirmation, offering `confirm` / `edit` / `cancel`
(REQ-BEHAVIOUR-003.A1). **Write nothing until confirmed.**

On confirmation:
1. Write the test files (mirroring the detected conventions). A re-run of
   `/ss-behaviour` on the same requirement **refreshes** existing tests rather
   than duplicating them (REQ-BEHAVIOUR-003.A3).
2. For each test, call `mcp__specship__specship_link_assert` with
   `kind: "tests"`, targeting the **`.A<N>` criterion** it covers
   (REQ-BEHAVIOUR-003.A2). Keep the returned `link_id` for step 5.
3. Run `specship sync` and confirm the criteria + links index cleanly
   (REQ-BEHAVIOUR-003.A4).

## 5. Run the tests, record the outcome

Run the relevant suite(s) with the project's runner (via `Bash`), then record
each result through `mcp__specship__specship_link_verify` (REQ-BEHAVIOUR-004):

- a test that **runs and passes** → `result: "pass"` (link → `verified`),
- a test that **runs and fails** → `result: "fail"` with the failure in `reason`
  (link → `broken`),
- a suite that **could not be executed** (missing dependency, no dev server,
  wrong environment) → **report it as unrun and do NOT call link_verify** for
  those tests — leaving the link state unchanged. A test that didn't run is never
  recorded as `broken` (REQ-BEHAVIOUR-004.A2).

## 6. Hand off

Summarize: which criteria now have `verified` / `broken` / unrun tests, and the
behaviour-gate status. The links now feed `specship check`'s behaviour gate
unchanged (REQ-BEHAVIOUR-004.A3): a `broken` link fails the gate when behaviour
gating is on; a requirement with no `verified` test is reported as unverified.
For a failing behaviour, fix the feature with `/ss-implement`, then re-run
`/ss-behaviour` (or just re-run the test and `specship_link_verify`).

## Anti-patterns

- **Writing test files before confirmation** — the one hard rule (step 4).
- **Marking a test `broken` when it never ran** — that false-fails the CI gate
  (step 5).
- **Imposing a test stack** the repo doesn't use — mirror the existing
  conventions (step 3).
- **Writing feature code** — that's `/ss-implement`. `/ss-behaviour` writes
  tests, runs them, and records the result.
- **Generating Playwright tests when there's no UI** — the UI tier will be empty;
  author backend/batch tests only.
