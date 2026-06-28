---
id: SDD-INSTALL-DOC
title: Spec-driven steering at install
owner: installer
priority: medium
brief: spec-driven-skill-gate/brief.md   # REQ-SDD-004 originated from this brainstorm brief
---

<!-- id: SDD-INSTALL-DOC -->
# Spec-driven steering at install

`specship install` makes spec-author the canonical first step for feature and
bug work in the project it's installed into, via three reinforcing mechanisms:

1. A short, human-readable rule in the project CLAUDE.md that tells the agent
   to author a spec (via spec-author, under `specs/`) before any brainstorming
   or planning skill — a deterministic ordering override, since a repo's
   CLAUDE.md takes precedence over a skill's own description.
2. A harness-executed `UserPromptSubmit` hook in `settings.json` that detects
   feature/bug-shaped intent and nudges toward the same path — independent of
   the agent's skill-selection judgment.
3. A harness-executed `PreToolUse` gate on skill invocation that, for
   feature/bug-shaped work, **blocks** a competing brainstorm/plan/spec skill
   and redirects the agent to the SpecShip flow. Mechanisms 1–2 are advisory
   (they can lose to a high-salience skill); the gate is the deterministic
   backstop for when they do.

All three are part of the **governance tier**, which — as of INSTALL-WEDGE-DOC —
is **opt-in** via the `--sdd` flag (it was previously written on-by-default; the
default install now provisions only the retrieval tier so the adoption wedge
lands without an unrequested spec workflow). When the governance tier is
installed they are idempotent and fully reversed by `specship uninstall`.
Mechanisms 1–2 are non-blocking (work always proceeds); mechanism 3 is blocking
by design — it is the only one that can stop a skill from running. This is Claude
Code only — the fork's single supported target.

Constraint carried from issue #529: the CLAUDE.md write here MUST stay a tiny
ordering rule and MUST NOT re-introduce a duplicate of the MCP server's
tool-usage instructions (which remain the single source of truth in the MCP
`initialize` response).

<!-- id: REQ-SDD-001 -->
## The installer MUST write a spec-author-first rule into the project CLAUDE.md

On a governance-tier (`--sdd`) install, the installer MUST add a short, marker-delimited rule
to the project's CLAUDE.md stating that feature/bug work in this repo invokes
spec-author to author a spec under `specs/` before any brainstorming or planning
skill, and that spec-driven development is canonical here. The block MUST be
delimited by its own dedicated markers — distinct from any legacy SpecShip
instructions block — so it can be located, updated, and removed independently.
The block MUST contain only the ordering rule; it MUST NOT duplicate the MCP
server's tool-usage playbook.

implementations:
  - src/installer/instructions-template.ts:SPECSHIP_SECTION_START
  - src/installer/targets/claude.ts:removeInstructionsEntry
  - src/installer/targets/shared.ts:removeMarkedSection

## Acceptance
<!-- id: REQ-SDD-001.A1 -->
- After install on a repo with no CLAUDE.md, a CLAUDE.md exists containing the spec-author-first rule between the dedicated SDD markers.
<!-- id: REQ-SDD-001.A2 -->
- After install on a repo with an existing CLAUDE.md, the rule block is added without altering any of the user's content outside the markers.
<!-- id: REQ-SDD-001.A3 -->
- A second install at the same version reports the CLAUDE.md as `unchanged` (byte-identical, idempotent).
<!-- id: REQ-SDD-001.A4 -->
- The block states the ordering rule (spec-author before brainstorming/planning) and does NOT contain the MCP tool playbook from the server instructions.
<!-- id: REQ-SDD-001.A5 -->
- Installing a newer version whose rule text changed updates the block in place between the same markers, without leaving a second copy.

<!-- id: REQ-SDD-002 -->
## The installer MUST add a non-blocking UserPromptSubmit nudge hook

On a governance-tier (`--sdd`) install, the installer MUST add a `UserPromptSubmit` hook to the
project Claude Code `settings.json`. The hook is executed by the harness, not by
the agent's judgment; when the submitted prompt expresses feature or bug-fix
intent, it MUST surface guidance steering the agent to author the spec via
spec-author under `specs/` before brainstorming or planning. The hook MUST be
non-blocking — it injects guidance and the prompt still proceeds. It MUST be
conservative about false positives: it MUST NOT nudge on clearly non-spec
prompts such as questions or one-line factual asks.

implementations:
  - src/installer/targets/claude.ts:writeHooksEntry

## Acceptance
<!-- id: REQ-SDD-002.A1 -->
- After install, `settings.json` contains a `UserPromptSubmit` hook entry that invokes the shipped spec-steering hook command.
<!-- id: REQ-SDD-002.A2 -->
- Given a feature/bug-shaped prompt, the hook emits guidance referencing spec-author and `specs/`, and the prompt is NOT blocked (it still runs).
<!-- id: REQ-SDD-002.A3 -->
- Given a clearly non-spec prompt (a question or trivial factual ask), the hook emits no nudge.
<!-- id: REQ-SDD-002.A4 -->
- A second install reports `settings.json` as `unchanged` when the hook entry already matches; sibling hooks and permissions are left untouched.

