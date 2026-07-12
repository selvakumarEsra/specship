---
id: STEER-HOOK-DOC
title: Retrieval steering hook at install
owner: installer
priority: high
---

<!-- id: STEER-HOOK-DOC -->
# Retrieval steering hook at install

Dynamic-dispatch coverage is repeatedly validated by probes but goes unused
because the agent never picks the tool ("agent A/B null — adoption-gated",
the recurring wall in the coverage matrix). The only channel that measurably
fixed adoption was high-salience per-run steering (`--append-system-prompt`:
excalidraw call count 3–10 → 3–4, trace adoption 4/4, best run 0-Read/51s);
low-salience channels (MCP initialize instructions, tool descriptions) failed
across 3 variants. Decision (2026-07-11 product review, Q4): ship that
high-salience channel as an installer-written `UserPromptSubmit` hook — the
same mechanism SDD steering already uses (SDD-INSTALL-DOC) — default-on,
opt-outable, and gated on an A/B reproducing the measured win.

<!-- id: REQ-STEER-001 -->
## `specship install` MUST provision a retrieval-steering prompt hook

The installer writes a `UserPromptSubmit` hook (idempotent merge into Claude
`settings.json`, same machinery as the auto-sync and SDD hooks) whose command
emits one short steering line: for flow/structure/architecture questions,
call `specship_explore` with the relevant symbol names before any Read/Grep.
Unlike the opt-in SDD governance tier, this hook is part of the default
retrieval tier. `specship uninstall` removes it.

implementations:
  - src/installer/targets/claude.ts:writeSteerHookEntry
  - src/installer/targets/claude.ts:cleanupSteerHooks

## Acceptance
<!-- id: REQ-STEER-001.A1 -->
- A default `specship install` adds the steering hook to `settings.json`;
  re-running install is byte-idempotent (`unchanged`).
<!-- id: REQ-STEER-001.A2 -->
- `specship uninstall` removes the hook without disturbing sibling hooks.

<!-- id: REQ-STEER-002 -->
## The hook MUST be silent when it cannot help

The hook command emits nothing when the working project has no `.specship/`
index, and emits nothing when `SPECSHIP_NO_STEERING=1` is set. Uninitialized
projects and opted-out users get zero prompt noise and zero added latency
beyond the hook invocation itself.

implementations:
  - src/activation/steering.ts:buildSteeringNudge

## Acceptance
<!-- id: REQ-STEER-002.A1 -->
- In a directory without `.specship/`, the hook command exits 0 with empty
  output.
<!-- id: REQ-STEER-002.A2 -->
- With `SPECSHIP_NO_STEERING=1`, the hook command exits 0 with empty output
  even in an initialized project.

<!-- id: REQ-STEER-003 -->
## Shipping default-on MUST be gated on a reproduced A/B win

Before the hook ships enabled by default, an agent A/B (≥2 runs/arm, the
standard methodology) MUST show the hook arm matching or beating baseline on
flow questions (tool calls, Reads, duration) with no regression on non-flow
control prompts. Results are recorded in `docs/benchmarks/` (and feed the
BENCH-CLAIM-DOC manifest). If non-flow prompts regress, the hook ships
opt-in instead.

**GATE SATISFIED (2026-07-12):** `docs/benchmarks/steering-hook-ab.md` —
hook arm 1 explore/3 turns in 2/2 flow runs (vs 4–5 turns baseline), control
question unaffected.

implementations:
  - docs/benchmarks/steering-hook-ab.md

## Acceptance
<!-- id: REQ-STEER-003.A1 -->
- A recorded A/B in docs/benchmarks/ shows flow-question improvement and
  non-flow non-regression for the shipped wording.
