---
id: DOM-SPECSHIP-008
title: Gemini CLI headless mode excludes unlisted approval tools and streams typed events
type: external
dependency: "@google/gemini-cli"
version: 0.28.0
source: "@google/gemini-cli dist/src/config/config.js — loadCliConfig, createToolExclusionFilter; @google/gemini-cli-core dist/src/output/types.d.ts — JsonStreamEventType; dist/src/policy/config.js — tools.allowed rules"
fixture: __tests__/workflow-headless-agents.test.ts:geminiStreamIsParsed
depends_on: REQ-AGENTADAPT-007
---

# Gemini CLI headless mode excludes unlisted approval tools and streams typed events

Gemini CLI runs headless whenever stdin is piped (or `-p` is given); piped
stdin is used as the prompt. Headless in the default approval mode REMOVES
`run_shell_command`, `replace`, `write_file` and `web_fetch` unless they are
named in `--allowed-tools`, and any remaining ask-the-user decision becomes a
deny — so a step must list every tool it needs. `--allowed-tools` entries are
user-tier allow rules (an administrator policy still outranks them); MCP
tools are named `<server>__<tool>`, and `run_shell_command(<prefix>)` allows
a command prefix. There is no deny-list or append-system-prompt flag.
`--output-format stream-json` writes one JSON event per line: `init`
(`session_id`, `model`), `message` (`role`, `content`, `delta`), `tool_use`
(`tool_name`, `parameters`), `tool_result`, `error`, and a final `result`
(`status` `success`|`error`, `stats.duration_ms`) — there is no final-text
field; the answer is the concatenated assistant messages.
