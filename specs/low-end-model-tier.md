---
id: LOWEND-DOC
title: Low-end model support (Gemini 3.5 Flash)
owner: "@selvakumar"
priority: high
---

<!-- id: LOWEND-DOC -->
# Low-end model support (Gemini 3.5 Flash)

SpecShip must work great under cheap/fast models (standing requirement:
low-end model effectiveness). The tier machinery exists — `ModelTier`
(`lite`/`standard`/`full`), per-result compaction, lite tool-list trim — and
`gemini…flash` ids already map to `lite`. What's missing: tier detection on
Gemini CLI sessions (all three detection channels are Claude Code plumbing),
a proven tier assignment for bare `flash` vs `flash-lite`, a lite-sized
instruction surface, a one-call-completeness lite explore budget, and an eval
runner that measures any of this under the actual model.

Non-goals: no new agent targets (Gemini CLI is the one ratified exception,
MCP-entry-only — no hooks, no status line); no change to full-tier output
anywhere in this document (monotonicity: full stays byte-identical); no
auto-extraction of model identity that guesses — unknown always resolves to
`full`, never compact blind.

<!-- id: REQ-LOWEND-001 -->
## Gemini CLI sessions MUST resolve a model tier

Today the tier is detected from the status-line model marker, the Claude Code
transcript tail, or the SessionStart hook seed — none of which exist on a
Gemini CLI session, so every Gemini session silently runs `full` tier and
Flash receives the largest output exactly where it runs.

The MCP server MUST resolve a tier for Gemini CLI sessions **in-server** (the
Gemini target is MCP-entry-only — no hooks or status line may be added):

- **Auto-detect** the session's model from Gemini CLI's own configuration
  surface (its settings file and/or environment) when available.
- **Manual override**: a documented runtime setting/environment knob that
  names the tier (or the model id) and wins over auto-detection when present.
- **Unknown → `full`**: when neither channel yields a model, behavior is
  today's — never compact blind.

Resolution happens per tool call or cheaper (cached with invalidation), never
adding perceptible latency to a tool response.

implementations:
  - src/mcp/model-context.ts:detectModelTier
  - src/mcp/model-context.ts:modelTier
  - src/mcp/gemini-session.ts:readGeminiSessionModel

verifies:
  - __tests__/gemini-session-tier.test.ts:projectSettingsFlashResolvesLiteWithNoClaudeChannel
  - __tests__/gemini-session-tier.test.ts:specshipModelOverrideWinsBothWays
  - __tests__/gemini-session-tier.test.ts:malformedOrUnreadableSourcesDegradeSilently

## Acceptance
<!-- id: REQ-LOWEND-001.A1 -->
- On a Gemini CLI session whose configuration names a `flash` model, tool
  results are compacted at the model's mapped tier with no Claude Code
  marker, transcript, or hook present.
  verifies:
    - __tests__/gemini-session-tier.test.ts:projectSettingsFlashResolvesLiteWithNoClaudeChannel
    - __tests__/gemini-session-tier.test.ts:objectModelShapeIsAccepted
    - __tests__/gemini-session-tier.test.ts:geminiModelEnvWins
    - __tests__/gemini-session-tier.test.ts:projectSettingsBeatGlobal
<!-- id: REQ-LOWEND-001.A2 -->
- Setting the documented override to `lite` yields lite-tier output even when
  auto-detection finds nothing; setting it to `full` disables compaction even
  when auto-detection finds a flash model.
  verifies:
    - __tests__/gemini-session-tier.test.ts:specshipModelOverrideWinsBothWays
    - __tests__/model-context.test.ts:tierNamesAreAcceptedAsOverrideValues
<!-- id: REQ-LOWEND-001.A3 -->
- With no override and no detectable model, output is byte-identical to
  today's full-tier output.
  verifies:
    - __tests__/gemini-session-tier.test.ts:nothingDetectedIsByteIdenticalFullOutput
<!-- id: REQ-LOWEND-001.A4 -->
- A malformed or unreadable Gemini settings source never errors a tool call —
  detection degrades to `full` silently.
  verifies:
    - __tests__/gemini-session-tier.test.ts:malformedOrUnreadableSourcesDegradeSilently

<!-- id: REQ-LOWEND-002 -->
## The `flash` vs `flash-lite` tier assignment MUST be decided by eval, not assumption

`TIER_RULES` maps every `gemini…flash` id (flash and flash-lite alike) to
`lite`. Gemini 3.5 Flash is a substantially stronger model than flash-lite,
and lite-tier trimming may cost it the context it needs to answer in one
call — but promising `standard` without proof violates the benchmark-claim
rule.

The assignment MUST be settled by the low-end eval (REQ-LOWEND-005): run the
A/B bar under `gemini-3.5-flash` at `lite` and at `standard`; adopt the tier
that meets the pass bar with the lower fallback rate (Read/Grep escapes). The
decision — either keeping `lite` or splitting bare `flash` → `standard` while
`flash-lite` stays `lite` — MUST be recorded with the eval evidence in the
benchmark docs, and `TIER_RULES` MUST keep most-specific-first ordering so a
`flash-lite` id can never inherit the bare-`flash` rule.

implementations:
  - src/mcp/model-context.ts:modelTier

## Acceptance
<!-- id: REQ-LOWEND-002.A1 -->
- An eval run under `gemini-3.5-flash` at both candidate tiers exists in the
  benchmark record before any `TIER_RULES` change lands; the adopted mapping
  cites it.
