---
id: FITNESS-DOC
title: Architecture-fitness functions (graph-evaluated rules)
owner: core
priority: medium
version: 1
---

<!-- id: FITNESS-DOC -->
# Architecture-fitness functions

The implementable spec for the second harness-engineering expansion lane,
`REQ-STRATEGY-002` (see `specs/harness-engineering-strategy.md`). It lets a
project declare architecture rules and evaluate them deterministically against
the **knowledge graph**, reporting concrete violations — the highest-leverage
lane, because executable architecture rules scoped to what an agent may build
are largely unowned, and the graph's edges are exactly the substrate such rules
need.

Rules are declared in a **standalone, checked-in declarative config** (e.g.
`.specship/architecture.yaml`) — language-agnostic, no code, CI-friendly.
(Expressing rules *as specs* is a documented future option, not v1.) v1 supports
three edge-constraint rule types: forbidden dependency, layering allow-list, and
module isolation/boundary. The check can gate CI on its own and is also composed
by the enforcement command (`ENFORCE-DOC` / `REQ-STRATEGY-003`).

Integration points (no new extraction): import/call edges via
`QueryBuilder.getOutgoingEdges`/`getIncomingEdges` and `GraphQueryManager`, with
nodes grouped by `file_path` / `qualified_name` to resolve module and layer
membership; surfaced through the CLI (`src/bin/specship.ts`) and an MCP tool
(`src/mcp/tools.ts`).

<!-- id: REQ-FITNESS-001 -->
## SpecShip MUST let a project declare architecture rules in a checked-in config

A project declares its architecture rules in a checked-in declarative config.
v1 supports three rule types, each a constraint over dependency edges, with
targets addressable in a language-agnostic way (file globs / directory or module
paths / qualified-name patterns).

implementations:
  - src/fitness/fitness.ts:loadFitnessRules

## Acceptance
<!-- id: REQ-FITNESS-001.A1 -->
- A **forbidden-dependency** rule can be declared: "module/dir A MUST NOT import
  or call into module/dir B."
<!-- id: REQ-FITNESS-001.A2 -->
- A **layering allow-list** rule can be declared: named layers with the allowed
  dependency edges between them; any dependency not on the allow-list is a
  violation.
<!-- id: REQ-FITNESS-001.A3 -->
- A **module isolation / boundary** rule can be declared: e.g. only a module's
  declared public surface may be depended on from outside it, or a module is a
  leaf (nothing may depend on it) / a sink (it may depend on nothing).
<!-- id: REQ-FITNESS-001.A4 -->
- Rule targets are addressable without naming language internals — by file glob,
  directory/module path, or qualified-name pattern — so the same config form
  works across the languages SpecShip indexes.

<!-- id: REQ-FITNESS-002 -->
## SpecShip MUST evaluate the rules against the graph and report concrete violations

SpecShip evaluates each declared rule against the knowledge graph's dependency
edges and reports every violation with the offending edge, deterministically. A
rule that matches nothing is treated as a configuration error, never a silent
pass.

implementations:
  - src/fitness/fitness.ts:evaluateFitness

## Acceptance
<!-- id: REQ-FITNESS-002.A1 -->
- Each rule is evaluated against the graph's import/call edges, and every
  violating edge is reported with its source → target qualified names and
  `file:line`.
<!-- id: REQ-FITNESS-002.A2 -->
- Evaluation is deterministic: re-running against an unchanged index returns
  byte-identical results.
<!-- id: REQ-FITNESS-002.A3 -->
- A rule whose source or target selector matches no node/edge in the graph
  surfaces as a configuration error (so a typo or stale path can never produce a
  false-green), not a silent pass.
<!-- id: REQ-FITNESS-002.A4 -->
- A repository that satisfies every rule returns an explicit "all rules pass"
  result rather than an empty/ambiguous one.

<!-- id: REQ-FITNESS-003 -->
## SpecShip MUST expose the check headlessly with a CI-gating exit code

The fitness check runs headlessly so it can gate CI on its own, and is also
reachable by the agent through an MCP tool.

implementations:
  - src/mcp/fitness-tool.ts:handleSpecshipFitness

## Acceptance
<!-- id: REQ-FITNESS-003.A1 -->
- A headless CLI command runs the evaluation and emits both a human-readable
  summary and a `--json` form, with no dashboard required.
<!-- id: REQ-FITNESS-003.A2 -->
- The command exits non-zero when any rule is violated and exits zero when all
  rules pass, so it can gate CI directly.
<!-- id: REQ-FITNESS-003.A3 -->
- An MCP tool returns the same violation report to the agent, so it can check
  architecture conformance before committing.
