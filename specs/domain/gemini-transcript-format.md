---
id: DOM-SPECSHIP-007
title: Gemini CLI transcripts are one JSON document with bare MCP tool names
type: external
dependency: "@google/gemini-cli"
version: 0.28.0
source: "@google/gemini-cli-core dist/src/services/chatRecordingService.js — ChatRecordingService; dist/src/tools/mcp-tool.js — DiscoveredMCPTool"
fixture: __tests__/contracts/gemini-cli.contract.test.ts:geminiTranscriptIsSingleJson
depends_on: REQ-GEMINI-011
---

# Gemini CLI transcripts are one JSON document with bare MCP tool names

Gemini CLI records a session as ONE pretty-printed JSON document
(`JSON.stringify(conversation, null, 2)`), not JSON lines; tool calls are
`messages[].toolCalls[].name`. An MCP tool is shown to the model — and
recorded — under its bare name (`specship_explore`); the qualified
`specship__specship_explore` form is used for policy matching and only
appears as a call name when a name collision forces it. A line-by-line
search of the transcript never matches; parse it.
