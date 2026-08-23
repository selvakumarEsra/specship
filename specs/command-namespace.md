---
id: CMD-NS-DOC
title: Slash-command namespace
owner: install
priority: medium
version: 1
---

<!-- id: CMD-NS-DOC -->
# Slash-command namespace

SpecShip ships its agent-facing slash commands under a **colon namespace** so
they group as one family in Claude Code's command surface: `/specship:spec`,
`/specship:explore`, `/specship:check`, `/specship:design-loop`,
`/specship:design-implement`. Claude Code derives the colon form from the
directory a command file lives in, so the commands ship from a `commands/specship/`
subdirectory instead of the flat `commands/ss-*.md` layout they used before.

This is a rename of an existing surface. The prior scheme shipped the commands
as flat `ss-*.md` files that surfaced as `/ss-spec`, `/ss-explore`, `/ss-check`,
etc. The migration must be seamless: an upgrading user must not end up with both
the old flat commands and the new namespaced ones side by side, and the dashboard
chat must keep accepting the muscle-memory `/ss-*` forms while steering users to
the new names.

The retrieval-vs-governance install tiers are unchanged — the reads door still
ships on every install and the governance doors stay behind `--sdd`; only the
on-disk location and the invocation prefix change.

> The legacy `/ss-*` acceptance in the chat classifier (REQ-CMD-NS-005) is a
> deprecation alias, not a permanent second name — it exists to spare muscle
> memory and pasted docs during the transition, and is a candidate for removal
> in a later major version once usage of the old form has faded.

<!-- id: REQ-CMD-NS-001 -->
## Shipped slash commands MUST install under a `specship/` command subdirectory

The installer MUST write each shipped slash command into a `specship/`
subdirectory of the target commands directory (`~/.claude/commands/specship/`
globally, `./.claude/commands/specship/` locally) rather than as a flat
`ss-*.md` file, so Claude Code surfaces them under the `/specship:` namespace.
The retrieval tier (the reads door) still ships on every install and the
governance tier still ships only under `--sdd`; the tier split is preserved and
only the on-disk location changes.

implementations:
  - src/installer/targets/claude.ts:writeCommandsEntries
  - src/installer/targets/claude.ts:commandsDir
  - commands/specship/explore.md
  - commands/specship/spec.md
  - commands/specship/check.md
  - commands/specship/design-implement.md
  - commands/specship/design-loop.md

## Acceptance
<!-- id: REQ-CMD-NS-001.A1 -->
- After a governance (`--sdd`) install, the five shipped command files exist under `<commands-dir>/specship/` (`specship/spec.md`, `specship/explore.md`, `specship/check.md`, `specship/design-implement.md`, `specship/design-loop.md`) and no `ss-*.md` file is written at the top level of `<commands-dir>`.
<!-- id: REQ-CMD-NS-001.A2 -->
- A default (retrieval-only) install writes only the reads door at `<commands-dir>/specship/explore.md` and writes none of the governance command files.
<!-- id: REQ-CMD-NS-001.A3 -->
- The `smoke-npx` workflow asserts the installed command file at its namespaced path (`.../commands/specship/explore.md`), not at the flat `ss-explore.md` path.

<!-- id: REQ-CMD-NS-002 -->
## Uninstall MUST remove the namespaced command files it installed

Uninstalling SpecShip MUST remove every command file the installer wrote under
`<commands-dir>/specship/`, reversing the install. Sibling user-written command
files — anywhere in the commands directory, including inside `specship/` — MUST
be left untouched.

implementations:
  - src/installer/targets/claude.ts:removeCommandsEntries

## Acceptance
<!-- id: REQ-CMD-NS-002.A1 -->
- After an install followed by an uninstall, none of the SpecShip-shipped command files remain under `<commands-dir>/specship/`.
<!-- id: REQ-CMD-NS-002.A2 -->
- Uninstall leaves a user-authored `.md` file placed in the commands directory (or in `specship/`) present and byte-unchanged.
<!-- id: REQ-CMD-NS-002.A3 -->
- Running install twice with no intervening change reports every command file `unchanged` on the second run (byte-equal idempotency).

