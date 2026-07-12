---
id: LOWMODEL-DOC
title: Lower-model handling — opinionated, not terse
owner: specship
priority: medium
---

<!-- id: LOWMODEL-DOC -->
# Lower-model handling — opinionated, not terse

MODCTX-DOC gave SpecShip model-tier detection and prose compaction. This
document covers the deeper Haiku-class adaptations, built on how small models
actually degrade in an agentic loop: mid-context recall decays (position
beats volume), multi-hop synthesis weakens (the tool must do the reasoning),
tool choice collapses with menu size, turn count hurts more than token count,
queries get sloppier, and fabrication rises.

Governing principle: **for lower models SpecShip becomes more opinionated,
not more terse** — smaller menu, louder structure, prescriptive next steps,
same or richer evidence. Compress redundancy, never explanation.

Standing constraints:

- **Sufficiency first.** Nothing here may shrink the evidence a response
  carries — an insufficient answer sends the agent into the fallback-to-Read
  spiral, which Haiku handles worst of all. Per-call output-budget scaling
  stays OUT (gated on the A/B, as in MODCTX-DOC).
- **Schemas stay static.** Tool *lists* may vary by tier (with the MCP
  `listChanged` mechanics honored); tool *schemas* never do — clients cache
  them and prompt caches key on them.
- **Every behavioral default here is earned through the harness's model arm
  (REQ-LOWMODEL-005), the same bar as the steering hook.** Until its A/B is
  recorded, each lever ships behind its tier gate but may be reverted by
  measurement.

<!-- id: REQ-LOWMODEL-001 -->
## Miss and error responses MUST end with a copy-pasteable next call

Small models follow templates far better than principles. Every "not found" /
"no results" response from a code-graph tool names the nearest real matches
(when any exist) and ends with the exact next tool call to make, ready to
copy — e.g. `Next: specship_explore "AuthService.login SessionStore"`. This
applies at EVERY tier (frontier models benefit too); it is the cheapest
anti-flounder lever.

implementations:
  - src/mcp/tools.ts:ToolHandler

## Acceptance
<!-- id: REQ-LOWMODEL-001.A1 -->
- A `specship_search` with no results whose query is a near-miss of an
  existing symbol returns the closest real symbol names and a literal next
  `specship_explore` call using them.
<!-- id: REQ-LOWMODEL-001.A2 -->
- A `specship_node` / `specship_callers` "symbol not found" response includes
  nearest-match suggestions and a ready-to-send follow-up call, never a bare
  "not found".

<!-- id: REQ-LOWMODEL-002 -->
## The steering nudge MUST be tier-aware

The steering hook already knows the model (it records the marker). On the
haiku tier it emits a prescriptive template instead of the one-line
principle: name the exact tool to call, state "one call, then answer from
its output", and steer AGAINST spawning subagents (small-model fan-out
multiplies cost and confusion). Frontier and sonnet keep the current line.
Same gates as STEER-HOOK-DOC: silent without an index, `SPECSHIP_NO_STEERING`
opt-out, wording validated in the A/B.

implementations:
  - src/activation/steering.ts:buildSteeringNudge

## Acceptance
<!-- id: REQ-LOWMODEL-002.A1 -->
- In an initialized project whose session marker says haiku, the hook emits
  the prescriptive template (naming `specship_explore` and advising against
  subagents); on fable/opus it emits the standard line.
<!-- id: REQ-LOWMODEL-002.A2 -->
- The haiku template stays under ~80 tokens — per-prompt injection cost is
  the ceiling.

<!-- id: REQ-LOWMODEL-003 -->
## On the haiku tier, explore MUST render the flow as numbered explicit hops

Frontier models synthesize the flow from evidence; Haiku needs the synthesis
done for it. On the haiku tier the Flow section renders as numbered hops,
one line each, naming the mechanism of every edge ("2. `triggerUpdate` →
`triggerRender` — via the callback registered at app.ts:214"), placed FIRST
in the response. Code bodies follow unchanged — this requirement ADDS
explicitness (spending tokens compaction saved); it removes nothing.

implementations:
  - src/mcp/tools.ts:ToolHandler.buildFlowFromNamedSymbols

## Acceptance
<!-- id: REQ-LOWMODEL-003.A1 -->
- On the haiku tier, a connected flow renders as a numbered hop list with a
  per-hop mechanism note, before the source-code section.
<!-- id: REQ-LOWMODEL-003.A2 -->
- The source code included is identical to the full tier's (explicitness is
  additive; evidence is untouched).

<!-- id: REQ-LOWMODEL-004 -->
## On the haiku tier, the code-graph tool menu SHOULD trim to the core three

Menu size degrades small-model tool choice. On the haiku tier `getTools()`
exposes `specship_explore`, `specship_search`, and `specship_node` from the
code-graph group (spec/link tools, enabled integrations, and everything the
tiny-repo gate already preserves are unaffected in their own terms — this
composes with, and mirrors, the existing tiny-repo gate). The trimmed list
MUST ride an MCP `listChanged` notification when the tier changes
mid-session, and `execute()` MUST still answer a trimmed-away tool (clients
cache lists) rather than erroring. [needs review: exact interaction matrix
with the tiny-repo gate and SPECSHIP_MCP_TOOLS — trim composes as
intersection.]

implementations:
  - src/mcp/tools.ts:ToolHandler.getTools

## Acceptance
<!-- id: REQ-LOWMODEL-004.A1 -->
- With a haiku marker, `getTools()` returns only the core three from the
  code-graph group; with a fable marker the list is unchanged from today.
<!-- id: REQ-LOWMODEL-004.A2 -->
- Calling a trimmed-away code-graph tool on the haiku tier still executes
  and answers (no "unknown tool" for a cached client).
<!-- id: REQ-LOWMODEL-004.A3 -->
- A mid-session tier change triggers a tools `listChanged` notification.

<!-- id: REQ-LOWMODEL-005 -->
## The eval harness MUST grow a model arm, with per-tier pass bars

`scripts/agent-eval/run-all.sh` hardcodes `--model opus`; it takes a model
parameter (env or flag) threaded into both arms, and results record the
model (the BENCH-CLAIM manifest already stamps it). The documented pass bar
becomes per-tier: frontier keeps "~0 Read/Grep within the explore budget";
haiku's bar is honest — task completes, no flounder spiral, Read bounded
(exact threshold set from the first baseline run, not invented). Every
SHOULD in this document converts to MUST or reverts based on this harness's
haiku runs.

implementations:
  - scripts/agent-eval/run-all.sh

## Acceptance
<!-- id: REQ-LOWMODEL-005.A1 -->
- `run-all.sh` accepts a model override and passes it to both arms; omitting
  it preserves today's behavior.
<!-- id: REQ-LOWMODEL-005.A2 -->
- A recorded haiku baseline (≥2 runs/arm on at least small+medium repos)
  exists in docs/benchmarks/ before any of REQ-LOWMODEL-002/003/004 flips
  from default-on-trial to permanent.

<!-- id: REQ-LOWMODEL-006 -->
## Explicitly deferred (research, not v1)

Session-aware response dedup ("body unchanged from earlier this session")
is NOT built: Claude Code's own transcript compaction may have evicted the
earlier copy, and a dangling pointer forces a Read — the exact spiral this
document exists to prevent. Revisit only with a way to know what survived
compaction.

## Acceptance
<!-- id: REQ-LOWMODEL-006.A1 -->
- No shipped code path elides a symbol body by referring to an earlier
  response in the same session.
