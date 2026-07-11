---
id: INTEG-TIER-DOC
title: Two-tier product — core vs opt-in integrations
owner: specship
priority: medium
---

<!-- id: INTEG-TIER-DOC -->
# Two-tier product — core vs opt-in integrations

The README promises "100% local · no API keys · no external services," yet
the default surface includes JIRA (outbound SaaS calls, saved credentials in
`~/.specship`) and Designer (drives claude.ai/design through a debug-port
Chrome session — an unofficial interface that can break without notice).
Decision (2026-07-11 product review, Q11): a surface may only promise what
it can prove. The product splits into a **core** tier (local-only promise
holds by construction) and **integrations** (opt-in, separately labeled,
allowed to break without impugning the core).

<!-- id: REQ-INTEG-001 -->
## The default install MUST NOT enable JIRA or Designer

`specship install` provisions the core: retrieval, specs/links, workflows,
dashboard. JIRA and Designer tools/commands are enabled only by explicit
opt-in (`--with-jira`, `--with-designer`, or an `integrations` subcommand —
mirroring the existing `--sdd` opt-in pattern). An existing install that
already uses them is preserved on upgrade. [needs review: flag spelling vs
`specship integrations add <name>`.]

implementations:
  - src/mcp/tools.ts:filterIntegrationTools
  - src/installer/targets/claude.ts:writeMcpEntry
  - src/installer/targets/shared.ts:getSpecShipPermissions

## Acceptance
<!-- id: REQ-INTEG-001.A1 -->
- After a default install, no `specship_jira_*` or `designer_*` MCP tools
  are exposed and no JIRA/designer slash commands are provisioned.
<!-- id: REQ-INTEG-001.A2 -->
- Installing with the JIRA opt-in exposes the JIRA tools; likewise Designer.
<!-- id: REQ-INTEG-001.A3 -->
- Upgrading an install that had the integrations enabled keeps them enabled.

<!-- id: REQ-INTEG-002 -->
## Designer MUST be labeled experimental wherever it is offered

Install prompt, docs, and command help state that Designer depends on
claude.ai internals and may break without notice. When its browser interface
is unreachable or changed, designer commands fail with that explanation —
never a bare crash.

implementations:
  - src/designer/designer-controller.ts:DesignerController

## Acceptance
<!-- id: REQ-INTEG-002.A1 -->
- The Designer opt-in surface displays the experimental caveat at install
  time and in `--help`.
<!-- id: REQ-INTEG-002.A2 -->
- With no debug-Chrome session available, a designer command exits with a
  actionable message naming `designer setup`, not a stack trace.

<!-- id: REQ-INTEG-003 -->
## Locality claims MUST be scoped to the core tier

README and site copy state the local-only promise as a property of the core
and disclose that the JIRA integration talks to Atlassian and Designer talks
to claude.ai — adjacent to the claim, not buried.

## Acceptance
<!-- id: REQ-INTEG-003.A1 -->
- Every "no external services"-class claim in README/site is scoped to the
  core tier with the two integrations disclosed.

<!-- id: REQ-INTEG-004 -->
## Integration credentials MUST have a visible custody story

Where JIRA credentials are stored, in what form, and how to remove them is
documented; disabling the integration or running `specship uninstall`
removes them (the existing purge already covers the uninstall path — keep
it covered by test).

## Acceptance
<!-- id: REQ-INTEG-004.A1 -->
- Disabling the JIRA integration removes the stored credentials, verified
  by test.
