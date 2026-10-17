---
id: AUDFIX-DOC
title: Docs-audit defect fixes (2026-10)
owner: specship-core
priority: high
---

<!-- id: AUDFIX-DOC -->
# Docs-audit defect fixes (2026-10)

The 2026-10-16 documentation sync re-verified every user-facing claim against
source and surfaced nine places where the shipped behaviour contradicts its own
flags, messages, schema, or published contract. Each requirement below restores
the promise the product already makes; none adds a new surface beyond what the
existing promise implies. Rule carried from the product grill: promise only
what you can prove.

Non-goals: redesigning the tips engine, the workflow engine, or the tiny-repo
retrieval economics. The benchmark-backed tiny-repo trim of code-graph tools
stays exactly as tuned.

Test plan: every acceptance criterion has a vitest case whose title carries its
ID, so test-evidence links attach automatically — `__tests__/install-skip-index.test.ts`
(001), `__tests__/reflect-cli-verbs.test.ts` (002),
`__tests__/workflow-audit-fixes.test.ts` (003–005),
`__tests__/claude-tips-scoping.test.ts` (006),
`__tests__/node-version-check.test.ts` (007),
`__tests__/docs-reference.test.ts` (008) and
`__tests__/tiny-repo-spec-tools.test.ts` (009).

<!-- id: REQ-AUDFIX-001 -->
## `--skip-index` MUST be honored on a project-local install

`specship install --skip-index` documents "do not index the current project",
but the project-local path always builds an index.

implementations:
  - src/installer/index.ts:runInstallerWithOptions
  - src/installer/index.ts:initializeLocalProject

## Acceptance
<!-- id: REQ-AUDFIX-001.A1 -->
- A project-local install with `--skip-index` builds no index and creates no `.specship/` database.
<!-- id: REQ-AUDFIX-001.A2 -->
- The install summary names the skip as the user's choice (not a default), and the closing hint tells the user how to index later.
<!-- id: REQ-AUDFIX-001.A3 -->
- A project-local install without the flag still indexes, unchanged.

<!-- id: REQ-AUDFIX-002 -->
## Learned proposals MUST be appliable, undoable, and dismissable from the CLI

Session-start and sync messages tell users to review learned proposals in "the
dashboard", which has no page for it; only an HTTP API can apply them. The CLI
MUST offer the same three verbs, and every pointer MUST name a surface that
exists.

implementations:
  - src/bin/specship.ts
  - src/reflect/apply.ts:applyProposal
  - src/reflect/apply.ts:undoProposal
  - src/reflect/store.ts:ReflectStore.setState
  - src/activation/cheatsheet.ts:buildCheatsheetPayload

## Acceptance
<!-- id: REQ-AUDFIX-002.A1 -->
- `specship reflect apply <hash>` shows the before→after preview and writes only with `--yes`; the proposal becomes `applied`.
<!-- id: REQ-AUDFIX-002.A2 -->
- `specship reflect undo <hash>` reverses an applied proposal; `specship reflect dismiss <hash>` hides it from future sweeps.
<!-- id: REQ-AUDFIX-002.A3 -->
- A hash prefix that matches no proposal, or more than one, exits non-zero with a message naming the problem; nothing is written.
<!-- id: REQ-AUDFIX-002.A4 -->
- The sync "learned" line and the session-start cheatsheet line point at `specship reflect`, and never at a dashboard page that does not exist.

<!-- id: REQ-AUDFIX-003 -->
## A rejection revision MUST resolve its references and replace the output it revises

Bundled `on_reject` prompts reference the gate's own output, which does not
exist after a reject: the revise step throws and the run is left stuck in
`running`. Even when it succeeds, the revision is stored as a side output, so
downstream steps still read the original.

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.resume
  - src/workflows/schemas/workflow.ts
  - src/workflows/defaults/spec-implement.yaml
  - src/workflows/defaults/spec-implement-mixed.yaml
  - src/workflows/defaults/spec-author.yaml
  - src/workflows/defaults/claude-design-implement.yaml

## Acceptance
<!-- id: REQ-AUDFIX-003.A1 -->
- `on_reject` accepts an optional `revises: <nodeId>`; a value naming no node in the workflow is a validation error.
<!-- id: REQ-AUDFIX-003.A2 -->
- When `revises` is set, the successful revision's output replaces that node's output, so every downstream reference reads the revision.
<!-- id: REQ-AUDFIX-003.A3 -->
- Any failure while preparing or running the revision (including an unresolvable reference) leaves the run `rejected` with the error recorded — never `running`.
<!-- id: REQ-AUDFIX-003.A4 -->
- No bundled workflow's `on_reject` prompt references its own gate's output; each revising gate declares `revises`.

