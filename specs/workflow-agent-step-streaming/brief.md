---
slug: workflow-agent-step-streaming
spec: WF-STREAM-DOC   # specs/workflow-agent-step-streaming.md (REQ-WFSTREAM-001..003)
created: 2026-06-25
---

# Brainstorm: Stream agent-step activity into the workflow run view

## Problem

When a SpecShip workflow runs an agent step, the user can't see what the agent
is doing. Each `runner: agent` step spawns a headless `claude --print
--output-format json` subprocess and waits for the **final JSON** — the agent's
tool calls and intermediate output are invisible (buried in a
`<runId>-<node>.jsonl` log on disk), so the run-detail view shows only coarse
`step_started → step_completed`. The work happening inside a step is a black box.

We want each agent step's activity — the tools it calls and its message turns —
to **stream live into the dashboard run view** (and replay on reload), without
changing the workflow execution model. Considered (and rejected) running steps
as in-session subagents: that collides with the engine's headless/CI runs,
resumable cross-process state, approval gates, and worktree isolation. Streaming
the existing subprocess closes the visibility gap with none of that impact.

## Code grounding

- `src/workflows/runners/prompt.ts` — the agent runner: `spawn('claude',
  ['--print','--output-format','json', …])`, captures stdout, parses the final
  `{result}`/`{content}` JSON into `NodeRunResult.output.text`, writes raw stdout
  to `<runId>-<node>.jsonl`. This is what changes to `stream-json` + incremental
  parsing.
- `src/workflows/runners/types.ts` — `RunnerContext` exposes `cwd`, `logsDir`,
  `runId` but **no event-emit hook**. Add an `emitEvent(type, data)` callback here.
- `src/workflows/executor.ts` — already emits events via a private
  `event(run.id, type, data)` → `specQueries.insertWorkflowEvent(...)`; it emits
  `step_started` / `step_completed`. Bind a per-node `emitEvent` from this into
  `RunnerContext` so the runner can append events mid-stream.
- `src/db/schema.sql` (`workflow_events`) — columns `event_type`, `step_id`,
  `step_kind`, `data` (JSON), `created_at`. The enumerated `event_type`s already
  include `tool_called` and `artifact_created`. `WorkflowEvent` /
  `WorkflowEventType` live in `src/types.ts:894`.
- `packages/server/src/routes/workflow.ts` — SSE that tails `workflow_events` as
  they're appended (the run-detail stream).
- `packages/web-ng/src/app/pages/run-detail/run-detail.ts` — subscribes to
  `/api/workflows/runs/:id/events`, renders a DAG + an Events tab, and **already
  styles** `step_started` / `step_completed` / `tool_called` / `artifact_created`.
  A new `agent_message` type needs a color here.
- The stream-json shape is already parsed by `scripts/agent-eval/*.mjs`
  (assistant `content` blocks: `text` / `tool_use`; `result` event) — reuse that
  parsing pattern.

## Approaches considered

1. **A — Stream the existing subprocess.** `--output-format stream-json`, parse
   incrementally, emit events on the existing path. Same execution model, now
   observable.
2. **B — Agent SDK in-process.** Replace `spawn` with `@anthropic-ai/claude-agent-sdk`
   `query()`; programmatic message stream + finer control, but a runner rewrite
   and an auth/MCP-wiring change (the spawned CLI inherits the user's session for
   free today).
3. **C — In-session subagents (Task tool).** Run steps inside the user's Claude
   Code session. Collides with headless/CI runs, resumable cross-process state,
   approval-gate pause/resume, and worktree isolation — a different product.
**Chosen: A.** Delivers the visibility goal at the least cost, lights up a
run-detail UI already wired for these event types, reuses existing stream-json
parsing, and keeps every engine property intact (purely additive). B is a
sensible later upgrade for programmatic control; C conflicts with the engine.

## Key decisions

- **Emit hook on RunnerContext:** add `emitEvent(type, data)`; the executor wires
  it to its `event(run.id, …)` emitter, stamping `stepId`/`stepKind`. No new
  transport — events ride the existing `workflow_events` → SSE → run-detail path.
- **Stream parsing in the prompt runner:** spawn with `--output-format
  stream-json`, parse each JSONL line —
  - `tool_use` block → emit **`tool_called`** with `{ name, input-summary }`,
  - assistant `text` turn → emit **`agent_message`** with `{ text }`,
  - terminal `result` event → capture the node's final text output (the
    data-flow contract is preserved exactly), executor emits `step_completed`,
  - thinking blocks are skipped.
- **New event type `agent_message`** added to `WorkflowEventType` + the schema
  comment + a run-detail color (tool_called already styled).
- **Persist + live:** events append to `workflow_events`, so they stream live AND
  replay on reload. Tool-input and message text are truncated to a bounded cap to
  keep rows small.
- **Fallback:** if the agent emits non-stream / unparseable output, fall back to
  today's final-result parse — never break a run or lose its output.
- The raw `<runId>-<node>.jsonl` log is kept (debug backstop).

## Edge cases & non-goals

Edge cases:
- `--print --output-format stream-json` may also require `--verbose` — [needs
  review] confirm at implement time; the spawn args must produce parseable JSONL.
- A step that emits no tool calls / no text still completes normally (only
  `step_started`/`step_completed`).
- Non-stream or malformed output → fallback path; the node still returns its
  final text and the run does not crash.
- A very chatty step persists many event rows — accepted for v1 (truncation
  bounds row size); a hard per-run cap is a possible later add.
- A killed/timed-out step (idle timeout SIGTERM) surfaces the events emitted so
  far, then fails the step as today.

Non-goals:
- No token-by-token streaming — message/turn-level granularity only.
- Extended-thinking blocks are not surfaced.
- `bash` / `script` / `approval` / `cancel` runners are unchanged — only the
  agent (`prompt`) runner streams.
- No change to execution model, headless/CI runs, resumability, approval gates,
  or worktree isolation — purely additive observability.
- Not the Agent SDK and not in-session subagents (Approaches B / C).

## Acceptance criteria

- Running a workflow with an agent step, the run-detail view shows `tool_called`
  events (tool name + short input) and `agent_message` events appearing live, in
  order, as the step runs — sourced from the agent's stream, not just
  `step_started`/`step_completed`.
- Those events are persisted, so reloading the run after it finishes replays the
  same activity (not live-only).
- The agent step's text output is unchanged from before this change: downstream
  nodes and `file://` outputs receive the agent's final result exactly as they
  did with `--output-format json`.
- When the agent emits non-stream or unparseable output, the step still completes
  with its final result and the run does not error (fallback path).
- `bash` / `script` / `approval` steps behave exactly as before (no new events
  for them).
- A headless `specship workflow run` (no dashboard open) still completes
  identically; the new events are written but require no interactive session.
