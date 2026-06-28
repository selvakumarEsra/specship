---
slug: behaviour-harness
spec: BEHAVIOUR-DOC
created: 2026-06-28
---

# Brainstorm: Behaviour-harness lane — generate, run, and verify E2E behaviour tests from spec acceptance criteria

## Problem
SpecShip already owns the **verify half** of a behaviour harness: `tests`-kind
spec links, the `verified`/`broken` state machine, and the `evaluateEnforcement`
behaviour check that gates CI on broken/unverified requirements. What's missing
is the **generate + run half**: nothing turns a requirement's acceptance criteria
into actual end-to-end tests (a Playwright UI journey, a backend API/batch path),
runs them, and feeds the outcome back into that chain. So today the spec→test→
verify gate exists but is fed manually. We want a front door that takes a
requirement, authors the E2E tests for each acceptance criterion from the *same*
spec — UI and backend alike — links them, runs them, and reports pass/fail into
the chain `specship check` already enforces.

This is the unfinished part of the harness story after the three shipped lanes
(maintainability, fitness, enforce) — the behaviour/test-generation frontier the
positioning doc marks `🟡 partial` (REQ-STRATEGY-003.A3: "no test gen/run/judge").

## Code grounding
- **The verify chain already ships — reuse it, don't rebuild it.**
  `src/enforce/enforce.ts:evaluateEnforcement` walks each requirement's
  `tests`-kind links (its own + its acceptance children's `RequirementVerification.testsLinks`):
  any `broken` → CI fails; none `verified` → "unverified". So generated tests
  just need to land as `tests`-kind links in the right state.
- **Link + verify primitives exist.** `specship_link_assert` (kind `tests`) ties
  a test symbol to a requirement / `.A<N>` criterion; `specship_link_verify`
  records `pass → verified` / `fail → broken`. A Playwright UI test and a backend
  API test link identically — the *same spec* drives both.
- **Test selection exists; execution does not.** `specship affected`
  (`src/bin/specship.ts`) BFS-walks the graph for transitively-affected test
  files (default patterns already include `/e2e/`). It picks what to re-run; it
  never runs anything.
- **Spec-text retrieval surface to mirror.** The behaviour-surface primitive
  should follow the pattern just shipped for triage: `specship_spec` gained a
  `query` mode (`src/mcp/spec-tools.ts:handleSpecshipSpec` → `buildSpecSearch`,
  `src/db/spec-queries.ts:searchSpecs`) rather than a new tool. A new behaviour
  mode on `specship_spec` (or a dedicated tool) returns a requirement's linked
  code + the surrounding routes/components/handlers grouped UI vs backend.
  SpecShip already extracts `route` and `component` node kinds and resolves
  framework routes (Express/Laravel/Rails/FastAPI/Django/Flask/Spring/React
  Router/SvelteKit/Vue-Nuxt/…), so the UI-vs-backend split is derivable from the
  graph.
- **Browser-driving plumbing already in-repo (not reused here).** The designer
  subsystem speaks CDP to a Chrome on :9222 — but it's pointed at design import,
  not behaviour testing, and Approach A does not execute tests at all (the agent
  runs them per repo conventions).
- **Skill pattern to mirror.** `commands/ss-domain.md` and `commands/ss-triage.md`
  are the template: a human-gated orchestrating skill (preview → confirm → write),
  shipped via `SHIPPED_COMMANDS` in `src/installer/targets/claude.ts` with matching
  install/uninstall coverage in `__tests__/installer-targets.test.ts`.
- Likely files touched: `src/mcp/spec-tools.ts` (behaviour-surface mode) +
  whatever query it needs in `src/db/spec-queries.ts` / the graph layer; a new
  `commands/ss-behaviour.md` skill; `SHIPPED_COMMANDS` + installer test; CHANGELOG.

## Approaches considered
1. **Orchestrating skill + behaviour-surface primitive (SpecShip stays a tracker).**
   A `/ss-behaviour` skill authors UI (Playwright) + backend/batch tests from
   acceptance criteria, links them `tests`-kind, the agent runs them, results
   flow back via `specship_link_verify` into the existing enforce gate. One small
   retrieval primitive does the flow-mapping; SpecShip executes nothing.
   Trade-offs: smallest surface, zero new runtime deps, fits the grain and the
   human-gated-skill ethos; "did it really pass" rides the agent's honest
   `link_verify` — but that is exactly today's contract.
2. **SpecShip executes — a `specship behaviour` runner.** A CLI command shells out
   to Playwright/vitest/pytest, parses JUnit/JSON, maps results to requirements,
   auto-flips verified/broken, gates CI. Turnkey, but SpecShip becomes a test
   runner: per-stack result adapters, app-lifecycle (boot dev server, wait-on,
   teardown), new deps, brittle across stacks, and a departure from "no live
   correctness validation — that's the test suite's job".
3. **Generation-only scaffolder.** Emit test skeletons (one `test()` per `.A<N>`,
   criterion as the name, TODO body). Cheapest; gives "same spec → both test
   files" but doesn't run or verify — doesn't close the loop.

**Chosen: 1 (orchestrating skill + primitive).** Closes the full loop
(spec → generate → link → run → verify → gate) while keeping SpecShip a
tracker/retriever — its grain — and reusing the verify chain + the proven
human-gated-skill pattern. Approach 2 is the turnkey dream but a much larger,
stack-specific surface and a philosophy shift; a candidate **phase 2** once the
loop is proven in real repos. Approach 3 is too thin.

## Key decisions
- **Surface:** a **behaviour-surface retrieval primitive** — given a requirement,
  return its linked code **plus** the routes/components/handlers around it,
  grouped **UI vs backend** — plus a new **`/ss-behaviour <REQ-ID>`** slash
  command that runs the full generate → link → run → verify flow. (Exact surface
  for the primitive — a mode on `specship_spec` like triage's `query`, vs a
  dedicated tool — left to spec-author; a skill names its tool deterministically,
  so adoption-by-free-choice doesn't force the decision.)
- **Granularity:** **per acceptance criterion.** Each `.A<N>` bullet → one E2E
  flow/test, linked `kind:tests` at the `.A<N>` level. Finest-grained: pass/fail
  pinpoints the exact behaviour. The enforce check already rolls a requirement's
  acceptance-child test links up, so the requirement-level gate still works.
- **UI vs backend, one spec:** for each criterion the skill authors a **Playwright**
  test when a UI exists and an **API/batch** test for backend paths — both
  derived from the *same* criterion. The same requirement drives both tiers.
- **Gating:** **gate the writes, auto-run after.** Preview the generated test
  files → explicit confirm → write + `link_assert` → then auto-run the suite and
  report `link_verify` outcomes. One checkpoint before anything reaches disk;
  running is non-destructive so it flows. Mirrors `ss-domain` / `ss-triage`.
- **Reuse, don't rebuild:** generated tests land as `tests`-kind links in
  verified/broken state and feed the **existing** `specship check` behaviour
  gate. No new verification state machinery.

## Edge cases & non-goals
- **UI-conditional:** Playwright is authored **only when a UI actually exists**
  (component/route nodes + a detected frontend framework); otherwise the skill
  produces backend/batch tests only. ("If UI exists, then Playwright.")
- **"Couldn't run" ≠ "ran and failed":** a suite that cannot execute (no dev
  server, missing deps, wrong env) must **not** mark links `broken` — that would
  false-fail the CI gate. Report the inability and leave state
  `implemented`/unverified; only a real test failure is `broken`.
- **Runner-agnostic:** detect and **mirror the repo's existing test conventions**
  (Playwright config / `e2e/` dir for UI; vitest/jest/pytest for backend) rather
  than imposing a stack. Ground in existing test files before authoring.
- **Idempotent:** re-running `/ss-behaviour` on a requirement **refreshes**
  existing tests/links rather than duplicating files or links.
- **Acceptance-criterion ↔ test mapping is explicit:** each generated test names
  the `.A<N>` it covers (in the test title and the link target) so a failure is
  traceable to a criterion.
- **Non-goals:** SpecShip does **not** execute or parse test results itself
  (Approach 2, possible phase 2); no app-lifecycle / dev-server orchestration as a
  SpecShip feature (the skill/agent runs per repo conventions); not auto-*fixing*
  a failing behaviour (that's `/ss-implement`); does not author product
  requirements (the spec is the input); no new verification state machine — it
  reuses `tests`-kind links + verified/broken + the enforce gate.

## Acceptance criteria
- A behaviour-surface retrieval call, given a requirement id, returns the
  requirement's linked code plus the surrounding routes/components/handlers,
  grouped into a UI tier and a backend/batch tier; a requirement with no UI
  surface returns an empty UI tier (not an error).
- `/ss-behaviour <REQ-ID>` produces, **per acceptance criterion**, an end-to-end
  test derived from that criterion — a Playwright UI test when a UI exists and/or
  a backend/batch API test — each naming the `.A<N>` it covers.
- Before writing, the flow previews the exact test files it will create and writes
  them only after explicit confirmation; on confirmation it writes the files and
  asserts a `tests`-kind link from each test to its `.A<N>` criterion.
- After writing, the flow runs the relevant suite and records each outcome via the
  verify path: a passing test moves its link to `verified`, a failing test to
  `broken`; a suite that could not be executed is reported as such and leaves the
  link state unchanged (never `broken`).
- The resulting links feed `specship check`'s behaviour gate unchanged: a `broken`
  link fails the gate when behaviour gating is on; an unverified requirement is
  reported as unverified.
- Re-running `/ss-behaviour` on the same requirement refreshes the existing tests
  and links without duplicating files or links, and the generated tests index
  cleanly (`specship sync` reports no error).
- When no UI exists in the project, the flow authors backend/batch tests only and
  does not attempt to generate or run Playwright tests.
