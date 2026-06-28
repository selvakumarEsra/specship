---
id: HEALTH-GATEWAY-DOC
title: Code-health report is a trustworthy gateway, not a noise flood
owner: core
priority: high
version: 1
---

<!-- id: HEALTH-GATEWAY-DOC -->
# Code-health gateway

After retrieval earns trust, read-only code-health (`specship maintainability` +
impact) is the natural second hit — it needs no specs and runs on any indexed
repo. But a gateway feature only works if its first impression is high-signal.
Today the default report floods: on a mid-size repo it surfaces ~1,000 dead-code
candidates, and the coupling list is topped by method-name-collision artifacts
(common names like `set` / `now` / `all` aggregated across unrelated
definitions). That noise erodes the very trust the wedge built.

This scopes the **default** code-health report to the finding classes that are
demonstrably precise, capped and ranked, and demotes the noisy classes to opt-in
depth until they meet a precision bar. No analysis is removed — only re-gated by
trustworthiness.

<!-- id: REQ-HEALTH-001 -->
## The default report MUST show only the high-precision finding classes, ranked and capped

By default, the code-health report surfaces the finding classes whose precision
is gateway-grade — oversized symbols, god files, and dependency cycles — ranked
by severity and capped to a small top-N, with an explicit indicator when more
exist.

implementations:
- src/graph/maintainability.ts:highPrecisionClean

## Acceptance
<!-- id: REQ-HEALTH-001.A1 -->
- The default report includes oversized symbols, god files, and dependency
  cycles, each ranked by its severity measure (size, symbol count, cycle length).
<!-- id: REQ-HEALTH-001.A2 -->
- Each class is capped to a small top-N; when more findings exist, the report
  states how many were withheld rather than silently truncating.
<!-- id: REQ-HEALTH-001.A3 -->
- A repo with no high-precision findings reports a clean result, not an empty or
  error state.

<!-- id: REQ-HEALTH-002 -->
## Noisy finding classes MUST be opt-in until they meet a precision bar

Dead-code candidates and raw coupling are excluded from the default report and
shown only on explicit request, because their current precision (volume and
name-collision artifacts) is below gateway grade.

## Acceptance
<!-- id: REQ-HEALTH-002.A1 -->
- The default report does not include dead-code candidates or the raw coupling
  list.
<!-- id: REQ-HEALTH-002.A2 -->
- An explicit flag (e.g. a `--deep` / `--all` request) surfaces dead-code and
  coupling, clearly labelled as lower-confidence.
<!-- id: REQ-HEALTH-002.A3 -->
- When shown, coupling findings identify a single concrete definition
  (file + symbol), never a bare name aggregated across unrelated definitions — a
  finding that cannot be attributed to one definition is not reported.

<!-- id: REQ-HEALTH-003 -->
## The machine-readable output MUST preserve full findings for tooling

The capping and demotion are presentation defaults for humans; a JSON/`--json`
consumer can still obtain the complete finding set so CI and dashboards are not
silently starved.

## Acceptance
<!-- id: REQ-HEALTH-003.A1 -->
- `--json` returns the full set of findings for every class (including dead-code
  and coupling), not the capped human view.
<!-- id: REQ-HEALTH-003.A2 -->
- The JSON distinguishes the high-precision classes from the lower-confidence
  ones so a consumer can choose which to gate on.