<!-- id: REQ-SDD-003 -->
## The steering MUST be opt-in (governance tier) and fully reversible

As of INSTALL-WEDGE-DOC the steering is **opt-in**: the CLAUDE.md rule
(REQ-SDD-001), the nudge hook (REQ-SDD-002), and the PreToolUse gate
(REQ-SDD-004) are written only by an explicit `--sdd` (governance-tier)
`specship install`; a no-flag install writes none of them (it provisions the
retrieval tier alone). The single `--sdd` flag toggles all three together.
`specship uninstall` MUST remove all of them — the marked CLAUDE.md block, the
nudge hook entry, and the gate hook entry — leaving no residue and preserving the
user's other CLAUDE.md content, permissions, and sibling hooks.

implementations:
  - src/installer/targets/claude.ts:install
  - src/bin/specship.ts:main

## Acceptance
<!-- id: REQ-SDD-003.A1 -->
- A `--sdd` (governance-tier) `specship install` writes all three SDD steering artifacts: the CLAUDE.md rule, the nudge hook, and the gate hook.
<!-- id: REQ-SDD-003.A2 -->
- A no-flag `specship install` writes none of the three and does not modify an existing CLAUDE.md or `settings.json` for these additions.
<!-- id: REQ-SDD-003.A3 -->
- `specship uninstall` removes the SDD CLAUDE.md block (via its markers), the nudge hook entry, and the gate hook entry, reporting `removed`; a CLAUDE.md left empty afterward is deleted, and user content outside the markers is preserved.
<!-- id: REQ-SDD-003.A4 -->
- An install → uninstall round-trip returns CLAUDE.md and `settings.json` to their pre-install state for the SpecShip-owned additions (byte-equivalent).

<!-- id: REQ-SDD-004 -->
## The installer MUST add a PreToolUse gate that blocks competing brainstorm/plan/spec skills for feature/bug work

On a governance-tier (`--sdd`) install, the installer MUST add a harness-executed `PreToolUse`
hook on skill invocation — in both the project `settings.json` and the shipped
plugin hooks manifest, so the `specship install` path and the plugin path do not
drift — that invokes a shipped gate command. When the agent invokes a skill
whose name matches the competing brainstorm / plan / spec / sdd-workflow
families **and** the triggering user request is feature/bug-shaped, the gate
MUST deny the invocation and return a reason that redirects the agent to the
SpecShip flow (`/ss-brainstorm → /ss-spec-author → /ss-implement`).

The gate MUST NOT deny a SpecShip-owned skill under any circumstances — the
`ss-*` commands, `spec-author`, `spec-reverse-engineer`, and the `specship:`
namespace are always allowed, even when their name matches a family token (e.g.
`ss-brainstorm`, `spec-author`). The gate MUST be intent-gated by the same
notion of "feature/bug-shaped" that the nudge hook (REQ-SDD-002) uses, so the
two mechanisms never disagree about what counts as feature/bug work. The gate
MUST fail open: if the triggering intent cannot be determined or the gate errors
internally, the invocation proceeds — the gate MUST NOT break or block the agent
on its own failure.

[needs review] The triggering request is read from the `PreToolUse` payload
(the session transcript); confirm during implementation that the payload exposes
the originating user prompt reliably, and fail open if it does not.

implementations:
  - src/installer/targets/claude.ts:writeHooksFor
  - src/installer/targets/claude.ts:isSddHookCommand

## Acceptance
<!-- id: REQ-SDD-004.A1 -->
- After install, `settings.json` contains a `PreToolUse` hook (matching skill invocation) that invokes the shipped gate command, and the identical hook is present in the plugin hooks manifest.
<!-- id: REQ-SDD-004.A2 -->
- When a skill whose name matches the brainstorm/plan/spec/sdd-workflow families is invoked while the triggering request is feature/bug-shaped, the gate denies the invocation and the returned reason names the SpecShip flow (`/ss-brainstorm → /ss-spec-author → /ss-implement`).
<!-- id: REQ-SDD-004.A3 -->
- A SpecShip-owned skill (`ss-*`, `spec-author`, `spec-reverse-engineer`, `specship:` namespace) is never denied, including when its name matches a family token (e.g. `ss-brainstorm`, `spec-author`).
<!-- id: REQ-SDD-004.A4 -->
- A family-matching skill invoked while the triggering request is NOT feature/bug-shaped (a question or read-only ask) is allowed through.
<!-- id: REQ-SDD-004.A5 -->
- A skill whose name does not match the families (e.g. an unrelated trading skill) is allowed through regardless of the triggering request's intent.
<!-- id: REQ-SDD-004.A6 -->
- When the triggering intent cannot be determined or the gate errors internally, the invocation is allowed (the gate exits without denying).
<!-- id: REQ-SDD-004.A7 -->
- A second install reports `settings.json` as `unchanged` when the gate hook already matches; sibling hooks and permissions are left untouched.
