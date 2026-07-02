---
id: ENFORCE-DOC
title: Enforcement mode (gating harness + behaviour chain)
owner: core
priority: medium
version: 2
---

<!-- id: ENFORCE-DOC -->
# Enforcement mode

The implementable spec for the third harness-engineering expansion lane,
`REQ-STRATEGY-003` (see `specs/harness-engineering-strategy.md`). It is the
advisory→gating shift: today SpecShip *informs* (drift queue, Impact, tips); a
harness *enforces*. Enforcement mode composes SpecShip's checks into a single
headless gate that can fail CI, and closes the **behaviour** chain — the
article's least-mature dimension — by reusing the existing spec-link state
machine.

It composes the other two lanes — spec↔code **drift** (already shipped),
**architecture fitness** (`FITNESS-DOC`), and **maintainability** thresholds
(`MAINT-DOC`) — plus the **behaviour** gate defined here. Enforcement is
strictly **opt-in**: with no gating configuration, SpecShip behaves exactly as
it does today (advisory only), so existing users are never broken.

Integration points (no new extraction): spec-link states via
`SpecQueries.getLinksByState` (`drifted`/`broken`/`verified`), a `verifies` link
kind connecting an acceptance criterion to a test symbol, the existing
`affected` test engine, and the per-lane checks above; surfaced through a single
CLI command (`src/bin/specship.ts`).

<!-- id: REQ-ENFORCE-001 -->
## SpecShip MUST provide a single headless command that gates on harness checks

A single command runs the configured harness checks — spec↔code drift,
architecture fitness, maintainability thresholds, and the behaviour gate — and
exits non-zero if any gating check fails, so it is usable as one CI step or git
hook.

implementations:
  - src/enforce/enforce.ts:evaluateEnforcement

## Acceptance
<!-- id: REQ-ENFORCE-001.A1 -->
- A single headless command runs the configured set of checks and exits non-zero
  when any check scoped as gating fails; it exits zero when all gating checks
  pass.
<!-- id: REQ-ENFORCE-001.A2 -->
- The command runs without the dashboard and emits a `--json` form, so it drops
  into a CI step or a git hook.
<!-- id: REQ-ENFORCE-001.A3 -->
- On failure the output names each failing check and its specific findings (which
  drifted link, which fitness rule, which maintainability hotspot, which
  unverified requirement).

<!-- id: REQ-ENFORCE-002 -->
## SpecShip MUST make enforcement opt-in and incrementally adoptable

Which checks gate versus merely advise is configured per project, and the
default with no configuration is advisory-only, so turning SpecShip on in an
existing repo never breaks a build on day one.

implementations:
  - src/enforce/enforce.ts:loadEnforceConfig

## Acceptance
<!-- id: REQ-ENFORCE-002.A1 -->
- Whether each check is gating or advisory is configurable per project.
<!-- id: REQ-ENFORCE-002.A2 -->
- With no gating configuration present, the command reports advisory findings and
  exits zero — identical in effect to SpecShip's behaviour today.
<!-- id: REQ-ENFORCE-002.A3 -->
- A team can enable gating one check at a time; enabling one check does not
  implicitly enable the others.

<!-- id: REQ-ENFORCE-003 -->
## SpecShip MUST gate on a spec→test→verify behaviour chain

A requirement's acceptance criteria are linked to verifying tests, and the
behaviour gate fails when a gated requirement is unverified or its verification
is broken — reusing the existing spec-link state machine rather than inventing a
parallel one. (The `verifies` link is realized by the existing `tests` link kind
in the `verified`/`broken` state.)

implementations:
  - src/enforce/enforce.ts:evaluateEnforcement

## Acceptance
<!-- id: REQ-ENFORCE-003.A1 -->
- An acceptance criterion can be linked to a verifying test symbol via a
  `verifies` link.
<!-- id: REQ-ENFORCE-003.A2 -->
- The behaviour gate fails when a gated criterion's `verifies` link is in the
  `broken` state (the test ran and failed).
<!-- id: REQ-ENFORCE-003.A3 -->
- The behaviour gate fails when a gated requirement has no acceptance criterion
  in the `verified` state — an unverified requirement blocks rather than silently
  passing.
<!-- id: REQ-ENFORCE-003.A4 -->
- A requirement explicitly marked out of behaviour-gating scope is skipped, so
  not every spec must carry tests before the gate can be turned on anywhere.

<!-- id: REQ-ENFORCE-004 -->
## SpecShip MUST provide a graduation ramp from advisory to gating

Opt-in gating without a route to it leaves the gate permanently toothless for
the solo-dev wedge, who never hand-edits `specship.config.json`. The advisory
default stays (REQ-ENFORCE-002 is unchanged); the ramp gives it three exits:
the advisory report sells the gate with the exact opt-in command, a `--strict`
flag gates one run without persistent config, and the spec-driven (`--sdd`)
install asks once with gating recommended on.

implementations:
  - src/enforce/enforce.ts:strictEnforceConfig
  - src/enforce/enforce.ts:enableGateChecks
  - src/installer/index.ts:runInstallerWithOptions

## Acceptance
<!-- id: REQ-ENFORCE-004.A1 -->
- An advisory run whose findings would fail a gated run ends its report with
  the exact command that enables gating for each failing check; the command
  writes the config itself — the user is never told to hand-edit JSON.
<!-- id: REQ-ENFORCE-004.A2 -->
- `specship check --strict` treats every check as gating for that run only,
  with no persistent configuration required or written.
<!-- id: REQ-ENFORCE-004.A3 -->
- The `--sdd` install asks once whether to gate the drift and behaviour checks,
  with yes as the recommended default; declining leaves the install
  advisory-only.
<!-- id: REQ-ENFORCE-004.A4 -->
- With no configuration and no flags the command still reports advisory
  findings and exits zero — the ramp does not weaken REQ-ENFORCE-002.