<!-- id: REQ-LOWEND-002.A2 -->
- After the decision, `flash-lite` ids still resolve to `lite` regardless of
  what bare `flash` resolves to.
<!-- id: REQ-LOWEND-002.A3 -->
- Claude tier mappings (haiku/sonnet/opus/fable) are unchanged by the
  decision.

<!-- id: REQ-LOWEND-003 -->
## Lite tier MUST serve a compact instruction set

The full server instructions are ~6 KB across 14+ tools, including a JIRA
section that is ~40% of the bytes. Weak instruction-followers do better with
a short imperative contract. When the resolved tier is `lite`, the MCP server
MUST serve a compact instruction variant: the explore-first rule, the core
tool selections matching the lite tool-list trim, and the anti-patterns that
prevent grep fallback — with the JIRA section and non-core tool guidance
removed entirely.

Both variants MUST live in `src/mcp/server-instructions.ts` — it remains the
single source of truth for agent-facing tool guidance; no second file, no
duplicated prose elsewhere.

implementations:
  - src/mcp/server-instructions.ts:SERVER_INSTRUCTIONS

## Acceptance
<!-- id: REQ-LOWEND-003.A1 -->
- On a lite-tier session the served instructions contain no JIRA tool
  guidance and reference only tools present after the lite tool-list trim.
<!-- id: REQ-LOWEND-003.A2 -->
- The lite instruction variant is at most one third the size of the full
  variant.
<!-- id: REQ-LOWEND-003.A3 -->
- Standard- and full-tier sessions receive today's instructions unchanged.

<!-- id: REQ-LOWEND-004 -->
## The lite explore budget MUST favor one-call completeness over breadth

A low-end model abandons tool chains fastest — the instant an explore answer
is insufficient it falls back to Read/Grep. On `lite` tier,
`specship_explore`'s output budget MUST prioritize returning the top
cluster's source completely (fewer files, fuller bodies, the completeness
signal always present) over listing more files partially, so a flow question
still resolves in one call with zero Read/Grep.

Constraints: full- and standard-tier explore output is byte-identical to
today's (per-tier budgets may not shrink what an existing tier returns); the
retrieval budget stays tool-call count + wall-clock latency, and no
acceptance below may be met by adding calls or latency.

implementations:
  - src/mcp/tools.ts:getExploreOutputBudget
  - src/mcp/tools.ts:applyLiteExploreBudget

## Acceptance
<!-- id: REQ-LOWEND-004.A1 -->
- On lite tier, the probe sweep shows the top-ranked file's relevant symbols
  returned with untrimmed bodies on the corpus repos, within the lite output
  cap.
  verifies:
    - __tests__/explore-output-budget.test.ts:liteReturnsFullerBodiesAcrossFewerFiles
<!-- id: REQ-LOWEND-004.A2 -->
- On lite tier the trailing meta-sections (additional-files list, budget
  note) are absent; the completeness signal is present.
  verifies:
    - __tests__/explore-output-budget.test.ts:liteSuppressesTrailingMetaSectionsButKeepsCompleteness
<!-- id: REQ-LOWEND-004.A3 -->
- Full-tier probe-sweep output across the corpus is byte-identical before and
  after the change.
  verifies:
    - __tests__/explore-output-budget.test.ts:fullAndStandardTierBudgetsAreByteIdentical
<!-- id: REQ-LOWEND-004.A4 -->
- Median explore latency on the corpus does not increase.

<!-- id: REQ-LOWEND-005 -->
## The agent-eval harness MUST support a Gemini CLI runner

The A/B harness drives `claude` only, so no low-end claim about Gemini can be
proven. The harness MUST support running the same eval methodology through
Gemini CLI, pinned to `gemini-3.5-flash`, producing the same A/B comparison
(with-SpecShip vs without) and the same pass bar as the Claude runs:
tool-call count, wall-clock, and Read/Grep-fallback rate. A missing or
unauthenticated `gemini` binary MUST fail the run with a clear message, never
a silent skip recorded as a pass.

This runner is the gate for REQ-LOWEND-002 and the measurement for
REQ-LOWEND-003/004 under the real model. `flash-lite` MAY be added as a
second pinned row later; it is not required now.

implementations:
  - scripts/agent-eval/run-all-gemini.sh
  - scripts/agent-eval/parse-run-gemini.mjs:parseGeminiRun
  - scripts/agent-eval/eval-metrics.mjs:emptyMetrics
  - scripts/agent-eval/eval-metrics.mjs:renderMetrics
  - scripts/agent-eval/parse-run.mjs:parseClaudeStream

## Acceptance
<!-- id: REQ-LOWEND-005.A1 -->
- A documented harness invocation runs the eval under Gemini CLI pinned to
  `gemini-3.5-flash` and emits the same A/B metrics schema as the Claude
  runner.
  verifies:
    - __tests__/lowend-eval-harness.test.ts:geminiRunnerEmitsTheClaudeMetricsSchema
<!-- id: REQ-LOWEND-005.A2 -->
- With no usable `gemini` binary the run exits non-zero naming the
  prerequisite; nothing is recorded as a pass.
  verifies:
    - __tests__/lowend-eval-harness.test.ts:missingOrUnauthenticatedGeminiFailsTheRun
    - __tests__/lowend-eval-harness.test.ts:unparseableOutputIsNeverAZeroToolPass
<!-- id: REQ-LOWEND-005.A3 -->
- The existing Claude-driven eval path is unchanged and still passes.
  verifies:
    - __tests__/lowend-eval-harness.test.ts:claudeRunnerRendersAByteIdenticalBlock
