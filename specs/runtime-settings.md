---
id: RUNSET-DOC
title: Runtime settings files with repo-over-install precedence
owner: specship
priority: medium
---

<!-- id: RUNSET-DOC -->
# Runtime settings files with repo-over-install precedence

SpecShip's behavior switches (steering, compaction, model tier, …) are
environment variables today, which makes per-repo defaults awkward — the
`settings.json` `env`-block belongs to Claude Code, not SpecShip, and doesn't
travel with the repo. This adds SpecShip-owned settings files:

- **Project:** `<repo>/.specship/settings.json` — committed or local,
  travels with the project.
- **Install:** `~/.specship/settings.json` — machine-wide defaults.

**Precedence: explicit env var > project file > install file > built-in
default.** The env var stays on top so a one-off shell override or a Claude
`env`-block always wins; the project file overrides the machine default per
the repo-owns-its-behavior principle.

Keys are the environment-variable names themselves (`"SPECSHIP_NO_STEERING":
"1"`), values are strings — one vocabulary across env, files, and docs, so
the generated env-var reference stays the single list and nothing new can
drift.

<!-- id: REQ-RUNSET-001 -->
## Settings MUST resolve env > project file > install file

A single resolver returns a switch's effective value with that precedence.
Missing or unparseable files resolve as absent (never an error — a corrupt
settings file must not break a tool call or a hook). Only string values are
honored; keys not starting with `SPECSHIP_` are ignored.

implementations:
  - src/config/runtime-settings.ts:resolveSetting

## Acceptance
<!-- id: REQ-RUNSET-001.A1 -->
- With `SPECSHIP_NO_STEERING=1` in the project file only, the resolver
  returns `1` for that project and the built-in default elsewhere.
<!-- id: REQ-RUNSET-001.A2 -->
- With conflicting values in both files, the project file wins.
<!-- id: REQ-RUNSET-001.A3 -->
- An explicit env var beats both files.
<!-- id: REQ-RUNSET-001.A4 -->
- A corrupt settings file resolves as absent; nothing throws.

<!-- id: REQ-RUNSET-002 -->
## The behavior switches MUST read through the resolver

The switches a user tunes per repo — `SPECSHIP_NO_STEERING`,
`SPECSHIP_COMPACT`, `SPECSHIP_MODEL` — resolve through the settings chain at
their existing read sites (the steering nudge and the model-tier detector).
Other `SPECSHIP_*` variables MAY migrate later; until then they remain
env-only and the docs say which.

implementations:
  - src/activation/steering.ts:buildSteeringNudge
  - src/mcp/model-context.ts:detectModelTier

## Acceptance
<!-- id: REQ-RUNSET-002.A1 -->
- `{"SPECSHIP_NO_STEERING":"1"}` in `<repo>/.specship/settings.json`
  silences the steering nudge for that repo with no env var set.
<!-- id: REQ-RUNSET-002.A2 -->
- `{"SPECSHIP_COMPACT":"0"}` in the install file disables compaction
  machine-wide; a project file with `"1"`… re-enables it for that project.
<!-- id: REQ-RUNSET-002.A3 -->
- `{"SPECSHIP_MODEL":"claude-haiku-4-5"}` in the project file forces the
  haiku tier for that project's tool responses.
