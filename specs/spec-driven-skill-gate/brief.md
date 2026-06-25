---
slug: spec-driven-skill-gate
spec: REQ-SDD-004   # appended to specs/sdd-install-steering.md (SDD-INSTALL-DOC)
created: 2026-06-25
---

# Brainstorm: Harness-enforced spec-driven skill gate

## Problem

When SpecShip is installed in a spec-driven project, competing brainstorm /
plan / spec skills still win over SpecShip's own flow. The maintainer
**observed the agent firing `superpowers:brainstorming` (and
`sdd-workflow-skill`) for feature/bug work despite the SDD steering already
shipped** (the `getSddRuleBlock` CLAUDE.md rule + the `spec-nudge`
`UserPromptSubmit` hook, `SDD-INSTALL-DOC`).

Root cause: SpecShip's two steering channels are **low-salience** (a CLAUDE.md
paragraph + a per-prompt `additionalContext` nudge), while `using-superpowers`
loads as a high-salience `<EXTREMELY_IMPORTANT>` block ("even 1% chance a skill
applies → you MUST invoke it"). On a tie, salience wins. Advisory steering is
not enough — we need a **deterministic, harness-enforced** backstop so that for
feature/bug work the SpecShip flow (`/ss-brainstorm → /ss-spec-author →
/ss-implement`) is what runs, not a generic brainstorm/plan/spec skill.

## Code grounding

- `src/installer/targets/claude.ts` — `install()` step 5 already writes SDD
  steering when `opts.sdd !== false`: `writeSddInstructionsEntry` (CLAUDE.md
  rule) + `writeSddHookEntry` (the `UserPromptSubmit` nudge). New gate hook
  belongs here as a sibling, under the same `opts.sdd` gate.
  - `SPECSHIP_SDD_HOOKS` (the hook spec merged into `settings.json`) — add the
    new `PreToolUse` / `Skill` entry here.
  - `writeHooksFor` — idempotent hook merge (reuse as-is).
  - `isSddHookCommand` — uninstall predicate; extend so `uninstall` strips the
    new gate command too.
- `src/bin/specship.ts` — `spec-nudge` command (line ~1893). New
  `skill-gate` command lives alongside it and **reuses `spec-nudge`'s
  `shouldNudge` intent heuristic** (extract it to a shared helper so both the
  nudge and the gate share one definition of "feature/bug-shaped").
- `hooks/hooks.json` — the **plugin** install path. It ships the same
  `spec-nudge` `UserPromptSubmit` hook; the new `PreToolUse` gate hook must be
  added here too so the install path and plugin path don't drift (same
  invariant the slash-command copy already maintains).
- `src/installer/instructions-template.ts` — `getSddRuleBlock` (the advisory
  CLAUDE.md rule). Stays; the gate is an additive backstop, not a replacement.
- `specs/sdd-install-steering.md` (`SDD-INSTALL-DOC`) — the existing SDD
  steering spec. This work is a direct extension; spec-author decides whether
  to extend that REQ or author a new sibling REQ that references it.
- `__tests__/installer-targets.test.ts` — the parameterized installer contract
  suite (install idempotency, uninstall reverses install, byte-equal re-runs
  return `unchanged`) plus the Claude-specifics / SDD suite. New gate needs
  coverage in both (it ships + uninstalls cleanly, idempotent re-run).

Confirmed feasible: Claude Code's `PreToolUse` stdin payload carries
`transcript_path` (plus `tool_name` / `tool_input`), so the gate can read the
last user turn from the transcript and run the intent heuristic against it. No
existing `PreToolUse` precedent in the repo — this is the first.

## Approaches considered

1. **A — Sharpen the existing advisory steering** (reword the CLAUDE.md rule +
   nudge to name-and-defer competitors). Cheap, rides the one channel
   `using-superpowers` documents as authoritative (CLAUDE.md precedence) — but
   still advisory, and the maintainer already watched advisory steering lose.
2. **B — Harness-enforced `PreToolUse` gate on the `Skill` tool.** The harness
   blocks the wrong skill; not advisory. Bigger surface, but the only
   deterministic option.
3. **C — Coexistence reframe** (declare SpecShip's commands the front door, stop
   suppressing). Smallest surface, but doesn't guarantee anything — weakest
   answer to "ensure not prioritized."

