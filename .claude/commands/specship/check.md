---
description: Gate & health door — run the enforcement gate, review the drift queue, repair a drifted/broken/orphaned link, or see code-health. No arg = the gate; `drifted`/`fix`/`relink`/`health` run the matching flow.
argument-hint: "(no arg = gate) | drifted | fix <SPEC_ID> | relink <SPEC_ID> | health"
allowed-tools: Bash, mcp__specship__specship_drifted, mcp__specship__specship_spec, mcp__specship__specship_link_verify
---

# SpecShip Check: `$ARGUMENTS`

The **gate & health door** — verify intent against code and keep the spec↔code
links honest. Route on the first token of `$ARGUMENTS`.

## Dispatch

- **(no argument)** → run the enforcement gate:
  ```bash
  specship check
  ```
  Composes spec↔code drift, architecture fitness, maintainability, and the
  spec→test→verify behaviour chain. Strictly opt-in gating — with no `enforce`
  config it only advises and exits 0. Summarize the gated failures, if any.
- **`drifted`** → the review queue: call `mcp__specship__specship_drifted`
  (optional `state` filter) for links that are drifted (spec or code changed),
  broken (verification failed), or orphaned (target symbol gone).
- **`fix <SPEC_ID>`** → repair a drifted/broken link via the bundled workflow:
  ```bash
  specship workflow run spec-fix --input SPEC_ID=<ID>
  ```
  Diagnoses (spec hash vs code signature vs failing test) → approve → apply →
  `specship_link_verify` back to `verified`.
- **`relink <SPEC_ID>`** → for an **orphaned** link (the target symbol no longer
  exists): re-point it at the symbol's new location/name, then re-assert.
- **`health`** → graph-derived code health:
  ```bash
  specship maintainability
  ```
  Shows the high-precision findings (oversized symbols, god files, dependency
  cycles), ranked and capped. Add `--deep` for the lower-confidence dead-code and
  coupling findings; `--json` for the full tagged set (CI).
- **any other free text** (not a `SPEC_ID`, not one of the verbs above) → the
  user brought a failing behaviour to the gate but it isn't a known route. Don't
  fail or behave undefined — hand it to triage, the single failure intake:
  `/specship:spec triage <text>`. Triage decides whether it's drift (and routes
  back here to `fix`) or a spec change.

## After running tests against a spec link

Report the outcome with `mcp__specship__specship_link_verify`
(`result: "pass" | "fail"`) so the link moves to `verified` (or `broken`).
