---
id: DOM-SPECSHIP-006
title: Gemini CLI BeforeTool deny is a top-level decision, fired after confirmation
type: external
dependency: "@google/gemini-cli"
version: 0.28.0
source: "@google/gemini-cli-core dist/src/hooks/types.js — BeforeToolHookOutput.isBlockingDecision; dist/src/scheduler/scheduler.js — Scheduler._processToolCall"
fixture: __tests__/contracts/gemini-cli.contract.test.ts:geminiDenyDecisionIsTopLevel
depends_on: REQ-GEMINI-011
---

# Gemini CLI BeforeTool deny is a top-level decision, fired after confirmation

A Gemini CLI hook blocks a tool call by returning a TOP-LEVEL
`{"decision": "deny", "reason": "…"}`; `isBlockingDecision()` checks
`this.decision`, so a decision nested under `hookSpecificOutput` is ignored.
The scheduler runs the policy check and the user's confirmation prompt
BEFORE it executes the tool, and `BeforeTool` fires only at execution — so a
hook can never spare the user Gemini's "Allow once" prompt, and denying a
shell command would make the user approve it and then see it blocked.
