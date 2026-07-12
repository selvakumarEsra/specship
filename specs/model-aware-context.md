---
id: MODCTX-DOC
title: Model-aware context compaction
owner: specship
priority: medium
---

<!-- id: MODCTX-DOC -->
# Model-aware context compaction

SpecShip's tool output is tuned for frontier models. Smaller models (Haiku,
and to a lesser degree Sonnet) have tighter effective context and pay
proportionally more attention cost per token of scaffolding — the boilerplate
notices, relationship prose, and meta-guidance that wrap the source code in a
`specship_explore` response. When the session runs on a lower tier, SpecShip
compacts its OWN prose ("caveman style": telegraphic, information-dense,
deterministic) while keeping source code byte-verbatim — code is the payload,
scaffolding is the overhead.

Two principles bound this feature:

- **Never compress the payload.** Source code, symbol names, file paths, and
  line numbers are never altered or truncated by compaction. Only SpecShip's
  own prose scaffolding compresses. (Partial answers force the agent back to
  Read — the regression this repo's retrieval doctrine forbids.)
- **Deterministic, not steered.** Compaction is a fixed text transform inside
  the tool, not a skill asking the agent to "reply like a caveman" — per the
  adapt-the-tool doctrine, low-salience agent steering doesn't land. (An
  agent-facing caveman skill was considered and rejected for this reason.)

Numeric budget scaling (fewer files / smaller per-file caps on low tiers) is
deliberately OUT of v1: shrinking code output risks the sufficiency bar that
keeps Read at 0, so it is gated on an agent A/B, like the steering hook.
[needs review: revisit after an A/B measures haiku behavior with scaled
budgets.]

<!-- id: REQ-MODCTX-001 -->
## SpecShip MUST know which model the session is on

Two producers write the same session marker under `.specship/` (atomic,
write-on-change); the MCP server resolves the active tier per call from
`SPECSHIP_MODEL` env (overrides everything), else the marker, else unknown.
Unknown model → no compaction (honest default: never compact blind).

- **Steering hook (primary — present on every default install).** Every
  Claude Code hook receives `transcript_path`; the `steer-nudge` command
  tail-reads the transcript JSONL and extracts the latest assistant turn's
  `message.model`, recording it before emitting (or suppressing) the
  steering line. Because the hook fires per prompt, mid-session `/model`
  switches are tracked; the very first prompt of a brand-new session has no
  assistant turn yet, so that one call runs at the `full` tier. Recording
  happens even when the steering text itself is suppressed by
  `SPECSHIP_NO_STEERING` — but never in uninitialized projects.
- **Status line (bonus channel).** When installed, it records the model it
  receives on every render.

implementations:
  - src/mcp/model-context.ts:readModelFromTranscript
  - src/mcp/model-context.ts:detectModelTier
  - src/statusline/index.ts:buildSegment

## Acceptance
<!-- id: REQ-MODCTX-001.A1 -->
- A status-line render with `model.display_name: "Haiku 4.5"` in a SpecShip
  project records a model marker readable by the MCP server.
<!-- id: REQ-MODCTX-001.A2 -->
- With no marker and no env override, the tier resolves to `full` and output
  is byte-identical to today's.
<!-- id: REQ-MODCTX-001.A3 -->
- `SPECSHIP_MODEL=claude-haiku-4-5` forces the haiku tier regardless of the
  marker.
<!-- id: REQ-MODCTX-001.A4 -->
- Invoking the steer-nudge hook with a `transcript_path` whose latest
  assistant turn ran on Haiku records a haiku marker — without the status
  line installed.
<!-- id: REQ-MODCTX-001.A5 -->
- Transcript reading is tail-bounded (a large transcript is not read whole)
  and tolerant: malformed lines and a missing/unreadable transcript record
  nothing and never fail the hook.

<!-- id: REQ-MODCTX-002 -->
## On a lower tier, SpecShip prose MUST compact — code MUST NOT

Code-graph tool results on the `haiku` and `sonnet` tiers pass through a
fence-preserving compactor: fenced code blocks are byte-verbatim; outside
fences, runs of blank lines collapse, and SpecShip's known long boilerplate
notices are replaced with terse equivalents carrying the same instruction
(e.g. the multi-sentence "verbatim, current on-disk source…" notice becomes
one short line that still says "treat as already Read"). On `haiku`
additionally, low-value sections trim harder: the blast-radius list caps at
its top entries and trailing meta-guidance drops. The `full` tier is
untouched.

implementations:
  - src/mcp/model-context.ts:compactToolResult

## Acceptance
<!-- id: REQ-MODCTX-002.A1 -->
- Compacting a response leaves every fenced code block byte-identical.
<!-- id: REQ-MODCTX-002.A2 -->
- The compacted response still instructs the agent to treat returned source
  as already read (the stop-reading signal survives compression).
<!-- id: REQ-MODCTX-002.A3 -->
- On the haiku tier a blast-radius section longer than its cap is truncated
  with an explicit "+N more" line, never silently.
<!-- id: REQ-MODCTX-002.A4 -->
- On the full tier the compactor is the identity function.

<!-- id: REQ-MODCTX-003 -->
## Compaction MUST be visible and opt-outable

A compacted response carries a one-line marker naming the tier and
ASSERTING completeness ("all code complete and verbatim"). Measured on the
haiku baseline (2026-07-12, express 2/2 runs): advertising the opt-out in
the marker read as "this output is incomplete" to a small model, which then
re-Read files it had been handed — so the opt-out (`SPECSHIP_COMPACT=0`,
which disables compaction at any tier) is documented in the reference docs,
never in the response itself. No silently-different output.

implementations:
  - src/mcp/model-context.ts:compactToolResult

## Acceptance
<!-- id: REQ-MODCTX-003.A1 -->
- A compacted response contains a single compact-mode line naming the tier
  and asserting completeness; it does not mention the opt-out.
<!-- id: REQ-MODCTX-003.A2 -->
- With `SPECSHIP_COMPACT=0`, output is byte-identical to the full tier even
  on haiku.

<!-- id: REQ-MODCTX-004 -->
## Only code-graph tools compact

Designer and JIRA tool responses are not code-graph payloads and pass
through unchanged regardless of tier.

## Acceptance
<!-- id: REQ-MODCTX-004.A1 -->
- A jira/designer tool result on the haiku tier is byte-identical to full.