<!-- id: REQ-CMD-NS-003 -->
## Upgrade MUST remove the legacy flat `ss-*.md` commands

On install (the upgrade self-heal path), the installer MUST remove any flat
`ss-*.md` command files a prior SpecShip version wrote to the commands directory
— `ss-spec.md`, `ss-explore.md`, `ss-check.md`, `ss-design-implement.md`,
`ss-design-loop.md` (and the already-retired `ss-*` forms) — so an upgrading user
never has both the flat `/ss-*` commands and the namespaced `/specship:*` commands
in autocomplete at once. Removal MUST be limited to those exact SpecShip
filenames.

implementations:
  - src/installer/targets/claude.ts:cleanupLegacyCommandsEntries

## Acceptance
<!-- id: REQ-CMD-NS-003.A1 -->
- Given the flat files `ss-spec.md`, `ss-explore.md`, `ss-check.md`, `ss-design-implement.md`, and `ss-design-loop.md` present in the commands directory, an install removes all five.
<!-- id: REQ-CMD-NS-003.A2 -->
- After that upgrade install, the only SpecShip command files present are the namespaced ones under `specship/` — no flat `ss-*.md` remains.
<!-- id: REQ-CMD-NS-003.A3 -->
- A sibling user-written file whose name is not a SpecShip-shipped command (e.g. `my-notes.md`) is not removed by the upgrade cleanup.

<!-- id: REQ-CMD-NS-004 -->
## Install MUST surface a one-time notice when it migrates a user off the flat commands

When an install removes at least one legacy flat `ss-*.md` command (i.e. it just
migrated an existing user), the install output MUST state that the slash commands
moved from `/ss-*` to `/specship:*`, so a user isn't left confused when their
`/ss-spec` autocomplete disappears. A fresh install that had no flat commands to
remove MUST NOT show the notice.

implementations:
  - src/installer/index.ts

## Acceptance
<!-- id: REQ-CMD-NS-004.A1 -->
- An install that removes one or more legacy flat `ss-*.md` files prints a notice naming both the old (`/ss-*`) and new (`/specship:*`) forms.
<!-- id: REQ-CMD-NS-004.A2 -->
- An install on a machine with no flat `ss-*.md` files present prints no rename notice.

<!-- id: REQ-CMD-NS-005 -->
## RETIRED — The dashboard chat MUST route both the `/specship:*` and legacy `/ss-*` slash forms

**Retired.** The dashboard chat this requirement governed was removed by the
chat-removal decision (see `specs/chat-removal.md`), so there is no intent
classifier left to route the slash forms. The historical requirement text and
acceptance criteria are kept below for the record; they are no longer binding
and have no implementation.

The dashboard chat's intent classifier MUST route the canonical namespaced
command forms — `/specship:spec`, `/specship:explore`, `/specship:check` — to the
same intents their flat predecessors routed to. It MUST also continue routing the
legacy `/ss-spec`, `/ss-explore`, `/ss-check` forms to those intents as a
deprecation alias, and MUST mark a message that used a legacy form so the chat can
tell the user it was renamed to the `/specship:*` equivalent.

## Acceptance
<!-- id: REQ-CMD-NS-005.A1 -->
- `/specship:spec <ID>` classifies to intent `spec`, `/specship:explore <symbols>` to `explore`, and `/specship:check` to `drift`, each preserving the trailing text as the query.
<!-- id: REQ-CMD-NS-005.A2 -->
- The legacy forms `/ss-spec <ID>`, `/ss-explore <symbols>`, and `/ss-check` still classify to `spec`, `explore`, and `drift` respectively.
<!-- id: REQ-CMD-NS-005.A3 -->
- A message using a legacy `/ss-*` form is flagged as a deprecated alias, and the chat response names the `/specship:*` form it was renamed to.
