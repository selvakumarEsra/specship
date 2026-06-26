# Positioning: SpecShip as harness engineering

**Status:** Strategy / positioning narrative. The *what* (actionable
requirements) lives in the `STRATEGY-DOC` spec
(`specs/harness-engineering-strategy.md`); this is the *why* — the analysis that
produced those three expansion lanes.

**Source frame:** Martin Fowler, *Harness Engineering for Coding Agents* —
https://martinfowler.com/articles/harness-engineering.html

---

## The frame in one paragraph

Fowler's thesis is a single equation — **`Agent = Model + Harness`** — where the
harness is *everything around the model that lets you trust its output with less
supervision*. He organizes it on two axes plus three quality dimensions:

- **Direction:** **guides** (feedforward — steer *before* the agent acts: docs,
  rules, configs) vs **sensors** (feedback — observe *after* and self-correct:
  tests, review, drift checks).
- **Execution:** **computational** (deterministic, CPU, milliseconds — linters,
  type-checkers, structural analysis) vs **inferential** (LLM-as-judge, AI review
  — semantically rich but slow and non-deterministic).
- **Three regulation harnesses:** **maintainability** (complexity, duplication,
  coverage, style — most mature), **architecture fitness** (fitness functions,
  performance, observability), **behaviour** (functional correctness — *least*
  mature).
- Plus: **"keep quality left"** (distribute checks across the lifecycle),
  **harnessability / ambient affordances** (how legible the codebase already is
  to agents — typing, module boundaries), **harness templates** (reusable
  guide+sensor bundles per service topology), and **Ashby's Law / variety
  reduction** — *a regulator can only regulate what it has a model of.*

## Where SpecShip sits

> SpecShip is **the deterministic, computational substrate of the harness *and*
> the model-of-the-system that Ashby's Law demands** — the legibility layer (the
> knowledge graph), the intent layer (specs), the drift sensor, and a
> self-improving loop that turns sensors back into guides.

It is *not* a maintainability-metrics engine, an architecture-fitness runtime, or
a test generator. The article describes the discipline SpecShip is already an
instrument of — which makes it an unusually clean positioning fit.

## Coverage map

| Harness element (article) | SpecShip | What does it |
|---|---|---|
| Guides — context / legibility | ✅ strong | knowledge graph + `specship_explore`/MCP: the agent explores structurally instead of re-reading |
| Guides — intent / contract | ✅ strong | specs + acceptance criteria + spec↔code links; `/ss-implement` follows the contract |
| Guides — durable rules | ✅ distinctive | the reflection engine writes CLAUDE.md rules / memory / skills / hooks |
| Sensors — behaviour / intent | ✅ leading | spec↔code drift (drifted/broken/orphaned) — the article's *least-mature* dimension, where SpecShip is ahead |
| Sensors — behaviour observation | ✅ | Claude Code analytics, tips, SpecShip Impact (token / read-displacement), `affected` test-selection |
| Computational execution | ✅ core strength | everything is AST-derived, SQLite, sub-millisecond, local-first |
| Harnessability / ambient affordances | ✅ key | SpecShip *retrofits* legibility onto any repo — even untyped ones — rather than requiring an agent-legible codebase |
| Ashby — "model of the system" | ✅ key | the graph *is* the requisite-variety model; specs are the model of intent |
| Human-in-the-loop direction | ✅ | workflow approval gates, preview-diff→confirm apply, drift queue, spec review |
| Sensor→guide feedback loop | ✅ beyond the article | reflection mines transcripts → proposes durable guides; the article treats harness-building as *manual* |
| "Keep quality left" — pre-integration | 🟡 partial | live MCP context + ~1s-lag drift, but advisory, not gating |
| Maintainability harness | ❌ gap | graph could compute fan-in/out, god-files, cycles — none surfaced today → REQ-STRATEGY-001 |
| Architecture-fitness functions | ❌ gap | graph + impact could power layering/dependency rules — not shipped → REQ-STRATEGY-002 |
| Inferential sensors (LLM-as-judge) | ❌ delegated | SpecShip hands inference to the agent; workflows could orchestrate judges but ship none |
| Test generation / execution / verification | 🟡 partial | spec-as-contract + `affected`, but no test gen/run/judge → REQ-STRATEGY-003.A3 |
| Post-integration CI pipeline | 🟡 partial | feeds CI (`affected`, git hooks) but isn't the orchestrator → REQ-STRATEGY-003 |
| Harness templates per topology | 🟡 emergent | bundled workflows + reflection-proposed skills/hooks, not productized per service shape |
| Continuous monitoring beyond spec-drift | ❌ gap | drift is spec-only (no dead-code / dep-vuln / SLO) |

## The two findings that matter

1. **SpecShip *informs*; a harness *enforces*.** Drift, impact, tips, and Impact
   surface signal but don't gate — nothing fails CI on drift, no
   maintainability/architecture check blocks a merge. The frame makes the
   expansion obvious: from "code-intelligence + context" → "the deterministic
   control plane that gates AI-assisted change." (→ REQ-STRATEGY-003.)

2. **SpecShip already closes a loop the article doesn't name.** Fowler treats
   harness construction as ongoing *manual* engineering; SpecShip's reflection
   engine is a first cut at his own open question — *systemic tooling for
   configuring distributed controls* — by auto-proposing the hooks/skills/rules.
   That sensor→guide loop is a defensible wedge.

## End-to-end positioning

> **SpecShip is the system-of-record and control plane for AI-assisted
> development** — it holds the *model* of the code (graph) and the *intent*
> (specs), serves *guides* (context + contract + learned rules), runs *sensors*
> (drift + analytics), closes the *loop* (reflection → durable guides), and
> *directs human attention* (gates, drift queue, Improvements).

It already touches every SDLC stage — rare:

```
brainstorm (/ss-brainstorm) → spec (/ss-spec-author) → implement (workflows, worktrees)
   → verify (drift, spec↔code links, affected tests) → operate (analytics, Impact, cost)
   → improve (reflection → self-updating guides) → ↺
```

**Four differentiators to lean on:**

1. Deterministic + local-first computational backbone.
2. A *unified* model of system **and** intent — Ashby's requisite variety; most
   tools have one or neither.
3. The *self-improving* sensor→guide loop.
4. *spec↔code drift as a first-class behaviour sensor* — the dimension the
   article calls least mature.

**The three expansion lanes** (detailed as requirements in `STRATEGY-DOC`):

1. **Maintainability harness** (REQ-STRATEGY-001) — surface
   complexity/coupling/cycles/god-files from the graph. Cheapest, computational,
   immediately credible.
2. **Architecture-fitness functions** (REQ-STRATEGY-002) — declare
   layering/dependency/boundary rules, check them against the graph in CI. The
   highest-leverage land-grab: executable architecture rules for agents are
   largely unowned.
3. **Enforcement teeth + behaviour chain** (REQ-STRATEGY-003) — checks that
   *fail CI*, and own the spec→test→verify chain. The advisory→gating shift.

## Honest caveat

"The harness" is agent-agnostic and implies enforcement; SpecShip is
Claude-Code-only and advisory-by-default. So the *defensible* claim today is
narrower and sharper than "the whole harness":

> **the deterministic model + drift sensor + self-improving guide layer of your
> Claude Code harness** — expanding toward control-plane and enforcement.

Claiming "the part of the harness nobody else has — the unified model + spec
drift + reflection loop" is true and distinctive. Claiming the whole harness
today would over-reach.
