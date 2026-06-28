---
id: INSTALL-WEDGE-DOC
title: Default install protects the retrieval wedge
owner: core
priority: high
version: 1
---

<!-- id: INSTALL-WEDGE-DOC -->
# Install scope — protect the wedge

SpecShip's adoption wedge is **retrieval**: a solo developer installs it and, in
the first session, Claude Code stops Read/Grep-thrashing because it explores the
index instead. That value lands with zero workflow change. Today, though,
`specship install` provisions the entire surface — all shipped slash commands
plus the spec-driven-development nudge hook on by default — so a newcomer who
came for faster retrieval is immediately pushed toward authoring specs, a
workflow they never asked for.

This scopes the **default** install down to the retrieval tier and makes the
spec/governance tier (the deep end) an explicit opt-in, so the wedge lands clean
and depth is a deliberate next step. It is a packaging/onboarding change only —
no retrieval or governance capability is removed, only re-gated.

<!-- id: REQ-WEDGE-001 -->
## The default install MUST provision only the retrieval tier

A plain `specship install` (no extra flags) provisions the retrieval tier — the
MCP server and its read tools, the retrieval-oriented slash commands, the status
line, and the initial index — and does not write the governance tier (the
spec/governance/design slash commands or the spec-nudge hook).

implementations:
- src/installer/targets/claude.ts:writeCommandsEntries

## Acceptance
<!-- id: REQ-WEDGE-001.A1 -->
- After a default install, the MCP server entry, the retrieval read commands, and
  the status-line wiring are present, and the project is indexed.
<!-- id: REQ-WEDGE-001.A2 -->
- After a default install, the spec/governance/design slash commands and the
  spec-driven-development nudge hook are absent — none are written to the user's
  config.
<!-- id: REQ-WEDGE-001.A3 -->
- The classification of each shipped command into the retrieval tier vs the
  governance tier is explicit in the installer, so adding a command forces a
  deliberate tier choice rather than defaulting into the newcomer's surface.

<!-- id: REQ-WEDGE-002 -->
## The governance tier MUST be enabled only by an explicit opt-in

The spec/governance tier — the spec-authoring/implement/triage/behaviour/domain
commands and the SDD nudge — is written only when the user explicitly asks for
it, and that action is idempotent and fully reversible.

## Acceptance
<!-- id: REQ-WEDGE-002.A1 -->
- An explicit opt-in (an install flag and/or an `enable` action) provisions the
  full governance tier on top of an existing retrieval install.
<!-- id: REQ-WEDGE-002.A2 -->
- Running the opt-in twice is idempotent — a second run reports the governance
  tier unchanged, writing nothing new.
<!-- id: REQ-WEDGE-002.A3 -->
- `specship uninstall` removes the governance tier when it was enabled and leaves
  no governance commands or SDD hook behind, exactly as it does for the retrieval
  tier.
<!-- id: REQ-WEDGE-002.A4 -->
- A user who previously had the full surface installed is not silently downgraded
  on upgrade: an existing governance install is preserved, not stripped.

<!-- id: REQ-WEDGE-003 -->
## The published install instructions MUST install the current release

The documented install command installs the latest published version rather than
a pinned, stale one, so a newcomer following the README never lands on an old
build.

## Acceptance
<!-- id: REQ-WEDGE-003.A1 -->
- The README (and any other published install snippet) installs the package
  without pinning a specific older version — a fresh install yields the current
  latest release.
<!-- id: REQ-WEDGE-003.A2 -->
- No published install snippet references a version older than the current
  release.