**Chosen: B** — the maintainer confirmed a real, observed failure of the
advisory layer, so determinism is the requirement. B is kept *alongside* A
(belt-and-suspenders): the advisory layer pre-empts, the gate is the
deterministic backstop. It is the "use the harness, don't try to change the
agent" lever done properly.

## Key decisions

- **New CLI command `specship skill-gate`**, wired as a `PreToolUse` hook
  matching the `Skill` tool, added to **both** `SPECSHIP_SDD_HOOKS` (installer →
  `settings.json`) and `hooks/hooks.json` (plugin). Part of the SDD feature:
  gated on `opts.sdd`, opted out by `--no-sdd`, removed by `uninstall`.
- **Decision logic** (reads PreToolUse JSON from stdin, always exits 0):
  1. Extract `tool_input.skill`. If **SpecShip-own** (`ss-*`, `spec-author`,
     `spec-reverse-engineer`, `specship:` namespace) → **allow** (force-allow,
     checked first so the gate never eats its own skills).
  2. Else if the skill name matches the **broad category pattern**
     `brainstorm|plan|spec|sdd` → read the last genuine user message from
     `transcript_path` and run the **shared `spec-nudge` intent heuristic**. If
     feature/bug-shaped → **deny**; otherwise allow.
  3. Everything else → allow.
- **Deny posture: hard deny + redirect, no prompt.** Express via PreToolUse
  `permissionDecision: "deny"` + a `permissionDecisionReason` that re-routes the
  agent to `/ss-brainstorm → /ss-spec-author → /ss-implement` and states the
  project is spec-driven. The only way to run a blocked skill is to disable the
  SDD steering (`--no-sdd` / env).
- **Precision: broad pattern + intent gate.** The intent scoping is what spares
  unrelated matches (e.g. `breakout-trade-planner`): those invocations aren't
  feature/bug-shaped, so they pass. SpecShip-own always force-allowed
  regardless of pattern.

## Edge cases & non-goals

Edge cases:
- Transcript tail ends in a tool-result, not a user turn → walk back to the
  last genuine user message before applying the heuristic.
- `transcript_path` missing / unreadable / no user message found → **fail open**
  (allow). The gate must never break the agent or block on its own error.
- User explicitly types a blocked skill (e.g. `/superpowers:brainstorm`) → still
  denied (accepted trade-off; escape is `--no-sdd`). Detecting user-typed vs
  agent-chosen from the payload was judged out of scope.
- Idempotent install: re-running `specship install` with the gate hook already
  present returns `unchanged` (reuse `writeHooksFor`'s command-equal skip).

Non-goals:
- Does not touch MCP **tool-choice** steering (the documented low-salience wall
  for tool selection is unchanged).
- Does not block skills outside the `brainstorm|plan|spec|sdd` families.
- No per-skill config UI; an env-var override for the pattern/allowlist is a
  possible later add, not in this scope.
- Does not remove or weaken the existing advisory layer (CLAUDE.md rule +
  `spec-nudge`) — the gate is additive.

## Acceptance criteria

- In a project where `specship install` ran with SDD steering on, when the agent
  invokes `superpowers:brainstorming` (or another `brainstorm|plan|spec|sdd`
  skill that isn't SpecShip-own) **and the latest user prompt is feature/bug
  shaped**, the `PreToolUse` gate **denies** it with a reason redirecting to
  `/ss-brainstorm`.
- SpecShip's own skills (`ss-*`, `spec-author`, `spec-reverse-engineer`,
  `specship:` namespace) are **never** denied.
- A non-feature/bug prompt (question / read-only ask) → the same skill is
  **allowed** (intent gate spares it).
- Missing/unreadable transcript or any gate error → **allow** (fail open);
  exit 0 always.
- `specship install` adds the gate hook to `settings.json` under `opts.sdd`;
  `--no-sdd` omits it; a byte-equal re-run reports `unchanged`; `uninstall`
  removes it. The plugin `hooks/hooks.json` carries the identical hook.
- Coverage added in `__tests__/installer-targets.test.ts` (install/uninstall/
  idempotency for the new hook) and a unit-level test of the `skill-gate`
  decision logic (allowlist, pattern, intent gate, fail-open). CHANGELOG entry
  under `[Unreleased]`.
