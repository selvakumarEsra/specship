# Optimized AI-assisted development workflow — October 2026 review

**Scope:** review of the latest Claude Code (Fable 5 / Opus 5.5), Gemini CLI (Pro / Flash),
and 2025–26 testing/architecture research, synthesized into a recommended workflow for
spec-driven development with a Python backend and a Playwright-tested frontend.
Grounded against SpecShip's existing baseline (spec lint, behaviour harness,
architecture-fitness rules).

**Date:** 2026-10-10. Sources listed at the bottom; numeric claims from secondary
"2026 guide" sites should be re-verified against primary sources before external quoting.

---

## 1. Tooling landscape — what changed

### Claude Code / Claude 5

- **Workflows (executable JS orchestration) + subagents + skills + hooks** now form a
  complete harness: plans live in code, agents get file-disjoint tasks, verification is
  adversarial (separate verifier agents), and context is externalized (spec, progress
  file, artifacts) so any resumption fetches state in one call.
- Anthropic's published doctrine converges on exactly the spec-driven shape SpecShip
  ships: separate planning from implementation, author the spec first, start a **fresh
  session for implementation** so plan-context doesn't pollute execution.
- TDD with agents requires explicit forcing — agents naturally write code→tests, not
  tests→code.

### Gemini — structural shift (June 2026)

- **Gemini CLI was retired for individual users on 2026-06-18**; free/Pro/Ultra users
  moved to **Antigravity CLI** (`agy`, closed-source, keeps Skills/Hooks/Subagents/
  Extensions). Gemini CLI remains open source and actively released (v0.63.0,
  2026-10-06) but is a supported product only for Code Assist Standard/Enterprise and
  API-key users. This **confirms the ratified 2026-09 agnostic-pivot decision**
  (Antigravity target; gemini CLI legacy).
- **Flash is no longer the "dumb bulk" tier.** Since Gemini 3, Flash ≈ Pro on coding
  benchmarks (≈76% SWE-bench Verified); 3.8 Flash is tuned for long-horizon coding.
  Pro (3.1, Feb 2026) earns its keep only on complex reasoning. Gemini 3.5 Pro was never
  released; the 1,000-req/day free tier is gone.
- **Conductor** (Google's "context-driven development" extension — persistent spec.md +
  plan.md beside code, task-granular revert) is the closest competitor shape to
  SpecShip, and is positioned as a plugin for Antigravity **and Claude Code**.

### Where each engine wins (2026 consensus)

| Task | Engine | Why |
|---|---|---|
| Spec authoring, planning, complex multi-file refactors | Claude Opus 5.5 | best multi-file reasoning + instruction following |
| Scoped implementation, polish | Claude Sonnet 5.5 | sweet spot of speed/quality/cost |
| Hardest reasoning only (resolver synthesis, evals that exceed Opus) | Fable 5.x | premium tier; don't default to it |
| Bulk classification, summaries, work-state evaluation | Haiku | cheapest; also SpecShip's low-end eval bar |
| Huge-context exploration (1M), cheap bulk codegen/review/test triage | Gemini 3.x Flash | ≈Pro coding quality at Flash cost |
| Async self-contained jobs ("clone, fix, test, open PR") | Jules | hand-off leg of the Google stack |

---

## 2. The recommended loop: spec-anchored, gate-enforced

The 2026 landscape splits into **spec-first** (spec discarded after implement — Spec Kit,
Kiro, BMAD) and **spec-anchored** (specs persist and evolve, stay linked to code).
Spec-anchored is where durable workflows are heading — and it is SpecShip's model
(specs + `implementations:` links + drift detection). Keep that bet.

The loop, with the engine/tier per stage:

1. **Spec** (Opus 5.5, interactive) — spec-author; acceptance criteria are the contract.
   *Anti-pattern to guard:* over-specification — Kiro's documented failure turned a bug
   fix into 4 stories/16 criteria. Keep a fast path for small changes
   (`/specship:spec fast` already exists; protect it).