<!-- id: REQ-AUDFIX-004 -->
## Resuming a failed run MUST retry the failed step

A failed node is treated as settled on resume, its dependents are skipped, and
the run finishes `completed` without the failure ever being retried.

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.resume

## Acceptance
<!-- id: REQ-AUDFIX-004.A1 -->
- Resuming a `failed` run re-runs each failed node, and re-evaluates nodes that were skipped only because of that failure.
<!-- id: REQ-AUDFIX-004.A2 -->
- Completed nodes are not re-run.
<!-- id: REQ-AUDFIX-004.A3 -->
- If the retried node fails again, the run ends `failed` — never `completed`.

<!-- id: REQ-AUDFIX-005 -->
## Workflow-level `model` and `systemPromptAppend` MUST apply to prompt nodes

Both keys validate at the top of a workflow and are documented as defaults for
every prompt node, but never reach the agent.

implementations:
  - src/workflows/executor.ts:WorkflowExecutor.resolveNodeRefs

## Acceptance
<!-- id: REQ-AUDFIX-005.A1 -->
- A prompt node with no `model` runs with the workflow-level `model`; a node-level `model` wins.
<!-- id: REQ-AUDFIX-005.A2 -->
- The workflow-level `systemPromptAppend` reaches every prompt node, including `on_reject` revisions; a node-level value is appended after it, not instead of it.

<!-- id: REQ-AUDFIX-006 -->
## Dashboard tips MUST NOT show placeholders, mislabeled units, or invalid commands

implementations:
  - server/src/routes/claude.ts:registerClaudeRoutes

## Acceptance
<!-- id: REQ-AUDFIX-006.A1 -->
- No tip renders a literal placeholder (e.g. `$X.XX`); a saving that cannot be measured is omitted or stated qualitatively.
<!-- id: REQ-AUDFIX-006.A2 -->
- The large-result tip never labels a character count as tokens; any token figure is a labeled estimate, and its dollar figure derives from that estimate.
<!-- id: REQ-AUDFIX-006.A3 -->
- Every `fix` text names a real tool invocation or command (no `specship_explore --symbol`).

<!-- id: REQ-AUDFIX-007 -->
## The Node.js floor MUST be 22.5 everywhere

Published packages and bundles require Node.js ≥22.5 <25; the runtime check,
workspace `engines`, the npm shim, and the smoke matrix still say 20.

implementations:
  - src/bin/node-version-check.ts:buildNodeTooOldBanner
  - package.json
  - npm-shim/package.json
  - .github/workflows/smoke-npx.yml

## Acceptance
<!-- id: REQ-AUDFIX-007.A1 -->
- Node 22.4 or older is blocked at startup with a banner naming "22.5 or newer"; 22.5 passes. The `SPECSHIP_ALLOW_UNSAFE_NODE=1` override still works.
<!-- id: REQ-AUDFIX-007.A2 -->
- Every `engines.node` the repo declares reads `>=22.5.0 <25.0.0`, and no CI job runs on Node 20.

<!-- id: REQ-AUDFIX-008 -->
## The generated CLI reference MUST list every user-facing command

The generator misses commands registered with an alias, a double-quoted
description, or a description on its own line.

implementations:
  - scripts/generate-reference-docs.mjs:cliCommandsBlock

## Acceptance
<!-- id: REQ-AUDFIX-008.A1 -->
- `specship maintainability`, `specship memory edit`, and `specship jira transition` appear in the generated CLI table.
<!-- id: REQ-AUDFIX-008.A2 -->
- Internal hook commands remain excluded, and `--check` passes on the regenerated docs.

<!-- id: REQ-AUDFIX-009 -->
## Spec-layer tools MUST survive the tiny-repo trim when the project has specs

Under 500 indexed files the advertised tool list keeps only four code-graph
tools — a benchmark-backed trim that also hides the spec layer, which isn't a
code-graph tool.

implementations:
  - src/mcp/tools.ts:ToolHandler.getTools

## Acceptance
<!-- id: REQ-AUDFIX-009.A1 -->
- On a project under 500 files with ≥1 indexed spec, the spec-layer tools (spec, link assert/verify, drifted, and the JIRA tools when enabled) are advertised.
<!-- id: REQ-AUDFIX-009.A2 -->
- On a project under 500 files with no indexed specs, the advertised list is unchanged from today.
<!-- id: REQ-AUDFIX-009.A3 -->
- The code-graph tools trimmed today (callers, callees, impact, files, health) stay trimmed under 500 files either way, and the lite-tier trim still applies on top.
