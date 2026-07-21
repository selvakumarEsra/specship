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
- **SessionStart hook (first-prompt seed).** The transcript channel has a
  blind spot: a brand-new session's first prompt has no assistant turn yet,
  so it runs at the `full` tier. Claude Code's `SessionStart` hook input
  carries an optional `model` field before any assistant turn exists; the
  `specship cheatsheet` command (already installed as a SessionStart hook)
  reads its stdin JSON and, when a model is present and the session's `cwd`
  resolves to an initialized project, records the marker. Best-effort: a
  missing/absent `model` (e.g. after `/clear` or conversation recovery),
  unparseable stdin, or an uninitialized project records nothing, and
  seeding never affects the cheat-sheet payload or exit code.

implementations:
  - src/mcp/model-context.ts:readModelFromTranscript
  - src/mcp/model-context.ts:detectModelTier
  - src/mcp/model-context.ts:recordModelFromSessionStart
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
<!-- id: REQ-MODCTX-001.A6 -->
- A SessionStart hook payload carrying `model` and a `cwd` inside an
  initialized project records the marker before any assistant turn exists;
  a payload without `model`, with unparseable JSON, or with a `cwd` outside
  any initialized project records nothing — and in every case the
  cheat-sheet output is unaffected.

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

<!-- id: REQ-MODCTX-005 -->
## The auto-switch MUST be visible to the human user

REQ-MODCTX-003 made compaction visible to the *agent* (the in-response
compact-mode line); the human never sees tool results, so today the
auto-switch is silent to the user. When the session's model resolves to a
non-`full` tier and compaction is active, the status line renders a dim
element telling the user SpecShip is optimizing its output for the smaller
model (e.g. `⛁ optimizing for Haiku`).

Honesty bounds this element the same way it bounds the rest of the status
line: it appears ONLY when compaction would actually apply — it resolves
through the same tier resolution the MCP server uses, so `SPECSHIP_COMPACT=0`
hides it and a `SPECSHIP_MODEL` override drives it. The wording asserts
optimization, never reduction ("optimizing for", not "trimmed" — the user
must not read it as degraded answers). Rendering stays pure: the caller
resolves the tier; `renderSegment` only formats. [needs review: element
placement (identity line vs header line) and exact wording.]

implementations:
  - src/statusline/index.ts:buildSegment
  - src/statusline/render.ts:renderSegment
  - src/mcp/model-context.ts:detectModelTier

## Acceptance
<!-- id: REQ-MODCTX-005.A1 -->
- A status-line render in an initialized project whose stdin model maps to
  the haiku tier includes an element naming the optimization and the tier
  (e.g. "optimizing for Haiku"); a sonnet-tier model names Sonnet.
<!-- id: REQ-MODCTX-005.A2 -->
- On the full tier (e.g. Fable/Opus) the element is absent and the rendered
  line is byte-identical to today's output.
<!-- id: REQ-MODCTX-005.A3 -->
- With `SPECSHIP_COMPACT=0` the element is absent even when the model maps
  to haiku — the indicator never claims an optimization that is disabled.
<!-- id: REQ-MODCTX-005.A4 -->
- Under `NO_COLOR` the element renders as plain text with no ANSI escapes.
<!-- id: REQ-MODCTX-005.A5 -->
- Tier resolution failing (unreadable marker/settings) drops the element
  and never breaks the rendered line.
