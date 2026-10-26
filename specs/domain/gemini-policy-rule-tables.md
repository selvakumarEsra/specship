---
id: DOM-SPECSHIP-005
title: Gemini CLI policy files use [[rule]] tables and compose specship__<tool>
type: external
dependency: "@google/gemini-cli"
version: 0.28.0
source: "@google/gemini-cli-core dist/src/policy/toml-loader.js — PolicyFileSchema, loadPoliciesFromToml"
fixture: __tests__/contracts/gemini-cli.contract.test.ts:geminiPolicyUsesRuleTables
depends_on: REQ-GEMINI-009
---

# Gemini CLI policy files use [[rule]] tables and compose specship__<tool>

Gemini CLI reads policy TOML files whose rules live in `[[rule]]` tables
(`PolicyFileSchema.rule`). Any other table name — `[[rules]]` included —
parses but is silently ignored, so the policy does nothing. When a rule sets
`mcpName`, the loader builds the tool name itself as
`${mcpName}__${toolName}`, so `toolName` entries must be the bare server tool
names (`specship_explore`), never prefixed. User-tier policies live in
`~/.gemini/policies/`; an administrator-tier rule always outranks them.

## Enforced
- `src/installer/targets/gemini.ts` must not match `/\[\[rules\]\]/`
