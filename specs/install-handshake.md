---
id: INSTALL-HANDSHAKE-DOC
title: Install handshake — prove the install worked, tell the user what's next
owner: core
priority: high
version: 1
---

<!-- id: INSTALL-HANDSHAKE-DOC -->
# Install handshake — prove the install worked, tell the user what's next

A developer only reaches the manufactured retrieval moment (`ACTIVATION-DOC`) if
the install actually worked end-to-end. Today `specship install` writes config and
exits silently: it never tells the user that an MCP server added mid-session is
not live until Claude Code reconnects (the single most common silent failure), it
never verifies the runtime can actually serve queries, and the published runtime
requirement is self-contradictory — so a newcomer can bounce at the door before
the wedge ever fires.

This document specifies the install handshake: a loud restart reminder, a
post-install smoke check that proves the install serves queries, a re-runnable
`doctor`, an offer to index the current project, and a single honest runtime
promise. It is the adoption-wedge MVP (Wave 1 + the smoke-check half of Wave 2)
and is packaging/onboarding only — no retrieval capability changes.

<!-- id: REQ-HANDSHAKE-001 -->
## Install MUST tell the user to restart Claude Code

A successful `specship install` MUST end with an explicit, prominent instruction
to restart Claude Code (or reconnect MCP) before the SpecShip server is usable,
because a server added to the config is not visible to a session already running.

implementations:
  - src/installer/index.ts:runInstallerWithOptions

## Acceptance
<!-- id: REQ-HANDSHAKE-001.A1 -->
- A successful `specship install` prints an explicit instruction to restart Claude
  Code (or run `/mcp`) before the server can be used.
<!-- id: REQ-HANDSHAKE-001.A2 -->
- The instruction is shown for both global and local install locations.

<!-- id: REQ-HANDSHAKE-002 -->
## Install MUST verify itself end-to-end with a smoke check

After writing config, `specship install` MUST run a smoke check that proves the
install can actually serve queries, reporting a per-item pass/fail result so a
broken runtime, missing full-text search, or unqueryable index surfaces at install
time rather than later as a cryptic agent failure.

implementations:
  - src/health/smoke-check.ts:runSmokeCheck
  - src/health/smoke-check.ts:probeFts5

## Acceptance
<!-- id: REQ-HANDSHAKE-002.A1 -->
- After writing config, install reports a per-item status covering at least:
  runtime available, full-text search (FTS5) present, the MCP server boots, and —
  when run in an indexed project — the index answers a trivial query.
<!-- id: REQ-HANDSHAKE-002.A2 -->
- A failing item is reported with the specific failure and a remediation hint,
  not a generic error.
<!-- id: REQ-HANDSHAKE-002.A4 -->
- The smoke check is advisory: `specship install` reports failing items but exits
  0 regardless, so it never breaks a provisioning script (the non-zero gate is
  `specship doctor`'s job, per REQ-HANDSHAKE-003.A3).
<!-- id: REQ-HANDSHAKE-002.A3 -->
- The smoke-check result is the signal the activation starter prompt
  (`REQ-ACTIVATION-004`) gates on — a non-green result means no starter prompt is
  surfaced.

<!-- id: REQ-HANDSHAKE-003 -->
## A standalone doctor command MUST re-run the checks on demand

SpecShip MUST expose a `doctor` command that re-runs the same checks as the
post-install smoke check at any time, so a developer (or support) can diagnose a
broken install without reinstalling. It MUST be read-only.

implementations:
  - src/health/smoke-check.ts:runSmokeCheck
  - src/health/smoke-check.ts:doctorExitCode

## Acceptance
<!-- id: REQ-HANDSHAKE-003.A1 -->
- `specship doctor` runs the same checks as the post-install smoke check and
  prints a per-item status.
<!-- id: REQ-HANDSHAKE-003.A2 -->
- `specship doctor` writes no configuration and modifies no index — it only
  reports.
<!-- id: REQ-HANDSHAKE-003.A3 -->
- `specship doctor` exits non-zero when a usage-blocking check fails, so it can
  gate a script or CI step.

<!-- id: REQ-HANDSHAKE-004 -->
## Install MUST offer to index the current project when run inside one

When `specship install` is run from within a project, it MUST offer to build that
project's initial index in the same run, so the developer's first project is
activated without a separate, forgettable `init` step. Run outside a project it
MUST NOT prompt to index. SpecShip MUST NOT silently auto-index.

implementations:
  - src/bin/specship.ts:install

## Acceptance
<!-- id: REQ-HANDSHAKE-004.A1 -->
- Run from within a git repository that has no `.specship/`, install offers to
  build the initial index for that project.
<!-- id: REQ-HANDSHAKE-004.A2 -->
- Declining the offer completes the Claude Code wiring normally and leaves the
  project unindexed (the existing not-initialized guidance remains the net).
<!-- id: REQ-HANDSHAKE-004.A3 -->
- Run outside any project, or where the project is already indexed, install does
  not prompt to index — the offer exists only to activate an un-indexed repo;
  refreshing an existing index is the job of `sync`/`index` and the auto-sync
  hook, not the install prompt.
<!-- id: REQ-HANDSHAKE-004.A4 -->
- Under `--yes` (non-interactive) run inside an un-indexed project, install builds
  the current project's index by default (activation is the priority) without
  prompting; a `--skip-index` opt-out suppresses it for automation that does not
  want the side effect.

<!-- id: REQ-HANDSHAKE-005 -->
## Published install instructions MUST state one honest runtime promise

The published install docs MUST present a single, non-contradictory runtime
promise: the normal install bundles its own runtime and needs no particular host
Node version. The host-Node requirement applies only to the programmatic-SDK and
from-source paths and MUST be stated only in that scoped context.

implementations:
  - README.md:runtime

## Acceptance
<!-- id: REQ-HANDSHAKE-005.A1 -->
- The README's primary install path states that no host Node version is required
  (the bundled runtime is used), matching the published shim + per-platform-bundle
  behaviour.
<!-- id: REQ-HANDSHAKE-005.A2 -->
- The host-Node requirement (the SDK's minimum; the from-source supported range)
  appears only in its own SDK / from-source note, not as a blanket requirement.
<!-- id: REQ-HANDSHAKE-005.A3 -->
- No published install snippet contains a runtime requirement that contradicts the
  bundled-runtime promise.
