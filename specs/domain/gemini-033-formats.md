---
id: DOM-SPECSHIP-009
title: From Gemini CLI 0.33.0, MCP tools are mcp_<server>_<tool>, sessions are JSON Lines, and folders must be trusted
type: external
dependency: "@google/gemini-cli"
version: 0.67.0
source: "@google/gemini-cli-core tools/mcp-tool (generateValidName, formatMcpToolName, MCP_TOOL_PREFIX), tools/tool-names (isValidToolName), services/chatRecordingService (JSON Lines accumulator), config/storage (project registry), config/trustedFolders; @google/gemini-cli settingsSchema (experimental.enableAgents)"
fixture: __tests__/gemini-033-compat.test.ts:reqAgentswitch018A2RealSession
depends_on: REQ-AGENTSWITCH-018
---

# From Gemini CLI 0.33.0, MCP tools are mcp_<server>_<tool>, sessions are JSON Lines, and folders must be trusted

This supersedes DOM-SPECSHIP-007 for Gemini CLI 0.33.0 and later. We checked
the published gemini-cli-core 0.32.1 (old behaviour) and 0.33.0, 0.35.0,
0.36.0 and 0.67.0 (new behaviour).

- **Tool names.** The model is shown an MCP tool as `mcp_<server>_<tool>`,
  for example `mcp_specship_specship_explore`. Calls are recorded under that
  name, and it is the only MCP form a subagent's `tools:` list and
  `--allowed-tools` accept. `isValidToolName` rejects `specship__…`. Policy
  TOML `mcpName` rules still take the server's bare tool name.
- **Sessions.** `~/.gemini/tmp/<project>/chats/session-*.jsonl`. `<project>`
  is a short name from `~/.gemini/projects.json`, not a hash. The first line
  is a metadata record (`sessionId`, `projectHash` = sha256 of the project
  root, `startTime`, `lastUpdated`, `kind`). After it come message records
  (keyed by `id`; the last record for an id wins), `{ $set }` metadata
  updates, `{ $patch }` records (`content` and tool-call `result`s for an
  id, `updates[]`, `removeIds[]`, `orderIds[]`) and `{ $rewindTo }`. Tool
  responses and Gemini's own `<session_context>` / `<hook_context>` turns
  are also `user` records. A prompt Gemini added context to keeps the
  user's text in `displayContent`.
- **Folder trust** is on by default (`security.folderTrust.enabled ?? true`).
  In a folder that isn't trusted, Gemini CLI does not load project MCP
  servers, project hooks, project skills or subagents, or the project's
  GEMINI.md. Trust lives in `~/.gemini/trustedFolders.json`
  (`TRUST_FOLDER` / `TRUST_PARENT` / `DO_NOT_TRUST`), set by the trust prompt
  or `/permissions trust`.
- **Subagents** are on by default from 0.36.0 (`experimental.enableAgents`
  defaults to `true`). They are off in 0.35.x and earlier.
