---
id: INSTALL-WEDGE-DOC
title: Default install protects the retrieval wedge
owner: core
priority: high
version: 2
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

**REVERSED (v2, 2026-07-13, maintainer decision):** the governance tier now
ships ON by default, with `--no-sdd` as the explicit opt-out. Rationale: the
retrieval wedge no longer depends on hiding governance — the steering hook
lands the retrieval value on the first prompt regardless of what else is
installed, and spec-driven development is the product's core differentiator;
hiding it by default buried it. The tier CLASSIFICATION and full
reversibility are retained — only the default flipped.

<!-- id: REQ-WEDGE-001 -->
## The default install MUST provision the retrieval AND governance tiers

A plain `specship install` (no extra flags) provisions the full surface: the
MCP server and its read tools, ALL slash commands (retrieval + the
spec/authoring/review/design doors), the SDD steering (CLAUDE.md rule +
spec-nudge hook), and the retrieval steering hook. `--no-sdd` is the explicit
opt-out that yields a retrieval-only install. (v2 reversal — see the document
intro; v1 shipped retrieval-only by default.)

implementations:
- src/installer/targets/claude.ts:writeCommandsEntries

## Acceptance
<!-- id: REQ-WEDGE-001.A1 -->
- After a default install, the MCP server entry, ALL slash commands, the SDD
  steering (CLAUDE.md rule + spec-nudge hook), and the retrieval steering hook
  are present, and the project is indexed.
<!-- id: REQ-WEDGE-001.A2 -->
- After `specship install --no-sdd`, the spec/governance/design slash commands
  and the SDD nudge hook are absent — retrieval-only, exactly the v1 default.
<!-- id: REQ-WEDGE-001.A3 -->
- The classification of each shipped command into the retrieval tier vs the
  governance tier stays explicit in the installer, so `--no-sdd` remains a
  clean cut rather than a hand-maintained list.

<!-- id: REQ-WEDGE-002 -->
## The governance tier MUST remain idempotent and fully reversible

The spec/governance tier — the spec-authoring/implement/triage/behaviour/domain
commands and the SDD nudge — installs idempotently and reverses cleanly,
whether it arrived by default (v2) or by the old `--sdd` opt-in (v1, still
accepted for compatibility).

## Acceptance
<!-- id: REQ-WEDGE-002.A1 -->
- `specship install` (or the legacy `--sdd` flag) provisions the full
  governance tier on top of an existing retrieval-only install.
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