2. **Plan → file-disjoint tasks** (Opus) — plan as executable workflow or checked-off
   plan.md, not held in model context. Fresh session for implementation.
3. **Implement** (Sonnet 5.5 / Gemini Flash for bulk) — tests-first forced by the
   harness, not by hoping the agent does TDD.
4. **Verify** (separate agent + deterministic gates) — the agent that wrote the code
   never solely judges it. Gates below.
5. **Anchor** — link tests and implementations back to criteria (`verified`/`broken`
   state machine); drift detection keeps the spec true.

---

## 3. Testing stack (Python backend + web frontend)

The core 2026 insight: **"who tests the agent's tests"** has a credible answer —
schemas → property fuzzing → mutation testing.

- GenAI test suites average **~85% line coverage but only ~57% mutation kill rate**
  (they check state, not behaviour).
- Property-based testing breaks the "cycle of self-deception" where LLM-written tests
  share the code's flaws (arXiv 2506.18315: 23–37% relative pass@1 gains).
- PBT and example-based tests each catch ~69% of injected bugs alone, **~81% combined**
  (arXiv 2510.25297) — hybrid, not either/or.
- 30–32% of "passing" LLM solutions only partially satisfy correctness properties —
  example tests systematically overstate agent code quality.

### Backend (pytest ecosystem)

| Layer | Tool | Role |
|---|---|---|
| Examples/regressions | pytest | known behaviours; pin PBT finds with `@example` |
| Invariants | Hypothesis | properties per criterion; `RuleBasedStateMachine` for workflow/state bugs; modest `max_examples` in PR CI, large nightly |
| Schema-derived fuzzing | hypothesis-jsonschema / pydantic strategies | fuzz contracts, don't hand-mock them |
| API contract fuzzing | Schemathesis 4 | OpenAPI-driven: documented examples, boundaries, fuzzing, stateful workflows; finds 5xx/validation bypass/use-after-delete; curl repros |
| Test-quality gate | mutmut | diff-scoped in CI, full nightly; gate mutation score on critical modules (auth, money) first; human picks boundary values to break self-confirmation |
| Floor signal | coverage.py (branch) | floor only — mutation score is the real gate |

### Frontend / e2e

- **Split the roles:** Playwright **MCP** is the agent-facing browser for exploration,
  bug repro, and test drafting (`--isolated --caps=testing`, snapshot mode, staging
  only, `--save-trace`); **committed Playwright Test code in CI** is the durable
  artifact. The agent explores; the repo keeps deterministic tests.
- Fixtures around business actions; auth state reused per suite; `getByRole`/
  `getByTestId` locators (enforce in agent prompts too); never `waitForTimeout`;
  tracing `on-first-retry`.
- **Few e2e** — critical paths only; push volume down to Schemathesis/contract tests
  and component tests.
- Component tests: Playwright's experimental-ct packages are deprecated — use
  **Vitest 4 Browser Mode** (stable, 2026 consensus) for components, Playwright for e2e.

---

## 4. Quality & architecture gates (agent-proof CI)

Agents produce diffs faster than humans read them, so boundary review must be mechanical.

| Surface | Gates |
|---|---|
| Python | ruff (fail on new warnings **and on `noqa` comments** — agents silence rules); mypy/pyright strict, strictest on domain/application layers; **import-linter** contracts (layering + "domain imports no fastapi/httpx/sqlite3"); pydantic models as runtime boundary contracts |
| Frontend | eslint (fail on `eslint-disable` too); TypeScript strict; eslint-plugin-boundaries (IDE-time) + dependency-cruiser `--validate` (CI-time: layers, cycles, cross-feature imports) |
| Meta | gates **block, never warn**; test the gates with planted violations; ratchets so debt/complexity only decreases; ADRs that gates cite |

---

## 5. Gap analysis vs SpecShip baseline

