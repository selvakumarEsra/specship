---
id: STRATEGY-DOC
title: Harness-engineering expansion (maintainability · architecture-fitness · enforcement)
owner: core
priority: medium
version: 1
---

<!-- id: STRATEGY-DOC -->
# Harness-engineering expansion

A roadmap captured as a spec. The framing comes from Martin Fowler's
*Harness Engineering for Coding Agents*
(https://martinfowler.com/articles/harness-engineering.html): **Agent = Model +
Harness**, where a harness combines **guides** (steer before the agent acts) and
**sensors** (observe after, to self-correct), executed **computationally**
(deterministic, fast) or **inferentially** (LLM-as-judge), across three quality
dimensions — **maintainability**, **architecture fitness**, and **behaviour** —
and where, per Ashby's Law, *a regulator can only regulate what it has a model
of*.

Against that frame, SpecShip today is strong on the **model** (the knowledge
graph), the **guides** (graph context + specs + reflection-written
rules/skills/hooks), and the **behaviour sensor** (spec↔code drift), and it
uniquely closes a **sensor→guide loop** (the reflection engine). It is light on
two of the three quality harnesses and on **enforcement**: its checks mostly
*inform* rather than *gate*.

These three requirements are the expansion lanes that move SpecShip from "code
intelligence + context" toward "the deterministic control plane that gates
AI-assisted change." All three are **graph-powered, deterministic, and
local-first** — on-brand, and each reuses the existing index rather than adding
a parsing pass. They are intentionally `SHOULD`: strategic direction, not
release-blocking commitments.

<!-- id: REQ-STRATEGY-001 -->
## SpecShip SHOULD expose a maintainability harness derived from the graph

SpecShip SHOULD surface deterministic maintainability signals computed from the
existing knowledge graph — structural complexity, coupling, and size hotspots —
so an agent or human can see where a change adds risk, without SpecShip running
any new parse or external tool. This is the article's most mature harness
dimension and the cheapest lane to land credibly, because the edges and node
metadata already exist.

## Acceptance
<!-- id: REQ-STRATEGY-001.A1 -->
- A maintainability surface (CLI command and/or MCP tool and/or dashboard page)
  reports, per file and per symbol, at least: fan-in / fan-out (edge degree),
  symbol count / size hotspots, and dependency cycles — all derived from the
  existing graph with no new extraction pass.
<!-- id: REQ-STRATEGY-001.A2 -->
- The signals are deterministic: re-running against an unchanged index returns
  byte-identical results.
<!-- id: REQ-STRATEGY-001.A3 -->
- Each reported signal is actionable: it names the offending file/symbol and the
  threshold or rank that flagged it, surfaced where the agent/human already looks
  (MCP response + dashboard), not a separate report nobody reads.
<!-- id: REQ-STRATEGY-001.A4 -->
- On a repository with no flagged hotspots, the surface returns an explicit
  "clean" result rather than an empty/ambiguous one.

<!-- id: REQ-STRATEGY-002 -->
## SpecShip SHOULD provide executable architecture-fitness functions over the graph

SpecShip SHOULD let a project declare architecture rules — allowed/forbidden
dependency directions, layer boundaries, module isolation — and evaluate them
deterministically against the knowledge graph, reporting concrete violations.
This is the highest-leverage lane: executable architecture rules scoped to what
an agent may build are largely unowned in the market, and the graph's edges are
exactly the substrate fitness functions need.

## Acceptance
<!-- id: REQ-STRATEGY-002.A1 -->
- A user can declare architecture-fitness rules in a checked-in config (e.g.
  "module A MUST NOT import module B", "layer X may depend only on layer Y").
<!-- id: REQ-STRATEGY-002.A2 -->
- SpecShip evaluates each rule against the graph and reports every violation with
  the offending edge — source → target, qualified names, and `file:line`.
<!-- id: REQ-STRATEGY-002.A3 -->
- The evaluation runs headlessly via the CLI and exits non-zero when any rule is
  violated, so it can gate CI without the dashboard.
<!-- id: REQ-STRATEGY-002.A4 -->
- A rule whose source or target matches no node/edge in the graph surfaces as a
  configuration error, not a silent pass, so a typo can never produce a
  false-green.

<!-- id: REQ-STRATEGY-003 -->
## SpecShip SHOULD offer an enforcing mode that fails CI on harness violations

SpecShip SHOULD provide an enforcing mode — distinct from today's advisory
surfaces — in which selected harness checks return a non-zero exit so they can
block a merge, and SHOULD make the **behaviour** dimension the highest-value
thing to gate by closing the spec→test→verify chain (acceptance criteria become
checkable behaviour gates). This converts SpecShip from a tool that *informs*
into one that *enforces*, which is what "harness" implies.

## Acceptance
<!-- id: REQ-STRATEGY-003.A1 -->
- A single headless command runs a configured set of harness checks (spec↔code
  drift, architecture-fitness from REQ-STRATEGY-002, maintainability thresholds
  from REQ-STRATEGY-001) and exits non-zero if any selected check fails — usable
  as a CI gate.
<!-- id: REQ-STRATEGY-003.A2 -->
- Which checks are gating versus advisory is configurable per project, so a team
  can adopt enforcement incrementally without all checks blocking on day one.
<!-- id: REQ-STRATEGY-003.A3 -->
- For the behaviour dimension, a spec's acceptance criteria can be linked to
  verifying tests, and the gate fails when a criterion has no passing verifying
  test (a drifted/unverified requirement blocks rather than silently passing).
<!-- id: REQ-STRATEGY-003.A4 -->
- Enforcement is opt-in: with no gating configuration, SpecShip behaves exactly
  as today (advisory only), so the enforcing mode never breaks existing users.
