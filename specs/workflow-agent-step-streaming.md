---
id: WF-STREAM-DOC
title: Stream agent-step activity into the workflow run view
owner: core
priority: high
brief: workflow-agent-step-streaming/brief.md
---

<!-- id: WF-STREAM-DOC -->
# Stream agent-step activity into the workflow run view

When a workflow runs an agent step, its activity is a black box: the step
executes a headless agent process and the run view shows only coarse
start/complete, while the tool calls and message turns happen invisibly. This
makes the agent's work observable — each tool call and assistant message streams
into the run view as it happens, and replays when the finished run is reopened.

This is **purely additive observability**. It does NOT change the workflow
execution model, headless/CI runs, resumability, approval gates, or worktree
isolation; it does not run steps as in-session subagents. Granularity is
message/turn-level (no token-by-token streaming), and extended-thinking content
is not surfaced. Only the agent step is affected — `bash` / `script` /
`approval` / `cancel` steps are unchanged.

<!-- id: REQ-WFSTREAM-001 -->
## An agent step MUST stream its activity as live workflow events

While an agent step runs, the workflow MUST surface the agent's activity as
workflow events emitted **as they happen**, through the same event channel the
run view already consumes: a `tool_called` event for each tool the agent
invokes, carrying the tool name and a **short input summary**; and an
`agent_message` event for each assistant text turn, carrying the **full text**
of that turn. Events MUST be emitted mid-step (not deferred to completion) and in
the order the agent produced them. Extended-thinking content MUST NOT be emitted.

[needs review] The agent process must be invoked so it produces a parseable
event stream rather than a single final blob; confirm the exact invocation
(e.g. whether streaming output also requires a verbose flag) at implement time.

## Acceptance
<!-- id: REQ-WFSTREAM-001.A1 -->
- During an agent step, each tool the agent invokes produces a `tool_called` event carrying the tool name and a short, single-line input summary.
<!-- id: REQ-WFSTREAM-001.A2 -->
- Each assistant text turn produces an `agent_message` event carrying the full text of that turn (not truncated).
<!-- id: REQ-WFSTREAM-001.A3 -->
- Events are emitted while the step is still running and in the order the agent produced them — not batched at step completion.
<!-- id: REQ-WFSTREAM-001.A4 -->
- Extended-thinking content does not produce events.
<!-- id: REQ-WFSTREAM-001.A5 -->
- An agent step that invokes no tools and emits no assistant text completes with only the existing start/complete events — no spurious activity events.

<!-- id: REQ-WFSTREAM-002 -->
## The agent step's output contract MUST be preserved, with a fallback

Streaming the activity MUST NOT change an agent step's result: downstream nodes
and `file://` outputs MUST receive the agent's final text output exactly as they
did before. If the agent's output cannot be read as a stream, the step MUST fall
back to using the final output as-is; a stream/parse failure MUST NOT crash the
run or drop the step's output.

## Acceptance
<!-- id: REQ-WFSTREAM-002.A1 -->
- For the same prompt, an agent step's text output (as consumed by downstream nodes and file outputs) is identical to the pre-change behavior.
<!-- id: REQ-WFSTREAM-002.A2 -->
- When the agent emits non-stream or unparseable output, the step still completes and yields its final text output (fallback), and the run does not error.
<!-- id: REQ-WFSTREAM-002.A3 -->
- A step terminated by its idle timeout surfaces the events emitted up to that point and then fails the step, as before.

<!-- id: REQ-WFSTREAM-003 -->
## The run view MUST surface streamed agent activity, live and on replay

The dashboard run-detail view MUST render an agent step's streamed `tool_called`
and `agent_message` events — updating live as they arrive over the run event
stream, and replaying the same activity when a finished run is reopened.
`agent_message` MUST be a recognized event type with its own presentation.
Non-agent steps MUST be unaffected.

## Acceptance
<!-- id: REQ-WFSTREAM-003.A1 -->
- With a run open, an agent step's `tool_called` and `agent_message` events appear in the run view as they happen (live, over the event stream).
<!-- id: REQ-WFSTREAM-003.A2 -->
- Reopening a completed run replays the same `tool_called` / `agent_message` activity (persisted, not live-only).
<!-- id: REQ-WFSTREAM-003.A3 -->
- `agent_message` renders as a distinct, recognized event type with its own style — not as an unknown/unstyled event.
<!-- id: REQ-WFSTREAM-003.A4 -->
- A run whose steps are only `bash` / `script` / `approval` shows no agent-activity events and renders as before.
