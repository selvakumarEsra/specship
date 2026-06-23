---
id: SDD-INSTALL-DOC
title: Spec-driven steering at install
owner: installer
priority: medium
---

<!-- id: SDD-INSTALL-DOC -->
# Spec-driven steering at install

`specship install` makes spec-author the canonical first step for feature and
bug work in the project it's installed into, via two reinforcing mechanisms:

1. A short, human-readable rule in the project CLAUDE.md that tells the agent
   to author a spec (via spec-author, under `specs/`) before any brainstorming
   or planning skill — a deterministic ordering override, since a repo's
   CLAUDE.md takes precedence over a skill's own description.
2. A harness-executed `UserPromptSubmit` hook in `settings.json` that detects
   feature/bug-shaped intent and nudges toward the same path — independent of
   the agent's skill-selection judgment.

Both are written **on by default** (with an opt-out flag), are idempotent, and
are fully reversed by `specship uninstall`. This is Claude Code only — the
fork's single supported target.

Constraint carried from issue #529: the CLAUDE.md write here MUST stay a tiny
ordering rule and MUST NOT re-introduce a duplicate of the MCP server's
tool-usage instructions (which remain the single source of truth in the MCP
`initialize` response).

<!-- id: REQ-SDD-001 -->
## The installer MUST write a spec-author-first rule into the project CLAUDE.md

On install (default-on), the installer MUST add a short, marker-delimited rule
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

On install (default-on), the installer MUST add a `UserPromptSubmit` hook to the
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
## The steering MUST be on by default, opt-out, and fully reversible

The CLAUDE.md rule (REQ-SDD-001) and the hook (REQ-SDD-002) MUST both be written
by a no-flag `specship install`, with a documented flag to skip them (e.g.
`--no-sdd`). `specship uninstall` MUST remove both — the marked CLAUDE.md block
and the hook entry — leaving no residue and preserving the user's other CLAUDE.md
content, permissions, and sibling hooks.

implementations:
  - src/installer/targets/claude.ts:install
  - src/bin/specship.ts:main

## Acceptance
<!-- id: REQ-SDD-003.A1 -->
- A no-flag `specship install` writes both the CLAUDE.md rule and the hook.
<!-- id: REQ-SDD-003.A2 -->
- `specship install` with the opt-out flag writes neither and does not modify an existing CLAUDE.md or `settings.json` for these additions.
<!-- id: REQ-SDD-003.A3 -->
- `specship uninstall` removes the SDD CLAUDE.md block (via its markers) and the hook entry, reporting `removed`; a CLAUDE.md left empty afterward is deleted, and user content outside the markers is preserved.
<!-- id: REQ-SDD-003.A4 -->
- An install → uninstall round-trip returns CLAUDE.md and `settings.json` to their pre-install state for the SpecShip-owned additions (byte-equivalent).