SpecShip already owns: spec lint (REQ-AUTHG-001), behaviour harness (criteria →
Playwright + API tests, BEHAVIOUR-DOC), graph-evaluated architecture-fitness rules
(FITNESS-DOC), drift detection, spec↔code↔test links. Gaps the research surfaces:

| # | Candidate | What it adds | Why now |
|---|---|---|---|
| G1 | **Property lane in the behaviour harness** | Criteria phrased as invariants ("MUST never", "for all") generate Hypothesis properties, not just example e2e | hybrid PBT+examples catches 81% vs 69%; criteria are already the contract |
| G2 | **Mutation-score gate on spec-linked tests** | `specship check` extension: a criterion's `tests` link counts as *verified* only if its tests kill mutants in the linked implementation (diff-scoped mutmut/Stryker) | closes the 85%-coverage/57%-kill gap; directly answers "who tests the agent's tests" |
| G3 | **Contract-fuzz lane for API-backed criteria** | Route-kind nodes already exist in the graph; wire criteria on routes to a Schemathesis run against the OpenAPI schema | cheapest high-yield backend gate; zero hand-written tests |
| G4 | **Model-tier routing in the implement pipeline** | spec-author/plan on Opus-class, implement legs on Sonnet/Flash-class, verify legs on cheap models — consistent with the low-end mandate (works great under Haiku/Flash) | Flash ≈ Pro on coding since Gemini 3; paying Opus prices for scoped legs is waste |
| G5 | **Disable-comment detection in the check gate** | Flag new `noqa` / `eslint-disable` / `@ts-ignore` in diffs the implement pipeline produces | documented agent behaviour: silencing rules instead of fixing them |

Confirmed, no action: the Antigravity-over-Gemini-CLI pivot (June 2026 retirement for
individuals validates it); spec-anchored over spec-first; Conductor confirms the
category but SpecShip's persistent graph links are the moat Conductor lacks.

## 6. Removal / cleanup lane

- **Gemini CLI target:** keep as the ratified legacy exception, but **freeze** —
  don't build GEMINI.md steering or TOML commands (still unbuilt); the individual
  installed base moved to Antigravity in June 2026. Antigravity is the ratified next
  target; Jules stays out of scope.
- **Don't add a spec-as-source lane:** Tessl paused its framework — the approach is
  effectively dead; SpecShip's spec-anchored links are the right altitude.
- **Guard against over-specification:** any new gate (G1–G5) must be opt-in per spec or
  scale with change size — the Kiro "sledgehammer for a nut" failure mode is the
  category's top critique. Trivial changes keep the fast path.
- **Coverage-% claims:** never gate or market on line coverage alone; it's a floor
  signal the research explicitly discredits as a quality claim (BENCH-CLAIM discipline
  applies).

## Sources

- Anthropic: [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices) · [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [Models overview](https://docs.anthropic.com/en/docs/about-claude/models/overview)
- Google: [Gemini CLI retirement discussion](https://github.com/google-gemini/gemini-cli/discussions/27274) · [gemini-cli repo](https://github.com/google-gemini/gemini-cli) · [Conductor](https://github.com/gemini-cli-extensions/conductor) · [Gemini 3 Flash in Gemini CLI](https://developers.googleblog.com/gemini-3-flash-is-now-available-in-gemini-cli/)
- Testing research: [arXiv 2506.18315 (Property-Generated Solver)](https://arxiv.org/abs/2506.18315) · [arXiv 2510.25297 (PBT + example hybrid)](https://arxiv.org/abs/2510.25297) · [Schemathesis](https://schemathesis.readthedocs.io/) · [mutmut on AI-generated tests](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code) · [Playwright CT deprecation](https://github.com/microsoft/playwright/issues/42139)
- SDD landscape: [SDD comparison](https://github.com/RSMuthu/SDD-comparison) · [spec-compare](https://github.com/cameronsjo/spec-compare) · Thoughtworks/Böckeler critique of over-specification
- Gates: [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) · [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) · [import-linter](https://import-linter.readthedocs.io/)
