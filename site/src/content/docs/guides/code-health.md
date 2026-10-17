---
title: Architecture & Code Health
description: Declare architecture-fitness rules and maintainability thresholds in specship.config.json, and check them with specship fitness, specship maintainability, the specship_health MCP tool, and the enforcement gate.
---

SpecShip can check your code's structure against rules you write down, using the same graph it builds for retrieval. There's no extra parse, and the results are deterministic, with `file:line` locations. There are two kinds of report:

- **Architecture fitness**: rules about which parts of the code may depend on which.
- **Maintainability**: oversized symbols, god files, dependency cycles, coupling hotspots and dead-code candidates.

| Where | Fitness | Maintainability |
|---|---|---|
| CLI | `specship fitness` | `specship maintainability` (alias `maint`) |
| Claude Code (MCP) | `specship_health` with `checks: ["fitness"]` | `specship_health` with `checks: ["maintainability"]` |
| Slash command | `/specship:check health` | `/specship:check health` |
| Enforcement gate | the `fitness` check in `specship check` | the `maintainability` check in `specship check` |

`specship_health` returns both reports when you don't pass `checks`. It's read-only and auto-allowed by the installer, so the agent can run it while exploring without a permission prompt.

## Architecture-fitness rules

Declare rules under `fitness.rules` in `specship.config.json` at the project root. Selectors are globs over project-relative file paths, so the same rule works in any language. There are three rule types:

```json
{
  "fitness": {
    "rules": [
      { "type": "forbidden", "name": "ui-not-db", "from": "src/ui/**", "to": "src/db/**" },
      {
        "type": "layers",
        "name": "layering",
        "layers": { "api": "src/api/**", "domain": "src/domain/**", "infra": "src/infra/**" },
        "allow": { "api": ["domain"], "infra": ["domain"], "domain": [] }
      },
      { "type": "isolation", "name": "utils-is-a-sink", "module": "src/utils/**", "mode": "sink" }
    ]
  }
}
```

| Type | Fields | Violation |
|---|---|---|
| `forbidden` | `from`, `to` | Any dependency from a file matching `from` to a file matching `to`. |
| `layers` | `layers` (layer → selector; first match wins, in config order), `allow` (layer → layers it may depend on) | A dependency from one layer to a layer it isn't allowed to use. A layer can always depend on itself. |
| `isolation` | `module`, `mode` | `leaf`: something outside the module depends on it. `sink`: the module depends on something outside it. |

Every graph relationship except containment and exports counts as a dependency, including calls, imports, inheritance, type references and instantiation. Each violation names the rule, the source and target symbols, and the source location.

A rule whose selector matches no indexed file is reported as a **config error**, not a pass, so a typo in a glob can't hide a broken rule.

```bash
specship fitness          # exits non-zero on any violation or config error
specship fitness --json
```

With no rules declared, `specship fitness` says so and exits 0.

## Maintainability signals

```bash
specship maintainability            # oversized symbols, god files, dependency cycles
specship maintainability --deep     # + coupling hotspots and dead-code candidates
specship maintainability --strict   # exit non-zero if any signal has findings
```

The default report shows only the high-precision signals: oversized symbols, god files and dependency cycles. Coupling hotspots and dead-code candidates are lower-confidence (dynamic dispatch and name collisions produce false positives), so they appear only with `--deep`. `--json` always returns the full set, with each signal labelled by tier.

Tune the thresholds and add exclusions in `specship.config.json`:

```json
{
  "maintainability": {
    "thresholds": { "highDegree": 20, "largeSymbolLines": 200, "godFileSymbols": 40 },
    "exclude": ["src/generated/**"]
  }
}
```

| Threshold | Default | Flags |
|---|---|---|
| `highDegree` | `20` | A symbol or file with at least this many incoming or outgoing dependencies (a coupling hotspot) |
| `largeSymbolLines` | `200` | A symbol spanning at least this many lines (oversized) |
| `godFileSymbols` | `40` | A file defining at least this many symbols (god file) |

Generated and vendored files — `*.d.ts`, `*.min.js`, `dist/`, `build/`, `vendor/`, bundler chunks and the like — are excluded by default. `maintainability.exclude` adds to that list rather than replacing it.

## Gating in CI

Both reports are checks in the [enforcement gate](/specs/quality-gates/). Like every check there, they're advisory until you opt in:

```bash
specship check --enable-gate fitness maintainability
```

Once gated, `fitness` fails on any violation or config error. `maintainability` fails only on its high-precision signals, so coupling and dead-code candidates are listed but never fail the build. Both always cover the whole repository, even when `specship check --since <ref>` narrows the spec checks to a change.
