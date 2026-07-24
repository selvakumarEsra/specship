---
id: INSTALL-INTEG-SETUP-DOC
title: Installer offers integration setup after enabling it
owner: specship
priority: medium
---

<!-- id: INSTALL-INTEG-SETUP-DOC -->
# Installer offers integration setup after enabling it

`specship install --with-jira` / `--with-designer` only flips the tool group
on (writes `SPECSHIP_INTEGRATIONS` into the MCP entry). The actual setup — JIRA
credentials, the Designer debug-Chrome session — is a separate command the user
has to know to run next. This closes that gap: after a successful install that
enabled an integration, the installer offers to run its setup step, in the same
interactive flow as the gate and status-line prompts.

Two principles bound this, inherited from the installer's charter
(INSTALL-SCOPE-DOC) and the secrets model (JIRA-DOC):

- **Interactive-only, never scripted.** The follow-up is offered only in an
  interactive install. Under `--yes` (CI / scripting) nothing is prompted or
  run — secrets can't be captured non-interactively, and setup flags/tokens
  must never enter shell history or CI logs. The standalone `specship jira
  configure` / `designer setup` commands remain the path there.
- **Reuse, don't reimplement.** The offer delegates to the existing,
  already-tested commands (`specship jira configure`, `designer setup`) rather
  than duplicating credential capture in the installer. JIRA credentials are
  still written only to the user-global `~/.specship/jira.json` (0600), never
  into the per-project wiring the installer otherwise writes.

<!-- id: REQ-INSTALL-INTEG-001 -->
## The installer MUST decide the follow-up deterministically from a pure planner

A pure function maps `(withJira, withDesigner, useDefaults)` plus injected
environment probes (is JIRA already configured, is the `specship` binary on
PATH, is the `designer` command on PATH) to a plan naming, per enabled
integration, exactly one follow-up: offer-and-run, print-an-instruction, or
nothing. No prompting or spawning happens inside the planner, so it is unit
testable.

implementations:
  - src/installer/integration-setup.ts:planIntegrationSetup

## Acceptance
<!-- id: REQ-INSTALL-INTEG-001.A1 -->
- With `withJira` set, interactive, JIRA not yet configured, and the specship
  binary resolvable, the plan offers to run `specship jira configure`.
<!-- id: REQ-INSTALL-INTEG-001.A2 -->
- With `useDefaults` (`--yes`) the plan is empty regardless of which
  integration flags are set — no offer, no instruction.
<!-- id: REQ-INSTALL-INTEG-001.A3 -->
- With `withJira` set but JIRA already configured, the plan does not offer to
  run configure (it may surface a one-line "already configured" note instead).
<!-- id: REQ-INSTALL-INTEG-001.A4 -->
- With `withDesigner` set and interactive: when the `designer` command is on
  PATH the plan offers to run `designer setup`; when it is not, the plan
  falls back to printing the one-time setup instruction rather than offering
  to run a missing command.
<!-- id: REQ-INSTALL-INTEG-001.A5 -->
- With neither integration flag set the plan is empty.

<!-- id: REQ-INSTALL-INTEG-002 -->
## The runner MUST honor the plan and never fail the install

The installer executes the plan after the install writes succeed and before
the outro: for an offer, it confirms with the user (default yes for a
first-time setup) and, on yes, spawns the setup command with inherited stdio
so its own prompts drive; for an instruction, it prints the one-liner. A
declined offer, a cancelled prompt, or a non-zero exit from the spawned setup
command leaves the install itself successful — the wiring is already written;
setup is a convenience the user can retry with the standalone command.

implementations:
  - src/installer/integration-setup.ts:runIntegrationSetup
  - src/installer/index.ts:runInstallerWithOptions

## Acceptance
<!-- id: REQ-INSTALL-INTEG-002.A1 -->
- Declining the JIRA offer (or the Designer offer) completes the install
  normally, with no setup command spawned.
<!-- id: REQ-INSTALL-INTEG-002.A2 -->
- Accepting an offer spawns the corresponding command (`specship jira
  configure` / `designer setup`) with stdio inherited; a non-zero exit is
  reported but does not fail the install.
<!-- id: REQ-INSTALL-INTEG-002.A3 -->
- The setup step runs only after the install's file writes have completed
  (it never runs when an install errors out earlier).
